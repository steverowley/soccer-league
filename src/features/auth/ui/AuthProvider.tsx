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
  /** Create a new account. Returns an error string on failure. */
  signUp: (email: string, password: string, username: string) => Promise<string | null>;
  /** Sign out and clear all auth state. */
  signOut: () => Promise<void>;
  /** Force-refresh the profile from the DB (e.g. after a credit change). */
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ── Debounce interval for touchLastSeen ─────────────────────────────────────
/**
 * Minimum milliseconds between `last_seen_at` writes. 60 000 ms = 1 minute.
 * This prevents a flood of UPDATEs when the user navigates rapidly between
 * pages. Phase 3's fan-boost query uses a 5-minute window, so a 1-minute
 * touch rate is more than sufficient to keep the user "present".
 */
const TOUCH_DEBOUNCE_MS = 60_000;

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
    } = db.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        fetchProfile();
      } else {
        setProfile(null);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [db, fetchProfile]);

  // ── Touch last_seen_at when user is authenticated ───────────────────────
  useEffect(() => {
    if (user) {
      debouncedTouch();
    }
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
    async (email: string, password: string, username: string): Promise<string | null> => {
      const { data, error } = await db.auth.signUp({ email, password });
      if (error) return error.message;

      // The trigger `on_auth_user_created` auto-creates the profile with a
      // placeholder username. If the user provided a real username during
      // signup, update it immediately.
      if (data.user && username) {
        // CAST:profiles — profiles table not yet in generated database.ts.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db as any)
          .from('profiles')
          .update({ username })
          .eq('id', data.user.id);
      }

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
