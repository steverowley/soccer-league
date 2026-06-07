// ── match-worker/postMatchEffects.test.ts ────────────────────────────────────
// Unit tests for the worker-side wager settlement (issue #528).  These run
// under vitest via the `supabase/functions/**` include glob; postMatchEffects
// and its transitive imports are pure local .ts (no remote ESM / Deno globals
// at module scope), so they load fine in the node/jsdom test runtime.
//
// The point of these tests is to prove the worker now settles through the
// atomic `settle_wager` RPC (migration 0053) and NOT through the old
// non-atomic update-then-read-modify-write on `profiles.credits`:
//   • the winner is credited exactly once,
//   • a re-run of a completed match credits nobody twice (idempotent),
//   • `from('profiles').update(...)` is never called — settlement is fully
//     RPC-driven, so there is no window where a crash leaves a bet
//     "won but unpaid".

import { describe, it, expect } from 'vitest';
import { settleMatchWagers } from './postMatchEffects.ts';

// ── In-memory fake Supabase client ──────────────────────────────────────────
// Mirrors the shim in src/features/betting/api/wagers.test.ts: the `rpc`
// implementation reproduces the real settle_wager SQL semantics (lock the
// wager row, no-op if already settled, flip status + payout, credit winner).

interface WagerRow {
  id: string;
  user_id: string;
  match_id: string;
  team_choice: 'home' | 'draw' | 'away';
  stake: number;
  odds_snapshot: number;
  status: 'open' | 'won' | 'lost' | 'void';
  payout: number | null;
}

interface ProfileRow {
  id: string;
  credits: number;
}

interface Store {
  wagers: WagerRow[];
  profiles: ProfileRow[];
}

interface Spy {
  /** Every table name `from()` was invoked with — proves we never read/write profiles. */
  fromTables: string[];
  /** Count of `from('profiles').update(...)` terminations — must stay 0. */
  profileUpdates: number;
  /** Every rpc call (name + args) — lets us assert settle_wager is the only path. */
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
}

function makeWager(over: Partial<WagerRow> = {}): WagerRow {
  return {
    id: 'w1',
    user_id: 'u1',
    match_id: 'm1',
    team_choice: 'home',
    stake: 50,
    odds_snapshot: 2.0,
    status: 'open',
    payout: null,
    ...over,
  };
}

function makeFakeDb(store: Store, spy: Spy) {
  function from(table: keyof Store) {
    spy.fromTables.push(table);
    const filters: Array<{ col: string; val: unknown }> = [];
    let mode: 'select' | 'update' = 'select';
    let payload: Record<string, unknown> | null = null;

    function applyFilters<T extends Record<string, unknown>>(rows: T[]): T[] {
      return rows.filter((r) => filters.every((f) => r[f.col] === f.val));
    }

    async function executor<T>(): Promise<{ data: T; error: null }> {
      const rows = store[table] as unknown as Record<string, unknown>[];
      if (mode === 'update' && payload) {
        if (table === 'profiles') spy.profileUpdates += 1;
        const matched = applyFilters(rows);
        for (const r of matched) Object.assign(r, payload);
        return { data: matched as unknown as T, error: null };
      }
      return { data: applyFilters(rows) as unknown as T, error: null };
    }

    const builder: Record<string, unknown> = {
      select() { mode = 'select'; return builder; },
      update(p: Record<string, unknown>) { mode = 'update'; payload = p; return builder; },
      eq(col: string, val: unknown) { filters.push({ col, val }); return builder; },
      then<T>(resolve: (v: { data: T; error: null }) => unknown) {
        return executor<T>().then(resolve);
      },
    };
    return builder;
  }

  async function rpc(name: string, args: Record<string, unknown>) {
    spy.rpcCalls.push({ name, args });
    if (name === 'settle_wager') {
      const wagerId = args.p_wager_id as string;
      const status = args.p_status as 'won' | 'lost' | 'void';
      const payout = (args.p_payout as number) || 0;

      const wager = store.wagers.find((w) => w.id === wagerId);
      if (!wager) return { data: null, error: { message: 'wager not found' } };
      // Idempotency: already-settled wager returns false (matches the RPC).
      if (wager.status !== 'open') return { data: false, error: null };

      wager.status = status;
      wager.payout = payout > 0 ? payout : null;
      if (status === 'won' && payout > 0) {
        const profile = store.profiles.find((p) => p.id === wager.user_id);
        if (profile) profile.credits += payout;
      }
      return { data: true, error: null };
    }
    return { data: null, error: { message: `unknown rpc ${name}` } };
  }

  // deno-lint-ignore no-explicit-any
  return { from, rpc } as any;
}

function makeSpy(): Spy {
  return { fromTables: [], profileUpdates: 0, rpcCalls: [] };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('settleMatchWagers (worker, #528)', () => {
  it('credits the winner via settle_wager and reports the payout', async () => {
    const store: Store = {
      wagers: [makeWager({ team_choice: 'home', stake: 50, odds_snapshot: 2.5 })],
      profiles: [{ id: 'u1', credits: 200 }],
    };
    const spy = makeSpy();

    // Home wins 2–0.
    const summary = await settleMatchWagers(makeFakeDb(store, spy), 'm1', 2, 0);

    expect(summary).toEqual({ settled: 1, totalPayout: 125 }); // floor(50 × 2.5)
    expect(store.wagers[0]!.status).toBe('won');
    expect(store.wagers[0]!.payout).toBe(125);
    expect(store.profiles[0]!.credits).toBe(200 + 125);
    // Settlement went through the RPC, not a direct profiles write.
    expect(spy.rpcCalls.map((c) => c.name)).toEqual(['settle_wager']);
    expect(spy.profileUpdates).toBe(0);
    expect(spy.fromTables).not.toContain('profiles');
  });

  it('marks a losing wager lost with no credit change', async () => {
    const store: Store = {
      wagers: [makeWager({ team_choice: 'away', stake: 75, odds_snapshot: 3.0 })],
      profiles: [{ id: 'u1', credits: 200 }],
    };
    const spy = makeSpy();

    const summary = await settleMatchWagers(makeFakeDb(store, spy), 'm1', 1, 0);

    expect(summary).toEqual({ settled: 1, totalPayout: 0 });
    expect(store.wagers[0]!.status).toBe('lost');
    expect(store.wagers[0]!.payout).toBeNull();
    expect(store.profiles[0]!.credits).toBe(200);
    expect(spy.profileUpdates).toBe(0);
  });

  it('no-ops with no RPC calls when there are no open wagers', async () => {
    const store: Store = {
      wagers: [makeWager({ status: 'won', payout: 200 })],
      profiles: [{ id: 'u1', credits: 500 }],
    };
    const spy = makeSpy();

    const summary = await settleMatchWagers(makeFakeDb(store, spy), 'm1', 2, 0);

    expect(summary).toEqual({ settled: 0, totalPayout: 0 });
    expect(spy.rpcCalls).toHaveLength(0);
    expect(store.profiles[0]!.credits).toBe(500);
  });

  it('settles multiple wagers, crediting only the winning side', async () => {
    const store: Store = {
      wagers: [
        makeWager({ id: 'w1', user_id: 'u1', team_choice: 'home', stake: 100, odds_snapshot: 2.0 }),
        makeWager({ id: 'w2', user_id: 'u2', team_choice: 'draw', stake: 50, odds_snapshot: 3.5 }),
        makeWager({ id: 'w3', user_id: 'u3', team_choice: 'away', stake: 75, odds_snapshot: 4.0 }),
      ],
      profiles: [
        { id: 'u1', credits: 100 },
        { id: 'u2', credits: 100 },
        { id: 'u3', credits: 100 },
      ],
    };
    const spy = makeSpy();

    // Home win 3–1 → only u1 wins (100 × 2.0 = 200).
    const summary = await settleMatchWagers(makeFakeDb(store, spy), 'm1', 3, 1);

    expect(summary).toEqual({ settled: 3, totalPayout: 200 });
    expect(store.wagers.find((w) => w.id === 'w1')!.status).toBe('won');
    expect(store.wagers.find((w) => w.id === 'w2')!.status).toBe('lost');
    expect(store.wagers.find((w) => w.id === 'w3')!.status).toBe('lost');
    expect(store.profiles.find((p) => p.id === 'u1')!.credits).toBe(300);
    expect(store.profiles.find((p) => p.id === 'u2')!.credits).toBe(100);
    expect(store.profiles.find((p) => p.id === 'u3')!.credits).toBe(100);
    expect(spy.profileUpdates).toBe(0);
  });

  it('is idempotent: re-running a completed match credits nobody twice', async () => {
    const store: Store = {
      wagers: [makeWager({ team_choice: 'home', stake: 100, odds_snapshot: 2.0 })],
      profiles: [{ id: 'u1', credits: 100 }],
    };
    const spy = makeSpy();
    const db = makeFakeDb(store, spy);

    const first = await settleMatchWagers(db, 'm1', 2, 0);
    expect(first).toEqual({ settled: 1, totalPayout: 200 });
    expect(store.profiles[0]!.credits).toBe(300);

    // Second run (e.g. a worker retry): the wager is no longer 'open', so the
    // select returns nothing and the winner is NOT paid again.
    const second = await settleMatchWagers(db, 'm1', 2, 0);
    expect(second).toEqual({ settled: 0, totalPayout: 0 });
    expect(store.profiles[0]!.credits).toBe(300);
  });
});
