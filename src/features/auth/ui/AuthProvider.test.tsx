// ── AuthProvider.test.tsx ────────────────────────────────────────────────────
// Regression coverage for the "stuck on Checking the void for an active
// session…" bug: the whole app gates rendering behind AuthProvider's `loading`
// flag, and the original mount effect had no `.catch` or timeout on
// `getSession()`. A slow or rejected/never-settling auth call therefore pinned
// `loading` true forever, leaving the user unable to reach the login form.
//
// These tests assert the failsafe: `loading` ALWAYS clears — on a clean
// logged-out restore, on a rejected restore, and (via the timeout) on a
// restore that never settles at all.

import { render, screen, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SupabaseProvider } from '@shared/supabase/SupabaseProvider';
import type { IslSupabaseClient } from '@shared/supabase/client';
import { AuthProvider, useAuth } from './AuthProvider';

// ── Probe component ───────────────────────────────────────────────────────────
// Renders the auth `loading` flag as text so tests can assert when the gate
// clears without depending on any page's markup.
function LoadingProbe() {
  const { loading } = useAuth();
  return <span data-testid="state">{loading ? 'loading' : 'ready'}</span>;
}

/**
 * Build a minimal fake Supabase client satisfying the surface AuthProvider
 * touches on mount: `auth.getSession`, `auth.onAuthStateChange`, and the
 * `auth.getUser` + `from(...).select(...).eq(...).single()` chain used by the
 * profile fetch. Per-test behaviour is injected via `getSession`.
 *
 * @param getSession  The mock used for `auth.getSession()` — the call under test.
 */
function makeClient(getSession: () => Promise<unknown>): IslSupabaseClient {
  const single = vi.fn().mockResolvedValue({ data: null, error: null });
  const eq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq }));
  return {
    auth: {
      getSession,
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
    from: vi.fn(() => ({ select })),
  } as unknown as IslSupabaseClient;
}

function renderWith(client: IslSupabaseClient) {
  return render(
    <SupabaseProvider client={client}>
      <AuthProvider>
        <LoadingProbe />
      </AuthProvider>
    </SupabaseProvider>,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('AuthProvider loading gate', () => {
  it('clears loading when there is no stored session', async () => {
    const client = makeClient(() => Promise.resolve({ data: { session: null } }));
    renderWith(client);
    // findBy* retries until the async getSession resolves and state flushes.
    expect(await screen.findByText('ready')).toBeInTheDocument();
  });

  it('clears loading even when session restore rejects', async () => {
    // The core regression: a rejected getSession previously had no `.catch`,
    // so `loading` never flipped and the app hung on the void screen.
    const client = makeClient(() => Promise.reject(new Error('network down')));
    renderWith(client);
    expect(await screen.findByText('ready')).toBeInTheDocument();
  });

  it('clears loading via the failsafe when session restore never settles', async () => {
    vi.useFakeTimers();
    // A promise that never resolves models a hung token refresh / dead socket.
    const client = makeClient(() => new Promise<never>(() => {}));
    renderWith(client);

    // Still blocked before the failsafe window elapses.
    expect(screen.getByTestId('state')).toHaveTextContent('loading');

    // Advance past AUTH_RESOLVE_TIMEOUT_MS (8 s) — the failsafe drops the gate.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect(screen.getByTestId('state')).toHaveTextContent('ready');
  });
});
