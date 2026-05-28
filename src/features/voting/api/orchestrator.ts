// ── voting/api/orchestrator.ts ───────────────────────────────────────────────
//
// runElectionNight — the orchestrator that turns voting tallies + active
// rosters into the ceremonial outcome at the `election_closed → completed`
// transition.
//
// WHY A SEPARATE FILE FROM election.ts
//   election.ts owns thin read/write helpers (one fetch / one mutation each).
//   The orchestrator coordinates many of those calls + the pure
//   electionLogic / decreeTemplates modules into a single Election Night.
//   Keeping the orchestration here keeps election.ts simple to grep and
//   surfaces this entry point in feature exports as a first-class concept.
//
// EXECUTION ORDER (per locked design 2026-05-06)
// ───────────────────────────────────────────────
//   1. Resolve focus winners per team from `focus_tally` view.
//   2. Build incineration candidate pool from active players + idol ranks.
//   3. Select 1–2 incineration targets via idol-weighted draw.
//   4. For each target: build decree text → call `incinerate_player` RPC.
//   5. Build all decree rows in display order:
//        a. proclamation (opens the ceremony)
//        b. focus_enacted rows (one per (team, tier) winner)
//        c. incineration rows (one per selected target)
//   6. Bulk-insert decrees via `insertSeasonDecrees`.
//   7. Emit `season.ended` on the bus so the existing `SeasonEnactmentListener`
//      runs `enactSeasonFocuses` and applies stat mutations.
//
// IDEMPOTENCY GUARDS
//   `enactSeasonFocuses` (Phase 4) is already idempotent via the UNIQUE
//   constraint on `focus_enacted (team_id, season_id, tier)`.  The
//   orchestrator itself is NOT yet idempotent — calling it twice for the
//   same season will write duplicate decrees and re-incinerate players.
//   We guard against that by gating callers on `season.status === 'completed'`:
//   the orchestrator runs as part of the phase advance and the advance step
//   updates status atomically afterwards.
//
// FIRE-AND-FORGET BUS EMIT
//   bus.emit() is synchronous; SeasonEnactmentListener handles its own async
//   work without awaiting.  We emit AFTER all DB writes succeed so a partial
//   failure doesn't trigger downstream enactment.

import { bus }                from '@shared/events/bus';
import type { IslSupabaseClient } from '@shared/supabase/client';
import { incinerate, insertSeasonDecrees, getSeasonFocusTally } from './election';
import type { SeasonDecree }      from './election';
import {
  resolveFocusWinners,
  selectIncinerationTargets,
  type IncinerationCandidate,
} from '../logic/electionLogic';
import {
  buildProclamationDecree,
  buildFocusEnactmentDecree,
  buildIncinerationDecree,
} from '../logic/decreeTemplates';
import {
  buildReplacementPlayer,
  type TeammateNameSeed,
} from '../logic/replacementPlayer';
import { buildArrivalNarrative } from '../logic/arrivalNarrative';
import {
  parseActivePlayerRows,
  parseIdolRankRows,
  parseTeamNameRows,
} from './orchestrator.schema';

// ── Tunables ────────────────────────────────────────────────────────────────

/**
 * Minimum number of incinerations rolled per Election Night.
 *
 * Locked design 2026-05-06 calls for 1–3 ceremonial incinerations.  We use
 * 1 as the floor so every Election Night has at least one moment of loss —
 * a season without any incineration would dilute the dread.
 */
const MIN_INCINERATIONS_PER_NIGHT = 1;

/**
 * Maximum number of incinerations rolled per Election Night.
 *
 * 2 as the ceiling keeps the ceremony pointed.  More than that and the
 * weight of each individual decree dilutes — Blaseball-style mass purges
 * are explicitly a Season-1 launch event, not the weekly cadence.
 */
const MAX_INCINERATIONS_PER_NIGHT = 2;

/**
 * sequence_order of the opening proclamation decree.  0 places it at the
 * very top of the Election Night ticker.
 */
const PROCLAMATION_SEQUENCE_ORDER = 0;

/**
 * sequence_order base value for focus-enacted decrees.  100 chosen so the
 * proclamation (0) is clearly first and incinerations (1000+) are clearly
 * last, with plenty of room for focus_enacted rows in between if a season
 * has 32 teams × 2 tiers = 64 enactments.
 */
const FOCUS_ENACTED_SEQUENCE_BASE = 100;

/**
 * sequence_order base value for incineration decrees.  Always > the highest
 * possible focus_enacted index so incinerations are guaranteed last per
 * `sortDecreesForElectionNight()`.
 */
const INCINERATION_SEQUENCE_BASE = 1000;

// ── Minimal row shapes the orchestrator needs ────────────────────────────────

/**
 * Subset of the players row required to:
 *  • Build incineration candidates (id, name, team_id)
 *  • Drive replacement-player name themes via the surviving teammate roster
 *    (nationality, position).  position is also the slot the replacement
 *    fills — we copy it verbatim from the incinerated player.
 */
interface ActivePlayerRow {
  id: string;
  name: string;
  team_id: string | null;
  nationality: string | null;
  position: string | null;
}

/** Subset of the `player_idol_score` view row used to look up idol rank. */
interface IdolRankRow {
  player_id: string | null;
  global_rank: number | null;
}

/** Subset of the teams row used to render team names in decree text. */
interface TeamNameRow {
  id: string;
  name: string;
}

// ── Result type ─────────────────────────────────────────────────────────────

/**
 * Summary returned by `runElectionNight` for logging and UI display.
 * Every field is plain data — trivially serialisable.
 */
export interface ElectionNightResult {
  /** Number of decree rows written (proclamation + focuses + incinerations). */
  decreesWritten: number;
  /** Number of players actually incinerated this Election Night. */
  incinerationsCount: number;
  /**
   * Number of replacement players generated and linked to their incineration
   * audit rows.  Equals incinerationsCount when replacement generation
   * succeeds for every incineration; smaller if a per-row failure (FK
   * violation, etc.) was caught and skipped.
   */
  replacementsGenerated: number;
  /** Number of teams whose focus winners were resolved. */
  teamFocusesResolved: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Pick an integer in `[min, max]` inclusive using the supplied RNG.
 * Used to decide how many players to incinerate per Election Night.
 *
 * @param min  Lowest allowed value.
 * @param max  Highest allowed value.
 * @param rng  Random source returning a number in [0, 1).
 */
function randomIntInclusive(min: number, max: number, rng: () => number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/**
 * Look up a team display name from a map, falling back to a neutral phrase
 * if the team row is missing.  Keeps decree text grammatical when a player
 * has somehow lost their `team_id` reference.
 */
function teamDisplay(teamId: string | null, teamNames: Map<string, string>): string {
  if (!teamId) return 'their team';
  return teamNames.get(teamId) ?? 'their team';
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Run the full Election Night ritual for a season:
 *  - resolve focus winners
 *  - pick 1-2 incineration targets via idol-weighted draw
 *  - call the atomic `incinerate_player` RPC for each
 *  - generate a replacement player for every successful incineration and
 *    link it back via incinerations.replacement_player_id
 *  - write the full decree row set
 *  - emit `season.ended` so downstream focus enactment fires
 *
 * Designed to be called from inside an `election_closed → completed` phase
 * advance.  The caller is responsible for actually updating
 * `seasons.status` to `completed` afterwards.
 *
 * NOT IDEMPOTENT — guard at the caller via `season.status` check.
 *
 * @param db        Injected Supabase client.
 * @param seasonId  UUID of the season being closed.
 * @param seasonName Human-readable season label for the bus payload.
 * @param rng       Random source (default Math.random).  Override for tests.
 * @returns         Summary counts for logging / UI.
 */
export async function runElectionNight(
  db: IslSupabaseClient,
  seasonId: string,
  seasonName: string,
  rng: () => number = Math.random,
): Promise<ElectionNightResult> {
  // ── Step 1: fetch focus tallies and resolve winners ───────────────────────
  const tallies      = await getSeasonFocusTally(db, seasonId);
  const focusWinners = resolveFocusWinners(tallies);

  // ── Step 2: fetch active players + idol ranks + team names in parallel ────
  // All three reads are independent; running them in parallel keeps the
  // ceremony latency low even on slow connections.  Raw rows pass through
  // the Zod parse helpers in orchestrator.schema (slice 6 of #386) so
  // a column rename in the DB drops the offending row with a warn-log
  // instead of corrupting the audit / decree write further down.
  const [playersResult, idolResult, teamsResult] = await Promise.all([
    (db as unknown as { from: (t: string) => { select: (s: string) => { eq: (c: string, v: boolean) => Promise<{ data: unknown[] | null; error: { message: string } | null }> } } })
      .from('players')
      .select('id, name, team_id, nationality, position')
      .eq('is_active', true),
    (db as unknown as { from: (t: string) => { select: (s: string) => Promise<{ data: unknown[] | null; error: { message: string } | null }> } })
      .from('player_idol_score')
      .select('player_id, global_rank'),
    (db as unknown as { from: (t: string) => { select: (s: string) => Promise<{ data: unknown[] | null; error: { message: string } | null }> } })
      .from('teams')
      .select('id, name'),
  ]);

  if (playersResult.error) throw new Error(`runElectionNight: players fetch failed: ${playersResult.error.message}`);
  if (idolResult.error)    throw new Error(`runElectionNight: idol fetch failed: ${idolResult.error.message}`);
  if (teamsResult.error)   throw new Error(`runElectionNight: teams fetch failed: ${teamsResult.error.message}`);

  const players: ActivePlayerRow[] = parseActivePlayerRows(playersResult.data ?? [], 'runElectionNight');
  const idolRows: IdolRankRow[]    = parseIdolRankRows(idolResult.data ?? [],     'runElectionNight');
  const teams:    TeamNameRow[]    = parseTeamNameRows(teamsResult.data ?? [],    'runElectionNight');

  // Build O(1) lookups so the candidate-building loop stays linear.
  const idolRankByPlayerId = new Map<string, number>();
  for (const row of idolRows) {
    if (row.player_id !== null && row.global_rank !== null) {
      idolRankByPlayerId.set(row.player_id, row.global_rank);
    }
  }
  const teamNameById = new Map<string, string>();
  for (const t of teams) teamNameById.set(t.id, t.name);

  // ── Step 3: build incineration candidates + pick targets ──────────────────
  // Every active player WITH a team is a candidate.  Orphan players
  // (team_id null — should never happen in production but defensive against
  // a transient FK state) are excluded because the decree text needs a
  // team name and `incinerations.team_id` is part of the audit trail.
  // selectIncinerationTargets handles the idol-weighted draw and the
  // without-replacement constraint.
  const candidates: IncinerationCandidate[] = players
    .filter((p): p is ActivePlayerRow & { team_id: string } => p.team_id !== null)
    .map(p => ({
      id:       p.id,
      name:     p.name,
      team_id:  p.team_id,
      idolRank: idolRankByPlayerId.get(p.id) ?? null,
    }));

  const incinerationCount = randomIntInclusive(
    MIN_INCINERATIONS_PER_NIGHT,
    MAX_INCINERATIONS_PER_NIGHT,
    rng,
  );
  const targets = selectIncinerationTargets(candidates, incinerationCount, rng);

  // Pre-index players by team for the replacement-player roster seed.
  // Built once before the incineration loop so each successful incinerate
  // can reach into the surviving roster of the same team in O(1).
  const playersByTeam = new Map<string, ActivePlayerRow[]>();
  for (const p of players) {
    if (!p.team_id) continue;
    if (!playersByTeam.has(p.team_id)) playersByTeam.set(p.team_id, []);
    playersByTeam.get(p.team_id)!.push(p);
  }

  // ── Step 4: execute incinerations via the atomic RPC ──────────────────────
  // We collect the generated decree text up-front so that even if a later
  // RPC throws, the partial set of completed incinerations still appears
  // in the season_decrees ticker.  The RPC is wrapped in try/catch to log
  // and skip a single failure rather than abort the whole ceremony — one
  // FK glitch must not kill the season.
  //
  // After each successful incinerate, the same loop generates a replacement
  // player to fill the empty roster slot.  See Step 4.5 below for the
  // rationale and failure-handling.  We track replacementsGenerated
  // separately from incinerationsCount so callers can tell when a
  // replacement insert failed without the incineration itself failing.
  const incinerationDecrees: Array<{ playerId: string | null; teamId: string | null; text: string }> = [];
  let replacementsGenerated = 0;
  for (const target of targets) {
    const teamName  = teamDisplay(target.candidate.team_id, teamNameById);
    const decreeText = buildIncinerationDecree(
      target.candidate.name,
      teamName,
      target.candidate.idolRank,
      rng,
    );
    let auditId: string | null = null;
    try {
      auditId = await incinerate(
        db,
        target.candidate.id,
        seasonId,
        target.candidate.team_id ?? '',
        target.candidate.idolRank,
        decreeText,
      );
      incinerationDecrees.push({
        playerId: target.candidate.id,
        teamId:   target.candidate.team_id,
        text:     decreeText,
      });
    } catch (err) {
      // Log and skip — never abort the whole ceremony for one bad row.
      // The atomic RPC means the player+audit pair never half-commits, so
      // a skip here is safe: the player stays alive and no orphan audit
      // row exists.
      console.error(
        `[runElectionNight] incinerate failed for ${target.candidate.name} (${target.candidate.id}):`,
        err,
      );
      continue; // No audit row exists, so skip replacement-generation too.
    }

    // ── Step 4.5: generate the replacement player ──────────────────────────
    // Each successful incineration immediately seeds a replacement so the
    // roster doesn't shrink over seasons.  Failure here is logged but does
    // NOT roll back the incineration — the dead player stays dead even if
    // their successor can't be inserted.  An orphan empty slot is recoverable
    // (admin tooling can backfill later); a half-completed incineration is
    // not.
    //
    // The original incinerated player is still present in `players` (just
    // marked is_active=false), but for naming-pool purposes we want only
    // the SURVIVING teammates — so we filter out the freshly-incinerated id.
    try {
      // Find the player row for the incinerated target to copy position +
      // nationality.  The orchestrator's earlier filter dropped null team_ids
      // so this lookup is guaranteed to find a row for any target that made
      // it into the incineration loop.
      const incineratedRow = players.find(p => p.id === target.candidate.id);
      const teamRoster = (playersByTeam.get(target.candidate.team_id) ?? [])
        .filter(p => p.id !== target.candidate.id);

      const teammateSeeds: TeammateNameSeed[] = teamRoster.map(p => ({
        name:        p.name,
        nationality: p.nationality,
      }));

      const replacement = buildReplacementPlayer(
        {
          teamId:              target.candidate.team_id,
          position:            incineratedRow?.position ?? 'MF',
          teammates:           teammateSeeds,
          fallbackNationality: incineratedRow?.nationality ?? 'Unknown',
        },
        rng,
      );

      // Insert the new player and capture the generated UUID so we can
      // write it back into incinerations.replacement_player_id.
      type ReplacementInsertResult = {
        data:  { id: string } | null;
        error: { message: string } | null;
      };
      const insertResult = await (
        db as unknown as {
          from: (t: string) => {
            insert: (row: typeof replacement) => {
              select: (s: string) => {
                single: () => Promise<ReplacementInsertResult>;
              };
            };
          };
        }
      )
        .from('players')
        .insert(replacement)
        .select('id')
        .single();

      if (insertResult.error) throw new Error(insertResult.error.message);
      const newPlayerId = insertResult.data?.id;
      if (!newPlayerId) throw new Error('replacement insert returned no id');

      // Link the new player back to the audit row.  RLS allows
      // authenticated users to UPDATE incinerations columns they own; if
      // production tightens that, the orchestrator would need a SECURITY
      // DEFINER RPC for this update (analogous to incinerate_player).
      if (auditId) {
        const updateResult = await (
          db as unknown as {
            from: (t: string) => {
              update: (patch: Record<string, unknown>) => {
                eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
              };
            };
          }
        )
          .from('incinerations')
          .update({ replacement_player_id: newPlayerId })
          .eq('id', auditId);
        if (updateResult.error) {
          // FK link failure is non-critical — the replacement still lives,
          // the incineration audit row still lives, they're just unlinked.
          // /lost can fall back to the season_id + team_id pairing.
          console.error(
            `[runElectionNight] replacement link failed for audit ${auditId}:`,
            updateResult.error.message,
          );
        }
      }

      // ── Step 4.6: announce the arrival as a news narrative ─────────────
      // Closes the lore loop on the incineration: every loss has a
      // successor the cosmos formally introduces.  Failure here is logged
      // and skipped — the player and audit row both already exist; a
      // missing news post is recoverable (admin tooling can backfill) and
      // never block the ceremony from continuing to the next target.
      //
      // The narrative kind is 'new_arrival' (recognised by NewsFeedPage's
      // filter strip).  entities_involved=[] because the new player isn't
      // an entity_id (players belong to the players table, not entities).
      // source='ceremony' marks it as Election-Night-emitted, keeping it
      // distinct from the 'scheduled' content the galaxy-tick cron emits.
      try {
        const arrivalSummary = buildArrivalNarrative(
          {
            newPlayerName:         replacement.name,
            teamName:              teamName,
            incineratedPlayerName: target.candidate.name,
            position:              replacement.position,
            age:                   replacement.age,
            nationality:           replacement.nationality,
          },
          rng,
        );
        const narrativeResult = await (
          db as unknown as {
            from: (t: string) => {
              insert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
            };
          }
        )
          .from('narratives')
          .insert({
            kind:              'new_arrival',
            summary:           arrivalSummary,
            entities_involved: [],
            source:            'ceremony',
          });
        if (narrativeResult.error) {
          console.error(
            `[runElectionNight] arrival narrative insert failed for ${replacement.name}:`,
            narrativeResult.error.message,
          );
        }
      } catch (err) {
        console.error(
          `[runElectionNight] arrival narrative threw for ${replacement.name}:`,
          err,
        );
      }

      replacementsGenerated += 1;
    } catch (err) {
      console.error(
        `[runElectionNight] replacement generation failed for ${target.candidate.name}:`,
        err,
      );
    }
  }

  // ── Step 5: build the full decree row set ─────────────────────────────────
  // Ordering by sequence_order is what the Election Night ticker uses to
  // render the ceremony.  Constants above guarantee proclamation < focuses
  // < incinerations regardless of how many rows fall in each bucket.
  const decrees: Omit<SeasonDecree, 'id' | 'created_at'>[] = [];

  // 5a. Proclamation opener — one per season.
  decrees.push({
    season_id:      seasonId,
    decree_type:    'proclamation',
    player_id:      null,
    team_id:        null,
    text:           buildProclamationDecree(rng),
    sequence_order: PROCLAMATION_SEQUENCE_ORDER,
  });

  // 5b. Focus-enacted decrees — major then minor for each team, sorted by
  // team_id for deterministic ordering when multiple teams enact in the
  // same season.  This isn't strictly required for correctness but keeps
  // test snapshots stable.
  const sortedTeamIds = [...focusWinners.keys()].sort();
  let focusSequence = FOCUS_ENACTED_SEQUENCE_BASE;
  for (const teamId of sortedTeamIds) {
    const winners = focusWinners.get(teamId)!;
    const teamName = teamNameById.get(teamId) ?? 'their team';

    // Major tier first — it's the bigger story, fans hear it before minor.
    if (winners.major) {
      decrees.push({
        season_id:      seasonId,
        decree_type:    'focus_enacted',
        player_id:      null,
        team_id:        teamId,
        text:           buildFocusEnactmentDecree(teamName, winners.major.label, 'major', rng),
        sequence_order: focusSequence++,
      });
    }
    if (winners.minor) {
      decrees.push({
        season_id:      seasonId,
        decree_type:    'focus_enacted',
        player_id:      null,
        team_id:        teamId,
        text:           buildFocusEnactmentDecree(teamName, winners.minor.label, 'minor', rng),
        sequence_order: focusSequence++,
      });
    }
  }

  // 5c. Incineration decrees — last in the ticker (always after focuses).
  let incinerationSequence = INCINERATION_SEQUENCE_BASE;
  for (const inc of incinerationDecrees) {
    decrees.push({
      season_id:      seasonId,
      decree_type:    'incineration',
      player_id:      inc.playerId,
      team_id:        inc.teamId,
      text:           inc.text,
      sequence_order: incinerationSequence++,
    });
  }

  // ── Step 6: persist the decree set ────────────────────────────────────────
  if (decrees.length > 0) {
    await insertSeasonDecrees(db, decrees);
  }

  // ── Step 7: fire the bus event so focus enactment runs ────────────────────
  // Emitted AFTER all DB writes succeed so a partial failure doesn't
  // trigger downstream stat mutations against a broken ceremony.
  bus.emit('season.ended', { seasonId, seasonName });

  return {
    decreesWritten:        decrees.length,
    incinerationsCount:    incinerationDecrees.length,
    replacementsGenerated,
    teamFocusesResolved:   sortedTeamIds.length,
  };
}
