// ── features/match/api/seasons.ts ────────────────────────────────────────────
// Supabase queries for the season-lifecycle state machine introduced in
// Package 13.  Thin DB layer — all decision logic lives in the pure
// helpers in `logic/seasonLifecycle.ts`.
//
// WHAT THIS MODULE OWNS
//   • Reading a season's current `status` value.
//   • Counting league fixtures by status for completion checks.
//   • Updating `status` + `ended_at` atomically when transitioning out
//     of 'active'.
//
// WHAT IT DOES NOT DO
//   • No business rules — `isSeasonComplete()` lives in logic/.
//   • No enactment side-effects — that's `enactSeasonFocuses()` from the
//     voting feature.  This module returns a flag the caller acts on.

import type { IslSupabaseClient } from '@shared/supabase/client';
import type {
  LeagueFixtureCounts,
  SeasonStatus,
} from '../logic/seasonLifecycle';

// TYPE ESCAPE HATCH — the seasons row gains `status` / `started_at` /
// `ended_at` columns in migration 0014.  Until database.ts is regenerated
// after that migration is applied, we cast at the boundary.  Same pattern
// as betting/api/oddsRepo.ts (CAST:match_odds).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

// ── Status read ──────────────────────────────────────────────────────────────

/**
 * Fetch the lifecycle status of one season.  Returns null when the season
 * row does not exist (caller treats as "no season to roll over").
 *
 * @param db        Injected Supabase client (service-role for the worker;
 *                  anon clients won't see the new columns until RLS
 *                  policies catch up — see migration 0014 notes).
 * @param seasonId  UUID of the season to query.
 * @returns         Current status, or null on miss / error.
 */
export async function getSeasonStatus(
  db:       IslSupabaseClient,
  seasonId: string,
): Promise<SeasonStatus | null> {
  const { data, error } = await (db as AnyDb) // CAST:seasons.status
    .from('seasons')
    .select('status')
    .eq('id', seasonId)
    .maybeSingle();

  if (error || !data) return null;
  return (data as { status: SeasonStatus }).status;
}

// ── Fixture-count tally ──────────────────────────────────────────────────────

/**
 * Count league fixtures by status for a single season.  Cup matches are
 * filtered out via a join on `competitions.type = 'league'` — only the
 * round-robin phase gates the season transition (cups can run past
 * season-end).
 *
 * The tally is small (4 numbers) so we always return all four counts even
 * when some buckets are zero — keeps the consumer's branching simple.
 *
 * @param db        Injected Supabase client.
 * @param seasonId  UUID of the season to tally.
 * @returns         Per-status counts.  Counts are zero-filled on query
 *                  failure so the caller's `isSeasonComplete` returns
 *                  false (safe no-op).
 */
export async function getLeagueFixtureCountsForSeason(
  db:       IslSupabaseClient,
  seasonId: string,
): Promise<LeagueFixtureCounts> {
  // ── Step 1: pull all league competition UUIDs for this season ──────────
  // We query competitions first instead of using a relational join so the
  // generated PostgREST query stays index-friendly (the matches table has
  // a composite index on (competition_id, status) but no path through
  // seasons).
  const { data: comps, error: compErr } = await (db as AnyDb)
    .from('competitions')
    .select('id')
    .eq('season_id', seasonId)
    .eq('type',      'league');

  if (compErr || !comps || comps.length === 0) {
    return { scheduled: 0, inProgress: 0, completed: 0, cancelled: 0 };
  }

  const competitionIds = (comps as Array<{ id: string }>).map((c) => c.id);

  // ── Step 2: pull all match status values across those competitions ─────
  // The .in() clause is the cheapest server-side way to filter by an array
  // of UUIDs.  We project only the `status` column so the response payload
  // stays compact even at season end (224 rows × ~12 bytes ≈ 2.7 KB).
  const { data: matches, error: matchErr } = await (db as AnyDb)
    .from('matches')
    .select('status')
    .in('competition_id', competitionIds);

  if (matchErr || !matches) {
    return { scheduled: 0, inProgress: 0, completed: 0, cancelled: 0 };
  }

  // ── Step 3: tally locally ──────────────────────────────────────────────
  // PostgREST doesn't support GROUP BY in select queries without an SQL
  // view, so we tally in JS.  At ~250 rows the cost is negligible
  // (sub-millisecond) and keeps the api layer migration-free.
  const tally: LeagueFixtureCounts = {
    scheduled: 0, inProgress: 0, completed: 0, cancelled: 0,
  };
  for (const m of matches as Array<{ status: string }>) {
    if      (m.status === 'scheduled')   tally.scheduled++;
    else if (m.status === 'in_progress') tally.inProgress++;
    else if (m.status === 'completed')   tally.completed++;
    else if (m.status === 'cancelled')   tally.cancelled++;
  }
  return tally;
}

// ── Status transition (write) ────────────────────────────────────────────────

/**
 * Transition a season's status forward.  Uses an optimistic UPDATE with a
 * `WHERE status = expectedFromStatus` predicate so concurrent workers can
 * race without double-firing enactment: only the worker that wins the
 * UPDATE sees a non-zero affected-rows count.
 *
 * `ended_at = now()` is written automatically on the active → voting
 * transition since that's the moment the league phase closes.  Other
 * transitions leave `ended_at` untouched.
 *
 * @param db                  Injected Supabase client (service-role).
 * @param seasonId            UUID of the season to mutate.
 * @param expectedFromStatus  The status we expect the row to be in.  If
 *                            another worker already advanced past this
 *                            point, the UPDATE matches zero rows and we
 *                            return false.
 * @param toStatus            The new status to write.
 * @returns                   True if this caller won the race, false if
 *                            the row had already moved on.
 */
export async function transitionSeasonStatus(
  db:                  IslSupabaseClient,
  seasonId:            string,
  expectedFromStatus:  SeasonStatus,
  toStatus:            SeasonStatus,
): Promise<boolean> {
  // active → voting is the only transition that stamps ended_at; for the
  // others we leave the column alone so the original close-of-league
  // timestamp stays the source of truth.
  const patch: Record<string, unknown> = { status: toStatus };
  if (expectedFromStatus === 'active' && toStatus === 'voting') {
    patch['ended_at'] = new Date().toISOString();
  }

  const { data, error } = await (db as AnyDb) // CAST:seasons.status
    .from('seasons')
    .update(patch)
    .eq('id',     seasonId)
    .eq('status', expectedFromStatus)
    .select('id');

  if (error) {
    console.warn('[transitionSeasonStatus] update failed:', error.message);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

// ── Convenience: "what season does this match belong to?" ────────────────────

/**
 * Resolve the season UUID for a given match.  Two-hop join (matches →
 * competitions → seasons) done as separate queries because matches has no
 * direct season_id FK.
 *
 * @param db        Injected Supabase client.
 * @param matchId   UUID of the match.
 * @returns         The seasons.id this match belongs to, or null on miss.
 */
export async function getSeasonIdForMatch(
  db:       IslSupabaseClient,
  matchId:  string,
): Promise<string | null> {
  // Step 1: match → competition_id.
  const { data: matchRow, error: matchErr } = await (db as AnyDb)
    .from('matches')
    .select('competition_id')
    .eq('id', matchId)
    .maybeSingle();

  if (matchErr || !matchRow) return null;

  // Step 2: competition → season_id.
  const { data: compRow, error: compErr } = await (db as AnyDb)
    .from('competitions')
    .select('season_id')
    .eq('id', (matchRow as { competition_id: string }).competition_id)
    .maybeSingle();

  if (compErr || !compRow) return null;
  return (compRow as { season_id: string }).season_id;
}
