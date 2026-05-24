// ── AuthProvider.tsx ──────────────────────────────────────────────────────────
// WHY: Centralised auth state for the entire app. Every component that needs
// to know "is the user logged in?" or "what's their profile?" consumes
// this context via `useAuth()` instead of making ad-hoc Supabase Auth calls.
//
// This gives us:
//   1. A single `onAuthStateChange` listener (not N per-component listeners).
//   2. Automatic profile fetch on login / profile refetch after updates.
//   3. A clean `signOut` that clears both Supabase session and local state.
//   4. A `touchLastSeen` debounce so Phase 3's fan-boost query gets fresh
//      timestamps without flooding the DB with writes on every render.
//
// PLACEMENT: Wrap the app inside SupabaseProvider in main.tsx:
//   <SupabaseProvider>
//     <AuthProvider>
//       <RouterProvider ... />
//     </AuthProvider>
//   </SupabaseProvider>
//
// AuthProvider MUST be a child of SupabaseProvider because it calls
// `useSupabase()` to get the typed Supabase client.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { useSupabase } from '@shared/supabase/SupabaseProvider';
import { getOwnProfile, touchLastSeen } from '../api/profiles';
import { bumpLoginStreak } from '../api/loginStreak';
import type { Profile } from '../types';

// ── Context shape ───────────────────────────────────────────────────────────

/**
 * Auth context value exposed to consumers via `useAuth()`.
 *
 * `loading` is `true` during the initial session restore (Supabase checks
 * for a stored JWT on mount). Components should render a skeleton or nothing
 * while loading is true to avoid a flash of "logged out" content.
 */
interface AuthContextValue {
  /** The Supabase Auth user object, or `null` if not authenticated. */
  user: User | null;
  /** The Supabase session (contains tokens), or `null`. */
  session: Session | null;
  /** The ISL profile row from the `profiles` table, or `null`. */
  profile: Profile | null;
  /** `true` while the initial auth state is being resolved on mount. */
  loading: boolean;
  /** Sign in with email + password. Returns an error string on failure. */
  signIn: (email: string, password: string) => Promise<string | null>;
  /** Create a new account. See SignUpResult for the success-vs-pending distinction. */
  signUp: (email: string, password: string, username: string) => Promise<SignUpResult>;
  /** Sign out and clear all auth state. */
  signOut: () => Promise<void>;
  /** Force-refresh the profile from the DB (e.g. after a credit change). */
  refreshProfile: () => Promise<void>;
  /**
   * Request a password-reset email. Returns an error string on failure,
   * null on success. Always returns null when the email doesn't exist —
   * Supabase intentionally doesn't disclose user enumeration via this
   * endpoint, and we don't either.
   */
  requestPasswordReset: (email: string) => Promise<string | null>;
  /**
   * GDPR Article 17 — permanently delete the calling user's account.
   *
   * Two-phase tear-down handled by the `account-delete` edge function:
   *   1. RPC `request_account_deletion()` writes the audit row + returns
   *      pre-tear-down counts.
   *   2. The edge function's service-role client invokes
   *      `auth.admin.deleteUser` which CASCADEs the profile and SETs
   *      NULL on wagers / focus_votes user_id (per migration 0059).
   *
   * On success: local auth state is cleared, the user is signed out,
   * and the caller can navigate away. The caller should NOT show the
   * "Deletion request received" message until the returned `ok` is
   * `true` — until then the user's data is still recoverable.
   *
   * @returns { ok, error }. `error` is a human-readable message when
   *          `ok` is false; the caller surfaces it via toast.
   */
  deleteAccount: () => Promise<{ ok: boolean; error: string | null }>;
}

/**
 * Result of a signUp() call. The PRE-fix bug shipped only `error: string|null`,
 * which collapsed two very different states:
 *   - success-with-session  (confirmation disabled → navigate to /)
 *   - success-without-session (confirmation enabled → "check inbox")
 * Returning a discriminated union forces callers to handle both paths
 * explicitly, killing the silent-signup UX bug.
 */
export type SignUpResult =
  | { kind: 'error';            error: string }
  | { kind: 'session';          /* signed in immediately */ }
  | { kind: 'confirmation_required'; email: string };

const AuthContext = createContext<AuthContextValue | null>(null);

// ── Debounce interval for touchLastSeen ─────────────────────────────────────
/**
 * Minimum milliseconds between `last_seen_at` writes. 60 000 ms = 1 minute.
 * This prevents a flood of UPDATEs when the user navigates rapidly between
 * pages. Phase 3's fan-boost query uses a 5-minute window, so a 1-minute
 * touch rate is more than sufficient to keep the user "present".
 */
const TOUCH_DEBOUNCE_MS = 60_000;

// ── Presence heartbeat interval ─────────────────────────────────────────────
/**
 * How often the AuthProvider re-touches `last_seen_at` while the user keeps
 * a tab open.  90 000 ms (1.5 min) sits comfortably inside the 5-minute
 * server-side presence window read by `active_watchers_v` and the
 * fan-boost calculation, so a single missed tick (briefly backgrounded
 * tab, transient network blip) still leaves the fan inside the window.
 *
 * The TOUCH_DEBOUNCE_MS floor above means even an aggressive interval
 * never produces more than one UPDATE/minute per tab.
 */
const PRESENCE_HEARTBEAT_MS = 90_000;

// ── Provider component ──────────────────────────────────────────────────────

/**
 * Wraps the component tree with auth state. On mount:
 *   1. Calls `supabase.auth.getSession()` to restore a stored JWT.
 *   2. If a session exists, fetches the user's profile from `profiles`.
 *   3. Subscribes to `onAuthStateChange` for login/logout/token-refresh.
 *
 * The `touchLastSeen` call fires once on mount and then at most once per
 * TOUCH_DEBOUNCE_MS on re-renders (via the useEffect cleanup pattern).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const db = useSupabase();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  // Ref for debouncing touchLastSeen — stores the timestamp of the last
  // successful touch so we can skip redundant writes.
  const lastTouchRef = useRef<number>(0);

  // ── Fetch profile helper ────────────────────────────────────────────────
  const fetchProfile = useCallback(async () => {
    const { data } = await getOwnProfile(db);
    setProfile(data);
  }, [db]);

  // ── Touch last_seen_at (debounced) ──────────────────────────────────────
  const debouncedTouch = useCallback(() => {
    const now = Date.now();
    if (now - lastTouchRef.current < TOUCH_DEBOUNCE_MS) return;
    lastTouchRef.current = now;
    // Fire-and-forget — errors are logged inside touchLastSeen, not surfaced.
    touchLastSeen(db);
  }, [db]);

  // ── Initial session restore + auth state listener ───────────────────────
  useEffect(() => {
    // 1. Restore session from storage (cookie/localStorage depending on
    //    Supabase config). This is async but we don't want to block the
    //    first render — `loading` stays true until this resolves.
    db.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        fetchProfile().finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    // 2. Listen for auth state changes (login, logout, token refresh).
    const {
      data: { subscription },
    } = db.auth.onAuthStateChange((event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        // Bump the login streak on SIGNED_IN events only (not on
        // TOKEN_REFRESHED — that fires every hour and would mask the
        // RPC's own UTC-day idempotency with no benefit). Fire-and-forget
        // RPC; we refetch the profile afterwards so the cached row
        // reflects the new streak immediately on /profile.
        if (event === 'SIGNED_IN') {
          void bumpLoginStreak(db).then(() => fetchProfile());
        } else {
          fetchProfile();
        }
      } else {
        setProfile(null);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [db, fetchProfile]);

  // ── Touch last_seen_at when user is authenticated ───────────────────────
  // Three triggers, all calling the same debouncedTouch:
  //   1. User just signed in (or already in on mount).
  //   2. Heartbeat interval — keeps presence fresh while the tab is open
  //      so the LiveWatchersBadge / fan-boost window doesn't drop a fan
  //      after 5 minutes of idle viewing.
  //   3. visibilitychange → visible — refreshes presence the moment a
  //      backgrounded tab is brought forward, so the fan re-appears in
  //      the watcher count without waiting for the next interval tick.
  //
  // The heartbeat interval is intentionally shorter than the 5-minute
  // server-side presence window (PRESENCE_HEARTBEAT_MS = 90 s) so that
  // even a single missed tick (e.g. tab backgrounded for one cycle)
  // still leaves the fan inside the window.  When the tab is hidden,
  // we still let the interval run but the debouncedTouch's own
  // 60-second floor de-duplicates rapid wake/sleep cycles.
  useEffect(() => {
    if (!user) return;

    // Initial touch on auth so the user appears immediately.
    debouncedTouch();

    const heartbeat = setInterval(debouncedTouch, PRESENCE_HEARTBEAT_MS);

    // Touch again whenever the tab comes back to foreground so a fan
    // returning from another tab is counted on the next badge refresh.
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') debouncedTouch();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user, debouncedTouch]);

  // ── Auth actions ────────────────────────────────────────────────────────

  const signIn = useCallback(
    async (email: string, password: string): Promise<string | null> => {
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (error) return error.message;
      // Profile fetch happens automatically via onAuthStateChange above.
      return null;
    },
    [db],
  );

  const signUp = useCallback(
    async (email: string, password: string, username: string): Promise<SignUpResult> => {
      // Pass username in signUp metadata so the `handle_new_user` DB trigger
      // can write it atomically when it creates the profile row. This avoids
      // a second UPDATE round-trip that would fail under email-confirmation
      // flows (no active session = RLS blocks the update).
      //
      // emailRedirectTo ensures confirmation links go to the deployed URL
      // (GitHub Pages) rather than whatever localhost the Supabase project's
      // "Site URL" is set to. import.meta.env.BASE_URL is '/soccer-league/'
      // in production builds and '/' locally.
      const { data, error } = await db.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}${import.meta.env.BASE_URL}`,
          data: { username: username.trim() },
        },
      });
      if (error) return { kind: 'error', error: error.message };

      // Supabase returns `session: null` when email confirmation is enabled
      // and the user just needs to click a link. We MUST tell the caller so
      // they can show "check your inbox" instead of silently navigating to
      // a still-anonymous home page (the pre-fix bug).
      if (data.session) return { kind: 'session' };
      return { kind: 'confirmation_required', email };
    },
    [db],
  );

  const requestPasswordReset = useCallback(
    async (email: string): Promise<string | null> => {
      // redirectTo lands the user on /reset-password with a recovery JWT in
      // the URL fragment; the page parses that and lets them set a new pw.
      const { error } = await db.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}${import.meta.env.BASE_URL}reset-password`,
      });
      // Don't surface "user not found" — Supabase intentionally returns no
      // error for unknown emails to avoid user enumeration via this surface.
      if (error) return error.message;
      return null;
    },
    [db],
  );

  const signOutFn = useCallback(async () => {
    await db.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
  }, [db]);

  const refreshProfile = useCallback(async () => {
    await fetchProfile();
  }, [fetchProfile]);

  /**
   * Invoke the `account-delete` edge function with the user's JWT, then
   * clear local auth state on success. The edge function handles both
   * tear-down phases (audit row write + auth.users delete); from the
   * client's perspective this is one round-trip.
   *
   * Failure modes (per the function's response contract):
   *   - 401 / SQLSTATE 28000 → no auth on the request
   *   - 400 / SQLSTATE P0002 → profile already gone (e.g. double-call)
   *   - 500                  → audit row written but auth delete failed
   *                            (admin tooling will reconcile)
   *
   * In every error case we leave local state untouched so the user can
   * retry; only a clean 200 triggers signOut + state clear.
   */
  const deleteAccount = useCallback(async (): Promise<{ ok: boolean; error: string | null }> => {
    // Pull the current session token. db.functions.invoke would lift it
    // from the client headers automatically, but we want to fail fast
    // with a clearer message if the user happens to be logged out at
    // call time (e.g. session expired in another tab).
    const { data: { session: s } } = await db.auth.getSession();
    if (!s?.access_token) {
      return { ok: false, error: 'Not authenticated' };
    }

    const { data, error } = await db.functions.invoke('account-delete', {
      // No body — the edge function reads auth.uid() from the JWT.
      body: {},
      headers: { Authorization: `Bearer ${s.access_token}` },
    });
    if (error) return { ok: false, error: error.message };

    // The function returns { ok, anonymised? , error? } as JSON. Surface
    // the function-level error verbatim so the toast shows the same copy
    // the operator would see in logs.
    const payload = data as { ok?: boolean; error?: string } | null;
    if (!payload?.ok) {
      return { ok: false, error: payload?.error ?? 'unexpected response' };
    }

    // Auth user is gone server-side — clear local state and let the
    // caller redirect. Signing out clears the stored JWT so the next
    // page load doesn't try to restore a now-invalid session.
    await db.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
    return { ok: true, error: null };
  }, [db]);

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        loading,
        signIn,
        signUp,
        signOut: signOutFn,
        refreshProfile,
        requestPasswordReset,
        deleteAccount,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ── Consumer hook ───────────────────────────────────────────────────────────

/**
 * Access the auth context from any component inside `<AuthProvider>`.
 *
 * Throws if used outside the provider — this is intentional, not defensive.
 * Every route in the app should be wrapped by AuthProvider, so a missing
 * context means a wiring bug that should be fixed immediately, not silently
 * degraded to "not logged in".
 *
 * @example
 * function MatchPage() {
 *   const { user, profile, signOut } = useAuth();
 *   if (!user) return <Navigate to="/login" />;
 *   return <p>Welcome, {profile?.username}</p>;
 * }
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error(
      'useAuth() called outside <AuthProvider>. ' +
        'Wrap your app in <AuthProvider> inside main.tsx.',
    );
  }
  return ctx;
}
