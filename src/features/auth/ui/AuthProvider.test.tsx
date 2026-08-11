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
 * touches on mount: `auth.getSession`, `auth.onAuthStateChange`, the
 * `from(...).select(...).eq(...).single()` chain used by the profile fetch, and
 * `rpc` for the login-streak bump. Per-test behaviour is injected via
 * `getSession`.
 *
 * The returned `spies` expose the auth-state callback gotrue would invoke, plus
 * every lock-taking entry point, so a test can assert WHEN each is called.
 *
 * @param getSession  The mock used for `auth.getSession()` — the call under test.
 */
function makeClient(getSession: () => Promise<unknown>) {
  const single = vi.fn().mockResolvedValue({ data: null, error: null });
  const eq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq }));
  // `update(...).eq(...)` is awaited directly by touchLastSeen — the presence
  // touch the auth effect fires once a user lands.
  const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
  const from = vi.fn(() => ({ select, update }));
  const rpc = vi.fn().mockResolvedValue({ data: 1, error: null });

  // Captured so tests can fire an auth event the way gotrue does.
  let authCallback: ((event: string, session: unknown) => void) | null = null;
  const unsubscribe = vi.fn();

  const client = {
    auth: {
      getSession,
      onAuthStateChange: vi.fn((cb: (event: string, session: unknown) => void) => {
        authCallback = cb;
        return { data: { subscription: { unsubscribe } } };
      }),
    },
    from,
    rpc,
  } as unknown as IslSupabaseClient;

  return {
    client,
    spies: { from, rpc, unsubscribe },
    emitAuthEvent: (event: string, session: unknown) => authCallback?.(event, session),
  };
}

/** A session shaped like the fields AuthProvider reads off it. */
const SIGNED_IN_SESSION = {
  user: { id: '00000000-0000-0000-0000-000000000001', email: 'fan@isl.test' },
};

/**
 * `getSession` mock for the callback tests: the mount restore hangs (so no
 * mount-driven profile fetch muddies the assertions), while the call the
 * deferred profile fetch makes — `getOwnUserId` → `getSession` — resolves with
 * a signed-in session.
 */
function hangingRestoreThenSession() {
  return vi
    .fn()
    .mockImplementationOnce(() => new Promise<never>(() => {}))
    .mockResolvedValue({ data: { session: SIGNED_IN_SESSION } });
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
    const { client } = makeClient(() => Promise.resolve({ data: { session: null } }));
    renderWith(client);
    // findBy* retries until the async getSession resolves and state flushes.
    expect(await screen.findByText('ready')).toBeInTheDocument();
  });

  it('clears loading even when session restore rejects', async () => {
    // The core regression: a rejected getSession previously had no `.catch`,
    // so `loading` never flipped and the app hung on the void screen.
    const { client } = makeClient(() => Promise.reject(new Error('network down')));
    renderWith(client);
    expect(await screen.findByText('ready')).toBeInTheDocument();
  });

  it('clears loading via the failsafe when session restore never settles', async () => {
    vi.useFakeTimers();
    // A promise that never resolves models a hung token refresh / dead socket.
    const { client } = makeClient(() => new Promise<never>(() => {}));
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

// ── Auth-lock hold guard ─────────────────────────────────────────────────────
// gotrue-js runs the onAuthStateChange callback while holding its auth lock,
// and the holder drains everything the app started before releasing. So work
// done in this callback extends the hold; other Supabase callers wait on the
// real Web Lock, give up after 5 s, and steal it — killing the in-flight
// chain. Observed in production as repeated `Lock "lock:sb-…-auth-token" was
// not released within 5000ms`, a bump_login_streak RPC dying with `released
// because another request stole it`, and unrelated page reads aborting.
//
// The invariant these tests hold: the callback body itself does nothing but
// schedule — no Supabase call, and no React state commit (which would flush
// the presence-touch effect into the same hold) — and the real work lands in a
// later macrotask.
describe('AuthProvider auth-state callback', () => {
  it('makes no Supabase call synchronously inside the callback', () => {
    vi.useFakeTimers();
    const { client, spies, emitAuthEvent } = makeClient(hangingRestoreThenSession());
    renderWith(client);

    act(() => {
      emitAuthEvent('SIGNED_IN', SIGNED_IN_SESSION);
    });

    // Nothing that would extend the lock hold may have run yet.
    expect(spies.rpc).not.toHaveBeenCalled();
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('bumps the login streak and refetches the profile once the lock is released', async () => {
    vi.useFakeTimers();
    const { client, spies, emitAuthEvent } = makeClient(hangingRestoreThenSession());
    renderWith(client);

    act(() => {
      emitAuthEvent('SIGNED_IN', SIGNED_IN_SESSION);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(spies.rpc).toHaveBeenCalledWith('bump_login_streak');
    expect(spies.from).toHaveBeenCalledWith('profiles');
  });

  it('refetches the profile without bumping the streak on a token refresh', async () => {
    vi.useFakeTimers();
    const { client, spies, emitAuthEvent } = makeClient(hangingRestoreThenSession());
    renderWith(client);

    act(() => {
      emitAuthEvent('TOKEN_REFRESHED', SIGNED_IN_SESSION);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // The RPC is idempotent per UTC day, so bumping on the hourly refresh would
    // be pure noise — the profile refetch is the only work that belongs here.
    expect(spies.rpc).not.toHaveBeenCalled();
    expect(spies.from).toHaveBeenCalledWith('profiles');
  });

  it('drops deferred work when the provider unmounts before it runs', async () => {
    vi.useFakeTimers();
    const { client, spies, emitAuthEvent } = makeClient(hangingRestoreThenSession());
    const { unmount } = renderWith(client);

    act(() => {
      emitAuthEvent('SIGNED_IN', SIGNED_IN_SESSION);
    });
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(spies.rpc).not.toHaveBeenCalled();
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('clears the profile on sign-out without deferring anything', () => {
    vi.useFakeTimers();
    const { client, spies, emitAuthEvent } = makeClient(hangingRestoreThenSession());
    renderWith(client);

    act(() => {
      emitAuthEvent('SIGNED_OUT', null);
    });
    vi.advanceTimersByTime(0);

    expect(spies.rpc).not.toHaveBeenCalled();
    expect(spies.from).not.toHaveBeenCalled();
  });
});
