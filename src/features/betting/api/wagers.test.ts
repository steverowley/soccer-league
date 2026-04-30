// ── betting/api/wagers.test.ts ───────────────────────────────────────────────
// WHY: Integration-style coverage for the wager DB layer. The pure logic in
// `logic/settlement.ts` is unit-tested separately; these tests verify that
// `settleMatchWagers` correctly orchestrates the chain — read open wagers →
// resolve → update wager row → credit winner — by inspecting the Supabase
// call surface via an in-memory fake client.
//
// MOCK STRATEGY
//   We build a hand-rolled Supabase client double that records every chained
//   call as a tiny query plan, then resolves it against an in-memory store.
//   This is intentionally limited to the wager + profile tables — wider
//   surface coverage lives in the api modules' own integration suites.
//
// COVERAGE
//   • settleMatchWagers — happy path: home win pays out the home backer.
//   • settleMatchWagers — losing branch: away wager on a home win → status='lost'.
//   • settleMatchWagers — no open wagers → returns 0, no DB writes.
//   • getUserWagerForMatch — returns the most recent wager for the user/match
//     pair; returns null when no wager exists.

import { describe, it, expect, beforeEach } from 'vitest';
import { settleMatchWagers, getUserWagerForMatch } from './wagers';
import type { Wager } from '../types';
import type { IslSupabaseClient } from '@shared/supabase/client';

// ── In-memory fake Supabase client ──────────────────────────────────────────
// We model the *chained* PostgREST API: from(table) → select / update /
// .eq() / .order() / .limit() / .single() / .maybeSingle(). Each call
// returns a thenable so `await` resolves with `{ data, error }`. The fake
// only implements the tables and methods exercised by the betting api.

interface ProfileRow {
  id:      string;
  credits: number;
}

interface FakeStore {
  wagers:   Wager[];
  profiles: ProfileRow[];
}

/**
 * Build a fake Supabase client backed by the provided in-memory store.
 *
 * Filters apply in the order the test calls them; each chain method returns
 * a fresh thenable so the test runner can `await` the final result. Mutating
 * methods (.update) modify the in-store row in place so downstream selects
 * see the new value — same semantics as a real DB.
 *
 * @param store  Mutable in-memory tables to read from / write to.
 * @returns      An object satisfying the IslSupabaseClient surface used by
 *               the betting api (cast at call site, since the fake covers
 *               only a strict subset).
 */
function makeFakeDb(store: FakeStore): IslSupabaseClient {
  // Each `.from()` call starts a fresh "query plan" — the builder accumulates
  // filters and exposes terminator methods (single / maybeSingle / await).
  function from(table: keyof FakeStore) {
    type Filter = { col: string; val: unknown };
    const filters: Filter[] = [];
    let mode:    'select' | 'update' | 'insert' = 'select';
    let payload: Record<string, unknown> | null = null;
    let order:   { col: string; ascending: boolean } | null = null;
    let limit:   number | null = null;

    function applyFilters<T extends Record<string, unknown>>(rows: T[]): T[] {
      let out = rows;
      for (const f of filters) {
        out = out.filter((r) => r[f.col] === f.val);
      }
      if (order) {
        const { col, ascending } = order;
        out = [...out].sort((a, b) => {
          const av = a[col] as string | number;
          const bv = b[col] as string | number;
          if (av < bv) return ascending ? -1 : 1;
          if (av > bv) return ascending ? 1 : -1;
          return 0;
        });
      }
      if (limit != null) out = out.slice(0, limit);
      return out;
    }

    async function executor<T>(): Promise<{ data: T; error: null }> {
      const rows = store[table] as unknown as Record<string, unknown>[];

      if (mode === 'update' && payload) {
        const matched = applyFilters(rows);
        for (const r of matched) Object.assign(r, payload);
        return { data: matched as unknown as T, error: null };
      }

      const matched = applyFilters(rows);
      return { data: matched as unknown as T, error: null };
    }

    const builder: Record<string, unknown> = {
      select() { mode = 'select'; return builder; },
      update(p: Record<string, unknown>) { mode = 'update'; payload = p; return builder; },
      eq(col: string, val: unknown) { filters.push({ col, val }); return builder; },
      order(col: string, opts?: { ascending?: boolean }) {
        order = { col, ascending: opts?.ascending !== false };
        return builder;
      },
      limit(n: number) { limit = n; return builder; },
      single() {
        // single() throws if zero or >1 rows — but the test fakes never
        // exercise that branch, so we just return the first match or null.
        return executor<unknown>().then((r) => {
          const arr = r.data as unknown[];
          return { data: arr[0] ?? null, error: null };
        });
      },
      maybeSingle() {
        return executor<unknown>().then((r) => {
          const arr = r.data as unknown[];
          return { data: arr[0] ?? null, error: null };
        });
      },
      then<T>(resolve: (v: { data: T; error: null }) => unknown) {
        return executor<T>().then(resolve);
      },
    };
    return builder;
  }

  return { from } as unknown as IslSupabaseClient;
}

// ── Common fixtures ─────────────────────────────────────────────────────────

function makeWager(overrides: Partial<Wager> = {}): Wager {
  return {
    id:            'w-' + Math.random().toString(36).slice(2, 8),
    user_id:       'u1',
    match_id:      'm1',
    team_choice:   'home',
    stake:         100,
    odds_snapshot: 2.0,
    status:        'open',
    payout:        null,
    created_at:    '2026-04-01T11:00:00Z',
    ...overrides,
  };
}

let store: FakeStore;

beforeEach(() => {
  store = { wagers: [], profiles: [] };
});

// ── settleMatchWagers ──────────────────────────────────────────────────────

describe('settleMatchWagers', () => {
  it('credits the winner and marks the wager won', async () => {
    // Setup: one open home-win wager from a user with 200 credits.
    store.wagers.push(makeWager({
      id: 'w1', user_id: 'u1', match_id: 'm1',
      team_choice: 'home', stake: 50, odds_snapshot: 2.5,
    }));
    store.profiles.push({ id: 'u1', credits: 200 });

    // Run: home wins 2–0.
    const settled = await settleMatchWagers(makeFakeDb(store), 'm1', 2, 0);

    // Verify: 1 wager settled, status flipped to 'won', payout = 50 × 2.5 = 125,
    // user balance jumps from 200 → 325 (stake was already deducted at placement,
    // so the full payout is added on settlement).
    expect(settled).toBe(1);
    const wager = store.wagers[0]!;
    expect(wager.status).toBe('won');
    expect(wager.payout).toBe(125);
    expect(store.profiles[0]!.credits).toBe(200 + 125);
  });

  it('marks the wager lost without any credit change', async () => {
    // Setup: an away-win wager — but home will win.
    store.wagers.push(makeWager({
      id: 'w1', user_id: 'u1', match_id: 'm1',
      team_choice: 'away', stake: 75, odds_snapshot: 3.0,
    }));
    store.profiles.push({ id: 'u1', credits: 200 });

    const settled = await settleMatchWagers(makeFakeDb(store), 'm1', 1, 0);

    expect(settled).toBe(1);
    const wager = store.wagers[0]!;
    expect(wager.status).toBe('lost');
    // Lost wagers store payout=null (we filter `payout || null` in the update).
    expect(wager.payout).toBeNull();
    // No credit change — stake was already deducted on placement.
    expect(store.profiles[0]!.credits).toBe(200);
  });

  it('returns 0 with no DB writes when no open wagers exist', async () => {
    // Setup: a previously-settled wager + no open ones.
    store.wagers.push(makeWager({
      id: 'w1', status: 'won', payout: 200,
    }));
    store.profiles.push({ id: 'u1', credits: 500 });

    const settled = await settleMatchWagers(makeFakeDb(store), 'm1', 2, 0);

    expect(settled).toBe(0);
    // Nothing should have been touched — the historical row is preserved.
    expect(store.wagers[0]!.status).toBe('won');
    expect(store.wagers[0]!.payout).toBe(200);
    expect(store.profiles[0]!.credits).toBe(500);
  });

  it('settles multiple wagers on the same match independently', async () => {
    // Setup: three users, three different choices on the same match.
    store.wagers.push(
      makeWager({ id: 'w1', user_id: 'u1', team_choice: 'home', stake: 100, odds_snapshot: 2.0 }),
      makeWager({ id: 'w2', user_id: 'u2', team_choice: 'draw', stake: 50,  odds_snapshot: 3.5 }),
      makeWager({ id: 'w3', user_id: 'u3', team_choice: 'away', stake: 75,  odds_snapshot: 4.0 }),
    );
    store.profiles.push(
      { id: 'u1', credits: 100 },
      { id: 'u2', credits: 100 },
      { id: 'u3', credits: 100 },
    );

    // Match outcome: home win → only u1 wins.
    const settled = await settleMatchWagers(makeFakeDb(store), 'm1', 3, 1);

    expect(settled).toBe(3);
    expect(store.wagers.find((w) => w.id === 'w1')!.status).toBe('won');
    expect(store.wagers.find((w) => w.id === 'w2')!.status).toBe('lost');
    expect(store.wagers.find((w) => w.id === 'w3')!.status).toBe('lost');
    // Only u1 gets paid out (100 × 2.0 = 200 credits added).
    expect(store.profiles.find((p) => p.id === 'u1')!.credits).toBe(100 + 200);
    expect(store.profiles.find((p) => p.id === 'u2')!.credits).toBe(100);
    expect(store.profiles.find((p) => p.id === 'u3')!.credits).toBe(100);
  });
});

// ── getUserWagerForMatch ────────────────────────────────────────────────────

describe('getUserWagerForMatch', () => {
  it('returns null when the user has no wager on the match', async () => {
    // Empty store — confirms the maybeSingle path for the no-bet case.
    const result = await getUserWagerForMatch(makeFakeDb(store), 'u1', 'm1');
    expect(result).toBeNull();
  });

  it('returns the most recent wager for that user/match pair', async () => {
    // Two wagers same user/match — the order().limit(1) pipeline must
    // surface the freshest one (latest created_at).
    store.wagers.push(
      makeWager({ id: 'w-old', stake: 10, created_at: '2026-04-01T10:00:00Z' }),
      makeWager({ id: 'w-new', stake: 99, created_at: '2026-04-01T11:30:00Z' }),
    );

    const result = await getUserWagerForMatch(makeFakeDb(store), 'u1', 'm1');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('w-new');
    expect(result!.stake).toBe(99);
  });

  it('does not return wagers belonging to other users on the same match', async () => {
    // Ensures the user_id filter is applied — without it the wrong row would
    // surface and a viewer could see another user's bet.
    store.wagers.push(
      makeWager({ id: 'w-other', user_id: 'u2', stake: 500 }),
    );

    const result = await getUserWagerForMatch(makeFakeDb(store), 'u1', 'm1');
    expect(result).toBeNull();
  });
});
