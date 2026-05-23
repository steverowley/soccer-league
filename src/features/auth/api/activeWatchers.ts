// ── auth/api/activeWatchers.ts ───────────────────────────────────────────────
//
// Thin DB layer for the live-watcher count widget.  Reads the public
// `active_watchers_v` view (one row, one column) and returns the integer
// count of fans whose `profiles.last_seen_at` has updated in the last
// 5 minutes.
//
// WHY THROUGH A VIEW — not the profiles table directly
//   `profiles` RLS limits the table SELECT to the calling user's own row.
//   Anonymous users see nothing; signed-in users see only themselves.
//   The view aggregates first under the postgres role (RLS-exempt) and
//   exposes only the count — anonymous and signed-in users get the same
//   cosmos-wide number with no per-user leakage.  Migration 0018 sets up
//   the view + grants.  Same pattern as wager_volume_v (0017).
//
// WHY HERE (features/auth/api) — not shared/api
//   `last_seen_at` is a profiles-table concern owned by the auth feature
//   (touched by AuthProvider on sign-in, on a 90-second heartbeat, and
//   on visibilitychange→visible — see the useEffect block in
//   AuthProvider.tsx).  The watcher count is a derived read against the
//   same underlying column, so it belongs in the same feature.

import type { IslSupabaseClient } from '@shared/supabase/client';

/**
 * Fetch the count of fans active in the last 5 minutes.
 *
 * Returns 0 on error rather than throwing — the widget is enriching, and
 * a Supabase blip must never block the Home or live-match page from
 * rendering.  Callers that want to surface an error state should check
 * the value against null explicitly; this function never returns null.
 *
 * @param db  Injected Supabase client.
 * @returns   Non-negative integer count.
 */
export async function getActiveWatcherCount(db: IslSupabaseClient): Promise<number> {
  try {
    const { data, error } = await db
      .from('active_watchers_v')
      .select('watcher_count')
      .single();
    if (error) {
      console.warn('[getActiveWatcherCount] failed:', error.message);
      return 0;
    }
    return data?.watcher_count ?? 0;
  } catch (e) {
    console.warn('[getActiveWatcherCount] threw:', e);
    return 0;
  }
}
