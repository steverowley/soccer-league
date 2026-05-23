// ── auth/api/loginStreak.ts ────────────────────────────────────────────────
//
// Thin client wrapper around the `bump_login_streak()` SECURITY DEFINER
// RPC (#380, migration 0056). Called from AuthProvider on the SIGNED_IN
// auth event so the user's `profiles.login_streak` increments at most
// once per UTC day per account, atomically.
//
// WHY THROUGH AN RPC (not a direct profiles UPDATE)
// ──────────────────────────────────────────────────
// The streak logic involves a read-then-conditional-write that needs
// to serialise across concurrent tabs:
//   • UTC-today already counted     → no-op, return current streak
//   • UTC-yesterday counted         → bump by 1
//   • Older / never counted         → reset to 1
// Doing this in three round-trips from the browser would race with a
// second tab signing in simultaneously and double-bump. The RPC uses
// SELECT ... FOR UPDATE inside a single transaction so the row is
// locked end-to-end.
//
// WHY HERE (features/auth/api) — not shared/api
// `login_streak` is a profiles-table concern owned by the auth feature.
// Same colocation rule as profiles.ts + activeWatchers.ts.

import type { IslSupabaseClient } from '@shared/supabase/client';

/**
 * Bump the calling user's login streak.
 *
 * Fire-and-forget — the RPC is idempotent within the same UTC day so
 * a second call (e.g. from a duplicate auth event) costs an extra
 * round-trip but produces no behavioural change. Errors are logged
 * and swallowed; a transient RPC failure must never prevent the user
 * from completing login.
 *
 * @param db  Injected Supabase client.
 * @returns   The new streak value (or 0 on any error). Callers
 *            that want the precise streak should re-fetch the
 *            profile after this resolves rather than trusting the
 *            return value, since the RPC return is best-effort
 *            and AuthProvider already does a fetchProfile() right
 *            after.
 */
export async function bumpLoginStreak(db: IslSupabaseClient): Promise<number> {
  try {
    const { data, error } = await db.rpc('bump_login_streak');
    if (error) {
      console.warn('[bumpLoginStreak] RPC failed:', error.message);
      return 0;
    }
    return typeof data === 'number' ? data : 0;
  } catch (e) {
    console.warn('[bumpLoginStreak] threw:', e);
    return 0;
  }
}
