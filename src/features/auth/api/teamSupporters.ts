// ── auth/api/teamSupporters.ts ───────────────────────────────────────────────
//
// Thin DB layer for the per-team supporter count badge (#382).  Reads the
// public `team_supporter_count_v` view (one row per team) and returns the
// integer count of profiles whose `favourite_team_id` matches.
//
// WHY THROUGH A VIEW — not the profiles table directly
//   `profiles` RLS limits SELECT to the caller's own row.  An anonymous
//   or authenticated browser counting favourite_team_id matches directly
//   would always return 0 or 1.  Migration 0055 ships the aggregate view
//   that runs as the OWNER (RLS-exempt), exposing only (team_id,
//   supporter_count) — anonymous and signed-in users see the same count
//   with no per-user leakage.  Mirrors the active_watchers_v pattern
//   (0018) used for the live-watcher widget alongside this file.
//
// WHY HERE (features/auth/api) — not shared/api
//   `favourite_team_id` is a profiles-table concern owned by the auth
//   feature, same as `last_seen_at`.  Keeping per-team derived reads
//   here colocates the schema knowledge.

import type { IslSupabaseClient } from '@shared/supabase/client';

// TYPE ESCAPE HATCH — view is too small to be worth regenerating the
// generated DB types file. Same pattern as activeWatchers.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

/**
 * Fetch the supporter count for a single team.
 *
 * Returns 0 on error or when no profile has chosen this team — the badge
 * surface treats 0 the same as missing, so this is the friendliest
 * fallback. Callers wanting to distinguish "unknown" from "zero" should
 * use a different surface; the badge UI doesn't.
 *
 * @param db      Injected Supabase client.
 * @param teamId  The team's text slug PK (matches teams.id and
 *                profiles.favourite_team_id).
 * @returns       Non-negative integer count.
 */
export async function getTeamSupporterCount(
  db:     IslSupabaseClient,
  teamId: string,
): Promise<number> {
  try {
    const { data, error } = await (db as AnyDb)  // CAST:team_supporter_count_v
      .from('team_supporter_count_v')
      .select('supporter_count')
      .eq('team_id', teamId)
      .maybeSingle();
    if (error) {
      console.warn('[getTeamSupporterCount] failed:', error.message);
      return 0;
    }
    return data?.supporter_count ?? 0;
  } catch (e) {
    console.warn('[getTeamSupporterCount] threw:', e);
    return 0;
  }
}
