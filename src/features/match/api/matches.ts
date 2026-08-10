// ── features/match/api/matches.ts ─────────────────────────────────────────
// First slice of #387 — dissolving `src/lib/supabase.ts`.
//
// WHY
// ───
// The 815-LOC `src/lib/supabase.ts` is the DI escape hatch every page
// imports from. Each function inside it uses the module-singleton
// `supabase` client directly, bypassing the SupabaseProvider context
// the rest of the app uses for dependency injection. Engineering
// principle 6 (CLAUDE.md) forbids the pattern.
//
// This file holds the dissolution's first extraction: `getMatch`,
// which was used only by `src/pages/MatchDetail.tsx`. The new version
// takes the typed Supabase client as a `db` parameter so the consumer
// passes the one it got from `useSupabase()`.
//
// SHAPE
// ─────
// The function signature mirrors the original except for the leading
// `db` argument. Return shape is preserved — MatchDetail's local
// `Match` interface continues to narrow the joined row. We keep the
// loose `any`-like return for now because the nested-select shape is
// wide and #386 (Zod boundary schemas) is the right place to lock it
// down, not here.

import type { IslSupabaseClient } from '@shared/supabase/client';
// #386: drift-validate the live/upcoming list rows at the api boundary.
// Malformed rows warn-log and drop, preserving the original (wide) row type.
import { dropInvalidMatchListRows } from './matches.schema';

// ── Withheld-result stripping ─────────────────────────────────────────────

/**
 * Drop the withheld simulated score from a match row before it reaches the app.
 *
 * `sim_home_score` / `sim_away_score` carry the final result while a match is
 * still `live` (migration 0081).  Every match query selects `*`, so without
 * this they would arrive in the very same object as `home_score` — the exact
 * shape that caused the original spoiler, where a component read the final
 * score off the row and rendered it mid-reveal.  Stripping here, at the api
 * boundary the architecture already designates for DB-shape translation, means
 * no UI code can read them by accident.
 *
 * SCOPE, HONESTLY: this hardens the app, not the database.  `matches` is
 * public-read and so is `match_events`, which holds every goal of the match
 * from the moment it is simulated — that is the pre-simulate-then-reveal model
 * migration 0013 established, and a direct PostgREST query still sees it.
 * Sealing the result from a determined client is a separate, larger change
 * (progressive event publication), not something this strip pretends to do.
 *
 * @param row  A match row straight from PostgREST, or null.
 * @returns    The same row without the `sim_*` keys.  Null passes through.
 */
function stripWithheldResult<T>(row: T): T {
  if (row == null || typeof row !== 'object') return row;
  const { sim_home_score: _h, sim_away_score: _a, ...rest } = row as Record<string, unknown>;
  return rest as T;
}

// ── getMatch ──────────────────────────────────────────────────────────────

/**
 * Fetch a single match by id with the team / competition / lineup /
 * match-player-stats joins the MatchDetail page renders.
 *
 * Migrated from `src/lib/supabase.ts` (PR #387 slice 1). The select
 * shape is byte-identical to the original so MatchDetail's local
 * `Match` type narrowing keeps working without prop edits.
 *
 * @param db       Injected Supabase client (via `useSupabase()`).
 * @param matchId  UUID of the target match.
 * @returns        The joined match row. Throws on Supabase error so
 *                 the caller's existing .catch() error handler fires
 *                 unchanged — preserves the previous lib-singleton
 *                 contract.
 */
export async function getMatch(db: IslSupabaseClient, matchId: string) {
  const { data, error } = await db
    .from('matches')
    .select(
      `
      *,
      competitions (id, name, type, format),
      home_team:teams!matches_home_team_id_fkey (
        *,
        managers (id, name, preferred_formation, style),
        players (id, name, position, starter, jersey_number, overall_rating)
      ),
      away_team:teams!matches_away_team_id_fkey (
        *,
        managers (id, name, preferred_formation, style),
        players (id, name, position, starter, jersey_number, overall_rating)
      ),
      match_player_stats (
        *,
        players (id, name, position, overall_rating)
      )
    `,
    )
    .eq('id', matchId)
    .single();
  if (error) throw error;
  // Never hand the withheld result to the page — see stripWithheldResult.
  return stripWithheldResult(data);
}

// ── Live / upcoming list queries ─────────────────────────────────────────

/**
 * Fetch every match a spectator can watch right now.
 *
 * Liveness is read straight off `matches.status`: the worker holds a match at
 * `live` for its entire real-time reveal window and only flips it to
 * `completed` at full time (migration 0081).  `in_progress` is included too —
 * that's the brief window while the worker is still writing the rows.
 *
 * This used to guess instead, selecting any non-cancelled match whose
 * `scheduled_at` fell inside a hardcoded 600-second window, because the worker
 * flipped straight to `completed` the moment it simulated and the status was
 * therefore useless. That guess silently disagreed with any season whose
 * `match_duration_seconds` wasn't the default.
 *
 * @param db  Injected Supabase client.
 * @returns   Array of match rows joined with home/away team metadata,
 *            ordered by scheduled_at DESC (most-recently-kicked-off first).
 *            Empty array on no live matches.
 * @throws    Re-throws the Supabase error if the query fails.
 */
export async function getLiveMatches(db: IslSupabaseClient) {
  const { data, error } = await db
    .from('matches')
    .select(
      `
      *,
      home_team:teams!matches_home_team_id_fkey (id, name, color, location, home_ground),
      away_team:teams!matches_away_team_id_fkey (id, name, color, location, home_ground)
    `,
    )
    .in('status', ['live', 'in_progress'])
    .order('scheduled_at', { ascending: false });
  if (error) throw error;
  return dropInvalidMatchListRows((data ?? []).map(stripWithheldResult), 'getLiveMatches');
}

/**
 * Fetch the next `limit` upcoming matches — strictly future kickoffs.
 *
 * Selection rules: `status = 'scheduled'` (worker hasn't claimed it
 * yet) AND `scheduled_at > now` (strictly in the future). The future-
 * only predicate prevents overlap with `getLiveMatches` for fixtures
 * whose kickoff has already passed but the worker hasn't yet picked up.
 *
 * Migrated from `src/lib/supabase.ts` (#387 slice 2).
 *
 * @param db     Injected Supabase client.
 * @param limit  Maximum rows to return. Defaults to 6 (the Home sidebar
 *               cadence).
 * @returns      Array of match rows joined with team metadata, ordered
 *               by scheduled_at ASC (next kickoff first).
 * @throws       Re-throws the Supabase error if the query fails.
 */
export async function getUpcomingMatches(db: IslSupabaseClient, limit = 6) {
  const { data, error } = await db
    .from('matches')
    .select(
      `
      *,
      home_team:teams!matches_home_team_id_fkey (id, name, color, location, home_ground),
      away_team:teams!matches_away_team_id_fkey (id, name, color, location, home_ground)
    `,
    )
    .eq('status', 'scheduled')
    .gt('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return dropInvalidMatchListRows(data ?? [], 'getUpcomingMatches');
}
