// ── SupabaseProvider.tsx ─────────────────────────────────────────────────────
// WHY: Dependency injection for the Supabase client via React context.
//
// Features must never import `supabaseClient` from client.ts directly. Instead,
// they call `useSupabase()` to receive the client from context. This one
// indirection buys two things:
//
//   1. TESTABILITY — unit tests can render a component inside a
//      <SupabaseProvider client={fakeSupa}> and all nested `useSupabase()`
//      calls receive the fake. No module mocking, no global state patching.
//
//   2. FUTURE-PROOFING — if we ever swap Supabase for a different backend,
//      the change is contained to this file and client.ts. Feature code that
//      calls `useSupabase()` is unaffected.
//
// USAGE (in src/main.tsx or the app shell):
//
//   import { SupabaseProvider } from '@shared/supabase/SupabaseProvider';
//   import { supabaseClient } from '@shared/supabase/client';
//
//   <SupabaseProvider client={supabaseClient}>
//     <App />
//   </SupabaseProvider>
//
// USAGE (in a feature component):
//
//   import { useSupabase } from '@shared/supabase/SupabaseProvider';
//   const db = useSupabase();
//   const { data } = await db.from('matches').select('*');
//
// USAGE (in a test):
//
//   import { SupabaseProvider } from '@shared/supabase/SupabaseProvider';
//   const fakeClient = { from: vi.fn() } as unknown as IslSupabaseClient;
//   render(<SupabaseProvider client={fakeClient}><MyComponent /></SupabaseProvider>);

import { createContext, useContext, type ReactNode } from 'react';
import type { IslSupabaseClient } from './client';

// ── Context definition ────────────────────────────────────────────────────────
// The context value is the typed Supabase client, or `null` when accessed
// outside a provider (which `useSupabase()` turns into a descriptive error).

const SupabaseContext = createContext<IslSupabaseClient | null>(null);

// ── Provider component ────────────────────────────────────────────────────────

/** Props for {@link SupabaseProvider}. */
interface SupabaseProviderProps {
  /**
   * The Supabase client instance to inject.
   * In production this is `supabaseClient` from `@shared/supabase/client`.
   * In tests this should be a fake/stub that satisfies `IslSupabaseClient`.
   */
  client: IslSupabaseClient;
  /** The React subtree that will have access to the Supabase client. */
  children: ReactNode;
}

/**
 * Wraps the application (or a test subtree) with a Supabase client instance
 * that all nested components and hooks can consume via `useSupabase()`.
 *
 * Mount this once near the root of the app, outside any route boundaries,
 * so every page and feature has access to the same client instance.
 *
 * @example
 * // src/main.tsx
 * <SupabaseProvider client={supabaseClient}>
 *   <RouterProvider router={router} />
 * </SupabaseProvider>
 */
export function SupabaseProvider({ client, children }: SupabaseProviderProps) {
  return <SupabaseContext.Provider value={client}>{children}</SupabaseContext.Provider>;
}

// ── useSupabase hook ──────────────────────────────────────────────────────────

/**
 * Returns the injected `IslSupabaseClient` from the nearest
 * `<SupabaseProvider>` ancestor.
 *
 * Throws a descriptive error if called outside a provider — this is
 * intentional. A missing provider is a programming error, not a recoverable
 * runtime condition, and an early throw with a clear message is faster to
 * debug than a silent `null` propagating through query results.
 *
 * @returns The typed Supabase client for the current provider scope.
 * @throws {Error} If called outside a `<SupabaseProvider>`.
 *
 * @example
 * function MyComponent() {
 *   const db = useSupabase();
 *   const [teams, setTeams] = useState([]);
 *   useEffect(() => {
 *     db.from('teams').select('*').then(({ data }) => setTeams(data ?? []));
 *   }, [db]);
 * }
 */
export function useSupabase(): IslSupabaseClient {
  const client = useContext(SupabaseContext);

  if (client === null) {
    throw new Error(
      'useSupabase() was called outside of a <SupabaseProvider>. ' +
        'Wrap your component tree with <SupabaseProvider client={supabaseClient}> ' +
        'in src/main.tsx (or in your test render helper).',
    );
  }

  return client;
}
