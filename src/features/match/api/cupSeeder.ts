// ── match/api/cupSeeder.ts ────────────────────────────────────────────────────
// WHY: After Season 1's league phase finishes, the top 3 finishers in each of
// the 4 round-robin leagues qualify for the Celestial Cup; 4th–6th go to the
// Solar Shield. This module is the bridge between league standings and a
// playable knockout: it queries standings, applies the 1..12 seeding rule,
// runs `drawSingleElim()` to build the bracket, persists the JSON to
// `competitions.bracket`, inserts the Round 1 fixtures, and (later) advances
// the bracket as each match completes.
//
// SEEDING RULE (deterministic across the 4 leagues):
//   For each league, the top finisher is seeded ahead of the runner-up, etc.
//   Then leagues are interleaved in a fixed order so the Rocky Inner #1 is
//   the overall #1 seed, the Gas/Ice Giants #1 is #2, the Asteroid Belt #1 is
//   #3, the Kuiper Belt #1 is #4, then Rocky Inner #2 is #5, and so on.
//   This produces a stable seed list of length 12 (Celestial: positions 1–3
//   per league; Shield: 4th–6th per league).
//
// DB WRITES:
//   1. UPDATE competitions SET bracket = <full JSON>, status = 'active'
//   2. INSERT INTO matches (...) for every Round 1 match where both teams are
//      known. Later rounds are inserted by `advanceCupRound` as winners
//      emerge — the matches table has a UNIQUE(competition_id,
//      home_team_id, away_team_id) constraint, so we can't pre-insert TBD
//      placeholder rows.
//   3. INSERT INTO competition_teams (...) for all 12 qualifiers, with
//      `seeding` set to their bracket seed.
//   4. UPDATE competitions.bracket with `match_db_id` filled in for each
//      inserted match (so advanceCupRound can find them later).
//
// IDEMPOTENCY: Re-running on a competition that already has a bracket is a
// no-op (returns immediately). Match inserts use ON CONFLICT DO NOTHING via
// the existing UNIQUE constraint, so repeated runs are safe.

import type { IslSupabaseClient } from '@shared/supabase/client';
import {
  drawSingleElim,
  type BracketTeam,
  type StoredBracket,
  type StoredBracketMatch,
} from '../logic/cupDraw';

// TYPE ESCAPE HATCH — `competitions.bracket` is a new column not yet in the
// generated `database.ts`. Re-cast once `generate_typescript_types` is rerun.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

// ── Constants ────────────────────────────────────────────────────────────────

/** Well-known UUIDs of the 4 league competitions seeded in migration 0009. */
const LEAGUE_COMPETITION_IDS = [
  '10000000-0000-0000-0000-000000000001', // Rocky Inner
  '10000000-0000-0000-0000-000000000002', // Gas/Ice Giants
  '10000000-0000-0000-0000-000000000003', // Asteroid Belt
  '10000000-0000-0000-0000-000000000004', // Kuiper Belt
] as const;

/** Cup competition UUIDs from migration 0012. */
export const CELESTIAL_CUP_COMPETITION_ID = '20000000-0000-0000-0000-000000000002';
export const SOLAR_SHIELD_COMPETITION_ID  = '20000000-0000-0000-0000-000000000003';

/**
 * Cup R1 kickoff date (Season 1). League round-robin schedule ends mid-July;
 * cups start the following week. Matches are then spaced by 7 days per round,
 * mirroring the cadence used by `0009_seed_league_fixtures.sql`.
 */
const CUP_R1_KICKOFF_ISO = '2600-08-04T19:00:00Z';
const ROUND_INTERVAL_MS  = 7 * 24 * 60 * 60 * 1000;

// ── Standings query ──────────────────────────────────────────────────────────

interface MatchRow {
  home_team_id: string;
  away_team_id: string;
  home_score:   number;
  away_score:   number;
}

/** One row in the league table. Teams sorted descending by points → GD → GF. */
interface StandingRow {
  team_id: string;
  team_name: string;
  played: number;
  won:    number; drawn: number; lost: number;
  gf:     number; ga:    number; gd:   number;
  points: number;
}

/**
 * Pure standings calculator. Takes raw completed-match rows and a team-name
 * lookup, returns sorted standings. Mirrors the JS `getStandings()` algorithm
 * in `src/lib/supabase.js:666–725` exactly: 3/1/0 points, tiebreaker chain
 * points → goal difference → goals scored.
 *
 * Extracted from the DB call so it can be unit-tested without Supabase.
 */
export function computeStandings(
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
 * compute its standings via `computeStandings()`.
 */
async function getLeagueStandings(
  db: IslSupabaseClient,
  competitionId: string,
): Promise<StandingRow[]> {
  const { data, error } = await (db as AnyDb) // CAST:cupSeeder
    .from('matches')
    .select(
      'home_team_id, away_team_id, home_score, away_score,' +
      ' home_team:teams!matches_home_team_id_fkey(id, name),' +
      ' away_team:teams!matches_away_team_id_fkey(id, name)'
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

// ── Qualifier selection ──────────────────────────────────────────────────────

/**
 * Build the seeded qualifier list for one cup tier across all 4 leagues.
 *
 * @param leagueStandings Each league's full sorted standings.
 * @param positions       1-indexed positions to take per league:
 *                        Celestial = [1,2,3]; Shield = [4,5,6].
 * @returns               12 BracketTeam rows with seeds 1..12. League #1
 *                        finishers occupy seeds 1..4 (one per league); league
 *                        #2 finishers occupy seeds 5..8; etc. — interleaving
 *                        ensures league strength is balanced across the
 *                        bracket halves.
 */
export function buildQualifierSeeding(
  leagueStandings: StandingRow[][],
  positions: number[],
): BracketTeam[] {
  const out: BracketTeam[] = [];
  let seed = 1;
  for (const pos of positions) {
    for (const standings of leagueStandings) {
      // Position is 1-indexed; convert to array index. Skip if league is short.
      const row = standings[pos - 1];
      if (!row) continue;
      out.push({ team_id: row.team_id, team_name: row.team_name, seed });
      seed++;
    }
  }
  return out;
}

// ── Match insertion ──────────────────────────────────────────────────────────

/**
 * Insert one cup match row and return its DB UUID.
 * Returns null on conflict (already exists) or any insert failure.
 */
async function insertCupMatch(
  db: IslSupabaseClient,
  competitionId: string,
  homeTeamId: string,
  awayTeamId: string,
  roundName: string,
  scheduledAtIso: string,
): Promise<string | null> {
  const { data, error } = await (db as AnyDb) // CAST:cupSeeder
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
    // ON CONFLICT: row already exists. Look it up so the bracket JSON can
    // still record its match_db_id for advanceCupRound's lookups.
    if (error.code === '23505') {
      const { data: existing } = await (db as AnyDb) // CAST:cupSeeder
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
 * Insert competition_teams rows for the qualifiers. Each row carries the
 * team's `seeding` so the cup page UI can render seeds without recomputing.
 */
async function insertCompetitionTeams(
  db: IslSupabaseClient,
  competitionId: string,
  teams: BracketTeam[],
): Promise<void> {
  if (teams.length === 0) return;
  const rows = teams.map((t) => ({
    competition_id: competitionId,
    team_id:        t.team_id,
    seeding:        t.seed,
  }));
  const { error } = await (db as AnyDb) // CAST:cupSeeder
    .from('competition_teams')
    .upsert(rows, { onConflict: 'competition_id,team_id' });
  if (error) {
    console.warn(`[insertCompetitionTeams] ${competitionId} failed:`, error.message);
  }
}

// ── Bracket persistence ──────────────────────────────────────────────────────

/**
 * Write the full bracket JSON + status update to the competitions row.
 */
async function writeBracket(
  db: IslSupabaseClient,
  competitionId: string,
  bracket: StoredBracket,
  setActive: boolean,
): Promise<void> {
  const update: Record<string, unknown> = { bracket };
  if (setActive) update['status'] = 'active';
  const { error } = await (db as AnyDb) // CAST:cupSeeder
    .from('competitions')
    .update(update)
    .eq('id', competitionId);
  if (error) {
    console.warn(`[writeBracket] ${competitionId} failed:`, error.message);
  }
}

/**
 * Read the stored bracket JSON for a competition. Returns null if the
 * competition has not been seeded yet (bracket column is NULL).
 */
async function readBracket(
  db: IslSupabaseClient,
  competitionId: string,
): Promise<StoredBracket | null> {
  const { data, error } = await (db as AnyDb) // CAST:cupSeeder
    .from('competitions')
    .select('bracket')
    .eq('id', competitionId)
    .single();
  if (error || !data) return null;
  return ((data as { bracket?: StoredBracket | null }).bracket) ?? null;
}

// ── Public: seed one cup ─────────────────────────────────────────────────────

/**
 * Result of seeding one cup competition.
 */
export interface SeedCupResult {
  competitionId: string;
  status: 'seeded' | 'already_seeded' | 'no_qualifiers';
  qualifiers: number;
  round1Matches: number;
}

/**
 * Seed one cup competition: draw the bracket, insert competition_teams +
 * Round 1 matches, persist the bracket JSON, and flip the competition status
 * to 'active'.
 *
 * Idempotent: if the competition already has a stored bracket, returns
 * `already_seeded` without re-running the draw.
 *
 * @param db             Injected Supabase client.
 * @param competitionId  Cup competition UUID (Celestial or Solar Shield).
 * @param qualifiers     Pre-seeded BracketTeam list, length up to 16.
 * @param drawSeedSalt   Salt string for `drawSingleElim()` determinism.
 *                       Recommended: `${seasonId}:celestial` etc.
 */
export async function seedOneCup(
  db: IslSupabaseClient,
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

  // Pure draw — yields full StoredBracket with TBD slots in later rounds.
  const bracket = drawSingleElim(drawSeedSalt, qualifiers);

  // Insert Round 1 matches: any match where BOTH teams are already known.
  // Later-round matches stay TBD until advanceCupRound creates them.
  const r1 = bracket.rounds[0];
  const r1KickoffMs = Date.parse(CUP_R1_KICKOFF_ISO);

  if (r1) {
    for (const m of r1.matches) {
      if (m.home_team_id !== null && m.away_team_id !== null) {
        const id = await insertCupMatch(
          db,
          competitionId,
          m.home_team_id,
          m.away_team_id,
          r1.name,
          new Date(r1KickoffMs).toISOString(),
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

// ── Public: seed both cups for a season ──────────────────────────────────────

/**
 * Result of seeding both Celestial Cup and Solar Shield for a season.
 */
export interface SeedSeasonCupsResult {
  celestial: SeedCupResult;
  solarShield: SeedCupResult;
}

/**
 * Seed both Celestial Cup (top 3 per league) and Solar Shield (4th–6th per
 * league) for a season. Reads each league's current standings, splits
 * qualifiers, draws both brackets, and persists everything.
 *
 * Idempotent: re-running for the same season is a no-op for any cup that
 * already has a stored bracket.
 *
 * @param db        Injected Supabase client.
 * @param seasonId  Season UUID (used in the deterministic draw salt).
 */
export async function seedCupCompetitions(
  db: IslSupabaseClient,
  seasonId: string,
): Promise<SeedSeasonCupsResult> {
  // Pull standings for all 4 leagues in parallel.
  const allStandings = await Promise.all(
    LEAGUE_COMPETITION_IDS.map((id) => getLeagueStandings(db, id)),
  );

  const celestialQualifiers   = buildQualifierSeeding(allStandings, [1, 2, 3]);
  const solarShieldQualifiers = buildQualifierSeeding(allStandings, [4, 5, 6]);

  const [celestial, solarShield] = await Promise.all([
    seedOneCup(db, CELESTIAL_CUP_COMPETITION_ID, celestialQualifiers, `${seasonId}:celestial`),
    seedOneCup(db, SOLAR_SHIELD_COMPETITION_ID,  solarShieldQualifiers, `${seasonId}:shield`),
  ]);

  return { celestial, solarShield };
}

// ── advanceCupRound ──────────────────────────────────────────────────────────

/**
 * After a cup match completes, this function:
 *   1. Locates the match in the stored bracket via `match_db_id`.
 *   2. Sets `winner_team_id` on that StoredBracketMatch.
 *   3. Looks at the next-round match it feeds (via the `from_round` /
 *      `from_slot` references in subsequent matches).
 *   4. Substitutes the winner into the next match's home or away slot.
 *   5. If the next match now has BOTH teams known, inserts it into the
 *      `matches` table and records its `match_db_id` in the bracket.
 *   6. Persists the updated bracket JSON back to `competitions.bracket`.
 *
 * No-op if the completed match isn't a cup match (returns null) or if the
 * bracket is already the Final (no next match to update).
 *
 * @param db              Injected Supabase client.
 * @param competitionId   Cup competition UUID.
 * @param matchId         UUID of the just-completed match.
 * @param winnerTeamId    Slug of the winning team.
 * @returns               Result describing what was advanced, or null if no
 *                        action was taken.
 */
export interface AdvanceCupRoundResult {
  /** The competition this match belongs to. */
  competitionId: string;
  /** The match that was completed (input echo). */
  completedMatchId: string;
  /** Round number containing the completed match. */
  completedRound: number;
  /** The next-round match's slot, or null if no next round. */
  nextMatchSlot: number | null;
  /** UUID of the next-round match if it was just created, else null. */
  nextMatchId: string | null;
  /** True if the next round match already had a DB row. */
  nextMatchAlreadyExisted: boolean;
}

export async function advanceCupRound(
  db: IslSupabaseClient,
  competitionId: string,
  matchId: string,
  winnerTeamId: string,
): Promise<AdvanceCupRoundResult | null> {
  const bracket = await readBracket(db, competitionId);
  if (!bracket) return null;

  // ── Locate the completed match in the bracket ────────────────────────────
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

  // Mark the winner. Idempotent — overwriting with the same value is harmless.
  completedMatch.winner_team_id = winnerTeamId;

  // ── Find the next-round match this winner feeds ──────────────────────────
  // The next-round match has either home_from_round/slot or
  // away_from_round/slot pointing at (completedRound, completedMatch.slot).
  const nextRoundIndex = bracket.rounds.findIndex(
    (r) => r.round_number === completedRound + 1,
  );
  if (nextRoundIndex === -1) {
    // Final completed — write back and return.
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
    // Should not happen for a well-formed bracket, but be safe.
    await writeBracket(db, competitionId, bracket, /* setActive */ false);
    return null;
  }

  // ── Slot the winner into the next match ──────────────────────────────────
  if (
    nextMatch.home_from_round === completedRound &&
    nextMatch.home_from_slot  === completedMatch.slot
  ) {
    nextMatch.home_team_id = winnerTeamId;
  } else {
    nextMatch.away_team_id = winnerTeamId;
  }

  // ── If both teams in the next match are now known, insert it ─────────────
  let nextMatchId: string | null = nextMatch.match_db_id;
  let nextMatchAlreadyExisted = nextMatch.match_db_id !== null;

  if (
    nextMatch.home_team_id !== null &&
    nextMatch.away_team_id !== null &&
    nextMatch.match_db_id  === null
  ) {
    // Schedule this round one week after the previous round's R1 base time
    // for simplicity. Real product would compute from the previous round's
    // actual scheduled_at; for the seeded cup that's the R1 base + n weeks.
    const baseMs    = Date.parse(CUP_R1_KICKOFF_ISO);
    const offsetMs  = (completedRound) * ROUND_INTERVAL_MS; // next round is +N weeks
    const kickoff   = new Date(baseMs + offsetMs).toISOString();

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

  // ── Persist bracket changes ──────────────────────────────────────────────
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
