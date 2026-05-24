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
  return data;
}

// ── Live / upcoming list queries ─────────────────────────────────────────

/**
 * How far back (in seconds) past `scheduled_at` a match still counts as
 * "live" for `getLiveMatches`. 600 s = 10 minutes — long enough to cover
 * a real-time-paced 90-minute reveal at the production
 * `match_duration_seconds` knob (600). A match that's already final
 * stays in the live list until this window closes, so a viewer
 * arriving mid-paced-reveal sees the right row.
 */
const LIVE_WINDOW_SECONDS = 600;

/**
 * Fetch every match currently in the live window — `scheduled_at` is
 * within the last `LIVE_WINDOW_SECONDS` and not in the future, with
 * any status other than `cancelled`. Migrated from `src/lib/supabase.ts`
 * (#387 slice 2) with the standard `db` injection.
 *
 * @param db  Injected Supabase client.
 * @returns   Array of match rows joined with home/away team metadata,
 *            ordered by scheduled_at DESC (most-recently-kicked-off first).
 *            Empty array on no live matches.
 * @throws    Re-throws the Supabase error if the query fails.
 */
export async function getLiveMatches(db: IslSupabaseClient) {
  const now           = new Date();
  const windowOpenIso = new Date(now.getTime() - LIVE_WINDOW_SECONDS * 1000).toISOString();
  const nowIso        = now.toISOString();
  const { data, error } = await db
    .from('matches')
    .select(
      `
      *,
      home_team:teams!matches_home_team_id_fkey (id, name, color, location, home_ground),
      away_team:teams!matches_away_team_id_fkey (id, name, color, location, home_ground)
    `,
    )
    .gte('scheduled_at', windowOpenIso)
    .lte('scheduled_at', nowIso)
    .neq('status', 'cancelled')
    .order('scheduled_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
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
  return data ?? [];
}
