// ── match-worker/cupSeeder.ts ────────────────────────────────────────────────
// Worker-side port of src/features/match/api/cupSeeder.ts.  Hosts the two
// cup-pipeline entry points the worker calls:
//
//   • seedCupCompetitions(supabase, seasonId) — fired from
//     maybeTransitionSeasonForMatch the moment a season flips to 'voting'.
//     Pulls standings for all 4 leagues, picks qualifiers (top 3 for the
//     Celestial Cup, 4th–6th for the Solar Shield), runs drawSingleElim, and
//     persists round-1 matches + the StoredBracket JSON.
//
//   • advanceCupRound(supabase, competitionId, matchId, winnerTeamId) —
//     fired from processMatch after settleMatchWagers when the completed
//     match belongs to a cup.  Locates the match's slot, marks the winner,
//     and inserts the next-round match if both teams are now known.
//
// DUPLICATION RATIONALE
// ─────────────────────
// Identical reasoning to postMatchEffects.ts / oddsGenerator.ts /
// focusOptionsGenerator.ts: Deno can't resolve the project's path aliases
// and the second consumer alone doesn't justify a cross-runtime package
// (CLAUDE.md principle 9).  If a third consumer emerges, extract the pure
// pieces (computeStandings, buildQualifierSeeding) into a shared package
// consumable by both runtimes.

// deno-lint-ignore-file no-explicit-any

import {
  drawSingleElim,
  type BracketTeam,
  type StoredBracket,
  type StoredBracketMatch,
} from './cupDraw.ts';

// ── Constants ────────────────────────────────────────────────────────────

/**
 * Canonical ISL league order, by stable `teams.league_id` slug.  This is the
 * order in which league standings are interleaved into the cup seed list
 * (Rocky Inner #1 = overall seed 1, Gas/Ice Giants #1 = seed 2, etc.), so it
 * is load-bearing: changing it would reshuffle every bracket.
 *
 * It MUST equal the order of the old hardcoded `LEAGUE_COMPETITION_IDS`
 * (Rocky Inner → Gas/Ice Giants → Asteroid Belt → Kuiper Belt).  The third
 * slug is `outer-reaches`, which is the slug carrying the Asteroid Belt clubs
 * (see src/data/leagueData.ts).  Season-scoped league competitions are sorted
 * by their `league_id`'s index here before seeding, so the qualifier
 * interleaving is byte-identical to the Season-1 hardcoded path.
 */
const LEAGUE_ID_ORDER = ['rocky-inner', 'gas-giants', 'outer-reaches', 'kuiper-belt'] as const;

/** Cup competition UUIDs from migration 0012 (Season 1). */
export const CELESTIAL_CUP_COMPETITION_ID = '20000000-0000-0000-0000-000000000002';
export const SOLAR_SHIELD_COMPETITION_ID  = '20000000-0000-0000-0000-000000000003';

/**
 * Real-time delay from cup seeding to the Round-of-16 kickoff.  Cups are seeded
 * the instant the league season flips to 'voting', so anchoring kickoffs to
 * seed-time — NOT an in-universe calendar date — keeps every fixture inside the
 * worker's `scheduled_at <= now()` claim horizon.  (#569: 2600-dated fixtures
 * were unreachable forever, freezing both cups at the Round of 16.)  24h lets
 * the final standings settle before the knockout begins.
 */
const CUP_R1_OFFSET_MS = 24 * 60 * 60 * 1000;

/**
 * Real-time gap between successive cup rounds.  Each later round is scheduled
 * relative to NOW the moment the prior round completes (advanceCupRound), so it
 * is always reachable.  24h tracks the league's roughly-daily matchday cadence,
 * so a cup plays out over a few days instead of stalling for in-universe weeks.
 */
const ROUND_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** R16 kickoff ISO for a cup seeded at `nowMs` (seed-time + the R1 offset). */
export function cupR1KickoffIso(nowMs: number): string {
  return new Date(nowMs + CUP_R1_OFFSET_MS).toISOString();
}

/** Next-round kickoff ISO, one cadence-interval after `nowMs` (round-completion time). */
export function cupNextRoundKickoffIso(nowMs: number): string {
  return new Date(nowMs + ROUND_INTERVAL_MS).toISOString();
}

// ── Standings calculation (pure) ─────────────────────────────────────────

interface MatchRow {
  home_team_id: string;
  away_team_id: string;
  home_score:   number;
  away_score:   number;
}

interface StandingRow {
  team_id: string;
  team_name: string;
  played: number;
  won:    number; drawn: number; lost: number;
  gf:     number; ga:    number; gd:   number;
  points: number;
}

/**
 * Pure standings calculator: 3 points for a win, 1 for a draw, 0 for a loss.
 * Tiebreaker chain: points → goal difference → goals scored.  Mirrors the
 * src/features/match implementation and the original JS getStandings() in
 * src/lib/supabase.js exactly so the cup qualifier list this generates will
 * match what the league table page displays.
 */
function computeStandings(
  matches: MatchRow[],
  teamNames: Map<string, string>,
): StandingRow[] {
  const table = new Map<string, StandingRow>();

  const ensure = (teamId: string): StandingRow => {
    let row = table.get(teamId);
    if (!row) {
      row = {
        team_id:  teamId,
        team_name: teamNames.get(teamId) ?? teamId,
        played:   0, won: 0, drawn: 0, lost: 0,
        gf:       0, ga:  0, gd:    0, points: 0,
      };
      table.set(teamId, row);
    }
    return row;
  };

  for (const m of matches) {
    const h = ensure(m.home_team_id);
    const a = ensure(m.away_team_id);

    h.played++; a.played++;
    h.gf += m.home_score; h.ga += m.away_score;
    a.gf += m.away_score; a.ga += m.home_score;

    if (m.home_score > m.away_score) {
      h.won++;  h.points += 3;
      a.lost++;
    } else if (m.home_score < m.away_score) {
      a.won++;  a.points += 3;
      h.lost++;
    } else {
      h.drawn++; h.points++;
      a.drawn++; a.points++;
    }
  }

  return [...table.values()]
    .map((r) => ({ ...r, gd: r.gf - r.ga }))
    .sort((a, b) =>
      b.points - a.points ||
      b.gd     - a.gd     ||
      b.gf     - a.gf
    );
}

/**
 * Fetch completed matches + team names for one league competition, then
 * compute its standings.  Returns empty array on any DB error so the
 * downstream qualifier-selection step degrades gracefully (the cup that
 * was supposed to take from this league just gets fewer qualifiers).
 */
async function getLeagueStandings(
  db: any,
  competitionId: string,
): Promise<StandingRow[]> {
  const { data, error } = await db
    .from('matches')
    .select(
      'home_team_id, away_team_id, home_score, away_score,' +
      ' home_team:teams!matches_home_team_id_fkey(id, name),' +
      ' away_team:teams!matches_away_team_id_fkey(id, name)',
    )
    .eq('competition_id', competitionId)
    .eq('status', 'completed');

  if (error) {
    console.warn(`[getLeagueStandings] ${competitionId} failed:`, error.message);
    return [];
  }

  type Joined = MatchRow & {
    home_team: { id: string; name: string } | null;
    away_team: { id: string; name: string } | null;
  };
  const rows = (data ?? []) as Joined[];

  const teamNames = new Map<string, string>();
  for (const r of rows) {
    if (r.home_team) teamNames.set(r.home_team.id, r.home_team.name);
    if (r.away_team) teamNames.set(r.away_team.id, r.away_team.name);
  }

  return computeStandings(rows, teamNames);
}

// ── Qualifier selection ──────────────────────────────────────────────────

/**
 * Build the seeded qualifier list for one cup tier across all 4 leagues.
 *
 * Returns 12 BracketTeam rows with seeds 1..12.  League #1 finishers occupy
 * seeds 1..4 (one per league); league #2 finishers occupy seeds 5..8; etc.
 * Interleaving by position-then-league ensures league strength is balanced
 * across the bracket halves so the top seed from each league is in a
 * different quarter of the draw.
 *
 * @param leagueStandings  Each league's full sorted standings.
 * @param positions        1-indexed positions to take per league:
 *                         Celestial = [1,2,3]; Shield = [4,5,6].
 */
function buildQualifierSeeding(
  leagueStandings: StandingRow[][],
  positions: number[],
): BracketTeam[] {
  const out: BracketTeam[] = [];
  let seed = 1;
  for (const pos of positions) {
    for (const standings of leagueStandings) {
      const row = standings[pos - 1];
      if (!row) continue;
      out.push({ team_id: row.team_id, team_name: row.team_name, seed });
      seed++;
    }
  }
  return out;
}

// ── Match insertion ──────────────────────────────────────────────────────

/**
 * Insert one cup match row and return its DB UUID.  On unique-constraint
 * conflict (the row already exists from a previous seed attempt), we look
 * up the existing row's id and return that so the bracket JSON still
 * captures the canonical match_db_id.
 */
async function insertCupMatch(
  db: any,
  competitionId: string,
  homeTeamId: string,
  awayTeamId: string,
  roundName: string,
  scheduledAtIso: string,
): Promise<string | null> {
  const { data, error } = await db
    .from('matches')
    .insert({
      competition_id: competitionId,
      home_team_id:   homeTeamId,
      away_team_id:   awayTeamId,
      round:          roundName,
      status:         'scheduled',
      scheduled_at:   scheduledAtIso,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      const { data: existing } = await db
        .from('matches')
        .select('id')
        .eq('competition_id', competitionId)
        .eq('home_team_id', homeTeamId)
        .eq('away_team_id', awayTeamId)
        .single();
      return (existing as { id: string } | null)?.id ?? null;
    }
    console.warn(`[insertCupMatch] failed (${homeTeamId} vs ${awayTeamId}):`, error.message);
    return null;
  }
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Insert competition_teams rows for the qualifiers.  Each row carries the
 * team's `seeding` so the cup page UI can render seeds without recomputing.
 */
async function insertCompetitionTeams(
  db: any,
  competitionId: string,
  teams: BracketTeam[],
): Promise<void> {
  if (teams.length === 0) return;
  const rows = teams.map((t) => ({
    competition_id: competitionId,
    team_id:        t.team_id,
    seeding:        t.seed,
  }));
  const { error } = await db
    .from('competition_teams')
    .upsert(rows, { onConflict: 'competition_id,team_id' });
  if (error) {
    console.warn(`[insertCompetitionTeams] ${competitionId} failed:`, error.message);
  }
}

// ── Bracket persistence ──────────────────────────────────────────────────

/**
 * Write the full bracket JSON + status update to the competitions row.
 * `setActive=true` flips the competition out of 'upcoming' to 'active' at
 * initial seed time; subsequent updates from advanceCupRound pass false so
 * we don't accidentally re-active a 'completed' cup.
 */
async function writeBracket(
  db: any,
  competitionId: string,
  bracket: StoredBracket,
  setActive: boolean,
): Promise<void> {
  const update: Record<string, unknown> = { bracket };
  if (setActive) update['status'] = 'active';
  const { error } = await db
    .from('competitions')
    .update(update)
    .eq('id', competitionId);
  if (error) {
    console.warn(`[writeBracket] ${competitionId} failed:`, error.message);
  }
}

/**
 * Read the stored bracket JSON for a competition.  Returns null if the
 * competition has not been seeded yet (bracket column is NULL) or on any
 * DB error.
 */
async function readBracket(
  db: any,
  competitionId: string,
): Promise<StoredBracket | null> {
  const { data, error } = await db
    .from('competitions')
    .select('bracket')
    .eq('id', competitionId)
    .single();
  if (error || !data) return null;
  return ((data as { bracket?: StoredBracket | null }).bracket) ?? null;
}

// ── Public: seed one cup ─────────────────────────────────────────────────

export interface SeedCupResult {
  competitionId: string;
  status: 'seeded' | 'already_seeded' | 'no_qualifiers';
  qualifiers: number;
  round1Matches: number;
}

/**
 * Seed one cup competition: draw the bracket, insert competition_teams +
 * round 1 matches, persist the bracket JSON, and flip the competition status
 * to 'active'.  Idempotent — if the competition already has a stored
 * bracket, returns 'already_seeded' without re-running the draw.
 */
async function seedOneCup(
  db: any,
  competitionId: string,
  qualifiers: BracketTeam[],
  drawSeedSalt: string,
): Promise<SeedCupResult> {
  if (qualifiers.length < 2) {
    return { competitionId, status: 'no_qualifiers', qualifiers: qualifiers.length, round1Matches: 0 };
  }

  const existing = await readBracket(db, competitionId);
  if (existing) {
    return {
      competitionId,
      status: 'already_seeded',
      qualifiers: qualifiers.length,
      round1Matches: existing.rounds[0]?.matches.length ?? 0,
    };
  }

  const bracket = drawSingleElim(drawSeedSalt, qualifiers);

  const r1 = bracket.rounds[0];
  const r1KickoffIso = cupR1KickoffIso(Date.now());

  if (r1) {
    for (const m of r1.matches) {
      if (m.home_team_id !== null && m.away_team_id !== null) {
        const id = await insertCupMatch(
          db,
          competitionId,
          m.home_team_id,
          m.away_team_id,
          r1.name,
          r1KickoffIso,
        );
        m.match_db_id = id;
      }
    }
  }

  await insertCompetitionTeams(db, competitionId, qualifiers);
  await writeBracket(db, competitionId, bracket, /* setActive */ true);

  return {
    competitionId,
    status: 'seeded',
    qualifiers: qualifiers.length,
    round1Matches: r1?.matches.filter((m) => m.match_db_id !== null).length ?? 0,
  };
}

// ── Season-scoped competition resolution ─────────────────────────────────

/**
 * Resolve the 4 league competition IDs for a given season, sorted into the
 * canonical {@link LEAGUE_ID_ORDER}.
 *
 * WHY: the seeder used to read a hardcoded list of Season-1 league UUIDs, so
 * it only ever worked for Season 1.  Season 2+ competitions get fresh random
 * UUIDs (see seasonRollover.ts), so we must resolve them dynamically by
 * `(season_id, type='league')` and re-impose the canonical league order — the
 * downstream qualifier interleaving depends on that order, NOT on row order.
 *
 * Any competition whose `league_id` is not one of the four canonical slugs is
 * dropped (defensive — keeps a stray row from skewing the seeds).  Returns []
 * on DB error or empty result so the caller degrades gracefully.
 *
 * @param db        Supabase service-role client.
 * @param seasonId  Season UUID to resolve league competitions for.
 * @returns         Up to 4 competition IDs in canonical league order.
 */
async function resolveSeasonLeagueCompIds(
  db: any,
  seasonId: string,
): Promise<string[]> {
  const { data, error } = await db
    .from('competitions')
    .select('id, league_id')
    .eq('season_id', seasonId)
    .eq('type', 'league');

  if (error) {
    console.warn(`[resolveSeasonLeagueCompIds] ${seasonId} failed:`, error.message);
    return [];
  }

  type Row = { id: string; league_id: string | null };
  const rows = (data ?? []) as Row[];

  // Keep only canonical leagues, then sort by their canonical index so the
  // interleaving (Rocky Inner #1 → seed 1, …) matches the old hardcoded path.
  return rows
    .filter((r) => r.league_id !== null && LEAGUE_ID_ORDER.includes(r.league_id as any))
    .sort(
      (a, b) =>
        LEAGUE_ID_ORDER.indexOf(a.league_id as any) -
        LEAGUE_ID_ORDER.indexOf(b.league_id as any),
    )
    .map((r) => r.id);
}

/**
 * Resolve a season's two cup competition IDs by NAME.
 *
 * WHY name-matching (not a hardcoded UUID): Season 2+ cup rows carry fresh
 * random UUIDs but a stable, name-derived label.  seasonRollover names them
 * `Celestial Cup — Season N` / `Solar Shield — Season N`; Season 1 uses the
 * bare `Celestial Cup` / `Solar Shield`.  Substring matching covers both.
 *
 * A name containing "Celestial" maps to `celestialId`; a name containing
 * "Shield" (matches both "Solar Shield" and any future shield variant) maps to
 * `shieldId`.  Either is null when no matching cup row exists for the season.
 *
 * @param db        Supabase service-role client.
 * @param seasonId  Season UUID to resolve cup competitions for.
 * @returns         `{ celestialId, shieldId }`, each null when unresolved.
 */
async function resolveSeasonCupCompIds(
  db: any,
  seasonId: string,
): Promise<{ celestialId: string | null; shieldId: string | null }> {
  const { data, error } = await db
    .from('competitions')
    .select('id, name')
    .eq('season_id', seasonId)
    .eq('type', 'cup');

  if (error) {
    console.warn(`[resolveSeasonCupCompIds] ${seasonId} failed:`, error.message);
    return { celestialId: null, shieldId: null };
  }

  type Row = { id: string; name: string | null };
  const rows = (data ?? []) as Row[];

  let celestialId: string | null = null;
  let shieldId: string | null = null;
  for (const r of rows) {
    const name = r.name ?? '';
    if (celestialId === null && name.includes('Celestial')) celestialId = r.id;
    else if (shieldId === null && name.includes('Shield')) shieldId = r.id;
  }
  return { celestialId, shieldId };
}

// ── Public: seed both cups for a season ──────────────────────────────────

export interface SeedSeasonCupsResult {
  celestial: SeedCupResult;
  solarShield: SeedCupResult;
}

/**
 * SeedCupResult for a cup tier whose competition row could not be resolved for
 * the season (e.g. a missing or misnamed cup competition).  Carries an empty
 * competitionId and `no_qualifiers` so the return type stays valid and the
 * caller's logging/accounting still sees a row instead of a crash.
 */
function unresolvedCupResult(): SeedCupResult {
  return { competitionId: '', status: 'no_qualifiers', qualifiers: 0, round1Matches: 0 };
}

/**
 * Seed both Celestial Cup (top 3 per league) and Solar Shield (4th–6th per
 * league) for a season.  Resolves the season's OWN league + cup competitions
 * dynamically (works for any season, not just Season 1), reads each league's
 * current standings, splits qualifiers, draws both brackets, and persists
 * everything.  Idempotent: re-running for the same season is a no-op for any
 * cup that already has a stored bracket.
 *
 * If a cup competition cannot be resolved for the season, that tier returns an
 * {@link unresolvedCupResult} (a `no_qualifiers` row, logged) instead of
 * crashing — the other tier still seeds.
 *
 * @param db        Supabase service-role client.
 * @param seasonId  Season UUID (used to resolve competitions + as the draw salt).
 */
export async function seedCupCompetitions(
  db: any,
  seasonId: string,
): Promise<SeedSeasonCupsResult> {
  // Resolve THIS season's league competitions (in canonical order) and pull
  // their standings in parallel, preserving the resolved order.
  const leagueCompIds = await resolveSeasonLeagueCompIds(db, seasonId);
  const allStandings = await Promise.all(
    leagueCompIds.map((id) => getLeagueStandings(db, id)),
  );

  const celestialQualifiers   = buildQualifierSeeding(allStandings, [1, 2, 3]);
  const solarShieldQualifiers = buildQualifierSeeding(allStandings, [4, 5, 6]);

  // Resolve THIS season's cup competitions by name — fresh UUIDs each season.
  const { celestialId, shieldId } = await resolveSeasonCupCompIds(db, seasonId);

  if (celestialId === null) {
    console.warn(`[seedCupCompetitions] no Celestial Cup competition for season ${seasonId}`);
  }
  if (shieldId === null) {
    console.warn(`[seedCupCompetitions] no Solar Shield competition for season ${seasonId}`);
  }

  const [celestial, solarShield] = await Promise.all([
    celestialId !== null
      ? seedOneCup(db, celestialId, celestialQualifiers, `${seasonId}:celestial`)
      : Promise.resolve(unresolvedCupResult()),
    shieldId !== null
      ? seedOneCup(db, shieldId, solarShieldQualifiers, `${seasonId}:shield`)
      : Promise.resolve(unresolvedCupResult()),
  ]);

  return { celestial, solarShield };
}

// ── Public: advance a cup round after a match completes ──────────────────

export interface AdvanceCupRoundResult {
  competitionId: string;
  completedMatchId: string;
  completedRound: number;
  nextMatchSlot: number | null;
  nextMatchId: string | null;
  nextMatchAlreadyExisted: boolean;
}

/**
 * After a cup match completes, this function:
 *   1. Locates the match in the stored bracket via match_db_id
 *   2. Sets winner_team_id on that StoredBracketMatch
 *   3. Looks at the next-round match it feeds (via from_round / from_slot)
 *   4. Substitutes the winner into the next match's home or away slot
 *   5. If the next match now has BOTH teams known, inserts it into the
 *      matches table and records its match_db_id in the bracket
 *   6. Persists the updated bracket JSON
 *
 * No-op if the completed match isn't a cup match (returns null) or if the
 * bracket is already the Final (no next match to update).
 *
 * @param db              Supabase service-role client.
 * @param competitionId   Cup competition UUID.
 * @param matchId         UUID of the just-completed match.
 * @param winnerTeamId    Slug of the winning team.
 */
export async function advanceCupRound(
  db: any,
  competitionId: string,
  matchId: string,
  winnerTeamId: string,
): Promise<AdvanceCupRoundResult | null> {
  const bracket = await readBracket(db, competitionId);
  if (!bracket) return null;

  let completedRound = -1;
  let completedMatch: StoredBracketMatch | null = null;
  for (const round of bracket.rounds) {
    for (const m of round.matches) {
      if (m.match_db_id === matchId) {
        completedRound = round.round_number;
        completedMatch = m;
        break;
      }
    }
    if (completedMatch) break;
  }
  if (!completedMatch || completedRound < 0) return null;

  completedMatch.winner_team_id = winnerTeamId;

  const nextRoundIndex = bracket.rounds.findIndex(
    (r) => r.round_number === completedRound + 1,
  );
  if (nextRoundIndex === -1) {
    // Final completed — write back and return without next-round work.
    await writeBracket(db, competitionId, bracket, /* setActive */ false);
    return {
      competitionId,
      completedMatchId: matchId,
      completedRound,
      nextMatchSlot: null,
      nextMatchId: null,
      nextMatchAlreadyExisted: false,
    };
  }

  const nextRound = bracket.rounds[nextRoundIndex]!;
  const nextMatch = nextRound.matches.find(
    (m) =>
      (m.home_from_round === completedRound && m.home_from_slot === completedMatch!.slot) ||
      (m.away_from_round === completedRound && m.away_from_slot === completedMatch!.slot),
  );

  if (!nextMatch) {
    // Shouldn't happen for a well-formed bracket, but defend.
    await writeBracket(db, competitionId, bracket, /* setActive */ false);
    return null;
  }

  if (
    nextMatch.home_from_round === completedRound &&
    nextMatch.home_from_slot  === completedMatch.slot
  ) {
    nextMatch.home_team_id = winnerTeamId;
  } else {
    nextMatch.away_team_id = winnerTeamId;
  }

  let nextMatchId: string | null = nextMatch.match_db_id;
  let nextMatchAlreadyExisted = nextMatch.match_db_id !== null;

  if (
    nextMatch.home_team_id !== null &&
    nextMatch.away_team_id !== null &&
    nextMatch.match_db_id  === null
  ) {
    // Schedule the next round one cadence-interval from NOW (the moment this
    // round completed), so the fixture is always within the worker's claim
    // horizon — never an absolute in-universe date that drifts unreachable (#569).
    const kickoff = cupNextRoundKickoffIso(Date.now());

    const insertedId = await insertCupMatch(
      db,
      competitionId,
      nextMatch.home_team_id,
      nextMatch.away_team_id,
      nextRound.name,
      kickoff,
    );
    nextMatch.match_db_id = insertedId;
    nextMatchId = insertedId;
    nextMatchAlreadyExisted = false;
  }

  await writeBracket(db, competitionId, bracket, /* setActive */ false);

  return {
    competitionId,
    completedMatchId: matchId,
    completedRound,
    nextMatchSlot: nextMatch.slot,
    nextMatchId,
    nextMatchAlreadyExisted,
  };
}
