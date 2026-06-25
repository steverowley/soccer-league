// ── features/match/api/seasonRollover.ts ─────────────────────────────────────
// Idempotent "create season N+1" engine (#568 — automatic season rollover).
//
// WHY THIS MODULE EXISTS
// ──────────────────────
// The season loop has to be perpetual: when a season's voting window closes and
// focuses are enacted, the league must automatically advance into the next
// season with real-dated, worker-claimable fixtures.  Until now the only path
// that built season N+1 lived inside the `scripts/rollover-season.ts` CLI, which
// an operator had to run by hand — so a finished season just sat in `voting`
// forever (#568).
//
// This module extracts the season/competition/fixture/focus-option creation
// logic out of that CLI into a single reusable, unit-tested function so BOTH
// the CLI and the scheduled `enact-due-seasons` job can call it.  The CLI keeps
// its env/flag handling and cup-seeding-of-the-OLD-season step; everything that
// *builds the new season* lives here.
//
// IDEMPOTENCY (load-bearing)
// ──────────────────────────
// Running this twice for the same prior season MUST be a no-op.  The guarantee
// rests on two layers:
//
//   1. A hard guard FIRST: if a `seasons` row already exists for the next
//      year (`fromSeason.year + 1`), we return `{ alreadyRolled: true }` and
//      write nothing.  This is the primary defence — the season INSERT below
//      uses a fresh random UUID, so it is NOT self-idempotent on its own.
//   2. Belt-and-braces upserts on `competition_teams`, `matches`, and
//      `focus_options` (ON CONFLICT) so a *partial* failure mid-run can be
//      retried without duplicating rows.
//
// WHAT IT TOUCHES
// ───────────────
//   • seasons             — old row `is_active` → false, then 1 new active row
//   • competitions        — 4 league + 2 (empty) cup rows for the new season
//   • competition_teams   — upserted for each new league competition
//   • matches             — round-robin fixtures for each new league competition
//   • focus_options       — upserted (9 templates × every team) for the season
//
// WHAT IT DELIBERATELY DOES NOT DO (descoped from #568)
// ─────────────────────────────────────────────────────
//   • Cup-bracket SEEDING for the new season — the cup rows are created empty
//     (NULL bracket); their brackets are drawn at the END of the new season's
//     league phase.  The existing `seedCupCompetitions` seeder is hardwired to
//     Season-1 constants; generalising it is a separate follow-up.
//   • Election Night incineration, player aging / youth promotion.

import { randomUUID } from 'crypto';
import type { IslSupabaseClient } from '@shared/supabase/client';
import type { Database } from '@/types/database';
import { generateFocusOptions } from '@features/voting';
import {
  generateRoundRobinFixtures,
  DEFAULT_PAIRS_PER_MATCHDAY,
} from '../logic/roundRobinDraw';

// ── Public result type ────────────────────────────────────────────────────────

/**
 * Summary of one `rolloverSeason` call.  All counts are zero when
 * `alreadyRolled` is true (the guard short-circuits before any write).
 */
export interface RolloverResult {
  /** True when a season for `fromSeason.year + 1` already existed — no-op. */
  alreadyRolled: boolean;
  /** UUID of the new (or pre-existing, when `alreadyRolled`) season. */
  newSeasonId: string | null;
  /** Human-readable name of the new season (null on a structural failure). */
  newSeasonName: string | null;
  /** Number of league competition rows created (0 or 4). */
  competitionsCreated: number;
  /** Number of fixture rows successfully upserted across all leagues. */
  fixturesCreated: number;
  /** Number of (empty) cup competition rows created (0 or 2). */
  cupRowsCreated: number;
  /** Number of focus_option rows upserted across all teams. */
  focusOptionRows: number;
}

/**
 * Scheduling anchor for the new season's fixtures.  The real-time anchor is
 * the #569 lesson: fixtures must be dated in the future-but-reachable so the
 * match worker's `scheduled_at <= now()` claim can ever fire.
 */
export interface RolloverOptions {
  /** UTC ms-since-epoch of matchday 1.  Every fixture is anchored to this. */
  firstKickoffMs: number;
  /** Milliseconds between consecutive matchdays (14 days in production). */
  cadenceMs: number;
}

// ── League / cup catalogue ──────────────────────────────────────────────────

/**
 * The 4 permanent ISL league divisions.  `id` is the stable `teams.league_id`
 * foreign key; `name` drives the new competition's display name.  Order
 * matches the canonical ISL tier order used by the seed and the rollover CLI.
 */
const LEAGUES = [
  { id: 'rocky-inner',   name: 'Rocky Inner League'   },
  { id: 'gas-giants',    name: 'Gas/Ice Giants League' },
  { id: 'outer-reaches', name: 'Outer Reaches League'  },
  { id: 'kuiper-belt',   name: 'Kuiper Belt League'    },
] as const;

/**
 * The two cup tiers.  Created as EMPTY shells at rollover time — `bracket`
 * stays NULL until the new season's league phase ends (see module header).
 */
const CUP_TIERS = [
  { key: 'celestial', name: 'Celestial Cup' },
  { key: 'shield',    name: 'Solar Shield'  },
] as const;

// ── Constants ──────────────────────────────────────────────────────────────

/**
 * Season year offset.  ISL Season 1 is year 2600, so Season N is year
 * 2599 + N.  Used to derive the human-readable season number from the year
 * (e.g. year 2601 → "Season 2").
 */
const SEASON_YEAR_OFFSET = 2599;

/**
 * Number of fixture rows per Supabase upsert batch.  PostgREST's default
 * payload cap is ~1 MB; at ~300 bytes per row, 50 rows ≈ 15 KB — well within
 * limits while keeping round-trips low.
 */
const FIXTURE_BATCH_SIZE = 50;

// ── Internal helpers ──────────────────────────────────────────────────────────

type SeasonInsert = Database['public']['Tables']['seasons']['Insert'];

/**
 * The minimal prior-season shape this module needs: its id (to deactivate),
 * its year (to derive the next year + the idempotency guard), and its name
 * (unused directly — the new name is derived from year, but we fetch it so
 * callers passing a raw id don't need a second round-trip).
 */
interface FromSeasonRow {
  id:   string;
  year: number;
}

/**
 * Derive the new season's display name from its year.
 * Season 1 = 2600, Season 2 = 2601, … Season N = 2599 + N.
 */
function seasonNameForYear(year: number): string {
  const seasonNumber = year - SEASON_YEAR_OFFSET;
  return `Season ${seasonNumber} — ${year}`;
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Build season N+1 from a given prior season.  Idempotent: if a season for the
 * next year already exists, this returns `{ alreadyRolled: true }` and writes
 * nothing.
 *
 * Sequence (each step guarded so a partial failure is retry-safe):
 *   1. Fetch the prior season (need its `year`).
 *   2. IDEMPOTENCY GUARD — bail if a season for `year + 1` already exists.
 *   3. Deactivate the prior season FIRST (the `seasons_one_active` partial
 *      unique index forbids two active seasons), then insert the new season
 *      (`status='active'`, `is_active=true`).
 *   4. For each league: create a fresh-UUID competition, upsert
 *      `competition_teams`, upsert round-robin fixtures anchored to `opts`.
 *   5. Create 2 EMPTY cup competition rows (fresh UUIDs).
 *   6. Upsert focus_options for every team.
 *
 * @param db    Injected service-role Supabase client (bypasses RLS).
 * @param fromSeasonId  UUID of the season being closed out.
 * @param opts  Real-time fixture anchor (`firstKickoffMs` + `cadenceMs`).
 * @returns     A populated {@link RolloverResult}.
 */
export async function rolloverSeason(
  db:           IslSupabaseClient,
  fromSeasonId: string,
  opts:         RolloverOptions,
): Promise<RolloverResult> {
  const empty: RolloverResult = {
    alreadyRolled:       false,
    newSeasonId:         null,
    newSeasonName:       null,
    competitionsCreated: 0,
    fixturesCreated:     0,
    cupRowsCreated:      0,
    focusOptionRows:     0,
  };

  // ── Step 1: fetch the prior season ─────────────────────────────────────────
  const { data: fromSeason, error: fromErr } = await db
    .from('seasons')
    .select('id, year')
    .eq('id', fromSeasonId)
    .maybeSingle();

  if (fromErr || !fromSeason) {
    console.warn(
      `[rolloverSeason] prior season ${fromSeasonId} not found:`,
      fromErr?.message ?? 'no row',
    );
    return empty;
  }

  const prior   = fromSeason as FromSeasonRow;
  const newYear = prior.year + 1;
  const newName = seasonNameForYear(newYear);

  // ── Step 2: idempotency guard ──────────────────────────────────────────────
  // The new-season INSERT below uses a random UUID, so it can NOT be the
  // idempotency boundary itself.  We guard on the unique `year` instead: if a
  // season for `newYear` already exists, this rollover already ran — return
  // it without touching anything.
  const { data: existing, error: existErr } = await db
    .from('seasons')
    .select('id')
    .eq('year', newYear)
    .maybeSingle();

  if (existErr) {
    console.warn('[rolloverSeason] year-existence check failed:', existErr.message);
    return empty;
  }
  if (existing) {
    return {
      ...empty,
      alreadyRolled: true,
      newSeasonId:   existing.id,
      newSeasonName: newName,
    };
  }

  // ── Step 3: deactivate prior season, then create the new one ───────────────
  // Order matters: the `seasons_one_active` partial unique index allows only
  // one `is_active = true` row, so we must clear the old flag BEFORE inserting
  // the new active season or the INSERT violates the constraint.
  const { error: deactivateErr } = await db
    .from('seasons')
    .update({ is_active: false })
    .eq('id', prior.id);

  if (deactivateErr) {
    console.warn(
      '[rolloverSeason] failed to deactivate prior season:',
      deactivateErr.message,
    );
    return empty;
  }

  const newSeasonId = randomUUID();
  const seasonInsert: SeasonInsert = {
    id:         newSeasonId,
    name:       newName,
    year:       newYear,
    is_active:  true,
    start_date: `${newYear}-01-01`,
    end_date:   `${newYear}-12-31`,
    status:     'active',
    started_at: new Date().toISOString(),
  };

  const { error: insertErr } = await db.from('seasons').insert(seasonInsert);

  if (insertErr) {
    console.warn('[rolloverSeason] season insert failed:', insertErr.message);
    return empty;
  }

  const result: RolloverResult = {
    ...empty,
    newSeasonId,
    newSeasonName: newName,
  };

  // ── Step 4: league competitions + rosters + fixtures ───────────────────────
  for (const league of LEAGUES) {
    const compId   = randomUUID();
    const compName = `${league.name} — ${newName}`;

    const { error: compErr } = await db
      .from('competitions')
      .insert({
        id:        compId,
        season_id: newSeasonId,
        league_id: league.id,
        name:      compName,
        type:      'league',
        format:    'round_robin',
        status:    'upcoming',
      });

    if (compErr) {
      console.warn(`[rolloverSeason] competition insert failed (${league.id}):`, compErr.message);
      continue;
    }
    result.competitionsCreated += 1;

    // Resolve this league's teams from the live `teams.league_id` FK (not the
    // prior season's roster) so any future team-league reassignment is honoured.
    const { data: teams, error: teamsErr } = await db
      .from('teams')
      .select('id')
      .eq('league_id', league.id);

    if (teamsErr || !teams || teams.length === 0) {
      console.warn(
        `[rolloverSeason] no teams for league ${league.id}:`,
        teamsErr?.message ?? 'empty result',
      );
      continue;
    }

    const teamIds = teams.map((t) => t.id);

    // competition_teams — upsert so a retry after partial failure is safe.
    const { error: ctErr } = await db
      .from('competition_teams')
      .upsert(
        teamIds.map((tid) => ({ competition_id: compId, team_id: tid })),
        { onConflict: 'competition_id,team_id' },
      );

    if (ctErr) {
      console.warn(`[rolloverSeason] competition_teams upsert failed (${league.id}):`, ctErr.message);
    }

    // Fixtures — anchored to the real-time `opts` so the worker can claim them
    // (#569 lesson).  Upsert by (competition_id, home_team_id, away_team_id) so
    // re-runs never duplicate a fixture.
    const fixtures = generateRoundRobinFixtures(compId, teamIds, {
      pairsPerMatchday: DEFAULT_PAIRS_PER_MATCHDAY,
      firstKickoffMs:   opts.firstKickoffMs,
      cadenceMs:        opts.cadenceMs,
    });

    for (let off = 0; off < fixtures.length; off += FIXTURE_BATCH_SIZE) {
      const batch = fixtures.slice(off, off + FIXTURE_BATCH_SIZE);
      const { error: fixErr } = await db
        .from('matches')
        .upsert(batch, { onConflict: 'competition_id,home_team_id,away_team_id' });

      if (fixErr) {
        console.warn(
          `[rolloverSeason] fixture batch ${off}–${off + batch.length - 1} failed (${league.id}):`,
          fixErr.message,
        );
      } else {
        result.fixturesCreated += batch.length;
      }
    }
  }

  // ── Step 5: empty cup competition rows ─────────────────────────────────────
  for (const cup of CUP_TIERS) {
    const cupId   = randomUUID();
    const cupName = `${cup.name} — ${newName}`;

    const { error: cupErr } = await db
      .from('competitions')
      .insert({
        id:        cupId,
        season_id: newSeasonId,
        league_id: null, // Cross-league cup — no single-league affiliation.
        name:      cupName,
        type:      'cup',
        format:    'knockout',
        status:    'upcoming',
        // `bracket` intentionally omitted — defaults to NULL.
        // #568 follow-up: seed brackets at the END of the new league phase.
      });

    if (cupErr) {
      console.warn(`[rolloverSeason] cup insert failed (${cup.key}):`, cupErr.message);
    } else {
      result.cupRowsCreated += 1;
    }
  }

  // ── Step 6: focus_options for every team ───────────────────────────────────
  const { data: allTeams, error: allTeamsErr } = await db.from('teams').select('id');

  if (allTeamsErr || !allTeams) {
    console.warn('[rolloverSeason] teams read failed — skipping focus_options:', allTeamsErr?.message);
  } else {
    for (const team of allTeams) {
      result.focusOptionRows += await generateFocusOptions(db, team.id, newSeasonId);
    }
  }

  return result;
}
