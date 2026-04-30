// ── features/admin/api/admin.test.ts ─────────────────────────────────────────
// Integration-style tests for the admin DB layer.  Same in-memory Supabase
// double pattern used in `betting/api/wagers.test.ts` + `match/api/seasons
// .test.ts`: a hand-rolled chained query builder backed by an in-memory
// store.  Each test that wants to verify an UPDATE inspects the store row
// directly rather than asserting on the response payload — closer to what
// real PostgREST callers care about.

import { describe, it, expect, beforeEach } from 'vitest';
import { fastForwardScheduledMatches } from './admin';
import type { IslSupabaseClient } from '@shared/supabase/client';

// ── In-memory store shape ────────────────────────────────────────────────────

interface MatchRow {
  id:           string;
  status:       string;
  scheduled_at: string | null;
}

interface FakeStore {
  matches: MatchRow[];
}

/**
 * Build a fake Supabase client backed by `store`.  Implements the chain
 * surface this api file actually uses: from / select / update / eq / in /
 * not / await-thenable.  Anything outside that surface throws — the test
 * that triggers the mismatch will fail loudly.
 */
function makeFakeDb(store: FakeStore): IslSupabaseClient {
  function from(table: keyof FakeStore) {
    type Filter =
      | { kind: 'eq';  col: string; val: unknown }
      | { kind: 'in';  col: string; val: unknown[] }
      | { kind: 'not'; col: string; op:  'is'; val: 'null' | unknown };
    const filters: Filter[] = [];
    let mode:    'select' | 'update' = 'select';
    let payload: Record<string, unknown> | null = null;

    function applyFilters<T extends Record<string, unknown>>(rows: T[]): T[] {
      let out = rows;
      for (const f of filters) {
        if (f.kind === 'eq')        out = out.filter((r) => r[f.col] === f.val);
        else if (f.kind === 'in')   out = out.filter((r) => f.val.includes(r[f.col]));
        else if (f.kind === 'not' && f.op === 'is' && f.val === 'null') {
          // `.not('col', 'is', null)` → keep rows where col is not null.
          out = out.filter((r) => r[f.col] != null);
        }
      }
      return out;
    }

    async function executor<T>(): Promise<{ data: T; error: null }> {
      const rows = store[table] as unknown as Record<string, unknown>[];
      if (mode === 'update' && payload) {
        const matched = applyFilters(rows);
        for (const r of matched) Object.assign(r, payload);
        return { data: matched as unknown as T, error: null };
      }
      return { data: applyFilters(rows) as unknown as T, error: null };
    }

    const builder: Record<string, unknown> = {
      // .select() before .update() means a read; after .update() it tells
      // PostgREST to return the affected rows — preserve the update mode.
      select() { if (mode !== 'update') mode = 'select'; return builder; },
      update(p: Record<string, unknown>) { mode = 'update'; payload = p; return builder; },
      eq(col: string, val: unknown) { filters.push({ kind: 'eq', col, val }); return builder; },
      in(col: string, vals: unknown[]) { filters.push({ kind: 'in', col, val: vals }); return builder; },
      not(col: string, op: 'is', val: unknown) {
        filters.push({ kind: 'not', col, op, val: val as 'null' });
        return builder;
      },
      then<T>(resolve: (v: { data: T; error: null }) => unknown) {
        return executor<T>().then(resolve);
      },
    };
    return builder;
  }

  return { from } as unknown as IslSupabaseClient;
}

// ── Common state ────────────────────────────────────────────────────────────

let store: FakeStore;

beforeEach(() => {
  store = { matches: [] };
});

// ── fastForwardScheduledMatches ──────────────────────────────────────────────

describe('fastForwardScheduledMatches', () => {
  it('shifts every scheduled match backward by the requested hours', async () => {
    // Two scheduled matches kicking off 2 hours in the future.
    const future = new Date(Date.UTC(2030, 0, 1, 12, 0, 0)).toISOString();
    const futureLater = new Date(Date.UTC(2030, 0, 1, 14, 0, 0)).toISOString();
    store.matches.push(
      { id: 'm1', status: 'scheduled', scheduled_at: future      },
      { id: 'm2', status: 'scheduled', scheduled_at: futureLater },
    );

    const result = await fastForwardScheduledMatches(makeFakeDb(store), 1);

    expect(result.matchesShifted).toBe(2);
    expect(result.hoursShifted).toBe(1);
    // Each scheduled_at should be exactly one hour earlier than its
    // original value.  Equality check converts ISO strings → ms back to ms
    // so we don't get bitten by ISO formatting differences.
    expect(Date.parse(store.matches[0]!.scheduled_at!))
      .toBe(Date.parse(future) - 3_600_000);
    expect(Date.parse(store.matches[1]!.scheduled_at!))
      .toBe(Date.parse(futureLater) - 3_600_000);
  });

  it('skips matches not in scheduled status', async () => {
    // Only the scheduled one should be shifted; in_progress / completed /
    // cancelled rows must be untouched (worker is already past them).
    const ts = new Date(Date.UTC(2030, 0, 1, 12, 0, 0)).toISOString();
    store.matches.push(
      { id: 'mA', status: 'scheduled',   scheduled_at: ts },
      { id: 'mB', status: 'in_progress', scheduled_at: ts },
      { id: 'mC', status: 'completed',   scheduled_at: ts },
      { id: 'mD', status: 'cancelled',   scheduled_at: ts },
    );

    const result = await fastForwardScheduledMatches(makeFakeDb(store), 2);

    expect(result.matchesShifted).toBe(1);
    expect(Date.parse(store.matches[0]!.scheduled_at!))
      .toBe(Date.parse(ts) - 7_200_000);
    // The other rows kept their original timestamps verbatim.
    expect(store.matches[1]!.scheduled_at).toBe(ts);
    expect(store.matches[2]!.scheduled_at).toBe(ts);
    expect(store.matches[3]!.scheduled_at).toBe(ts);
  });

  it('skips scheduled rows whose scheduled_at is null', async () => {
    // Defensive: legacy fixtures created before migration 0009 may have
    // scheduled_at = null.  We must NOT subtract from null.
    const ts = new Date(Date.UTC(2030, 0, 1, 12, 0, 0)).toISOString();
    store.matches.push(
      { id: 'm1', status: 'scheduled', scheduled_at: ts   },
      { id: 'm2', status: 'scheduled', scheduled_at: null },
    );

    const result = await fastForwardScheduledMatches(makeFakeDb(store), 1);

    expect(result.matchesShifted).toBe(1);
    expect(store.matches[1]!.scheduled_at).toBeNull();
  });

  it('returns a no-op result for non-positive hours', async () => {
    // Negative or zero must not be allowed to shift fixtures forward in
    // time — that would silently make them invisible to the worker.
    const ts = new Date(Date.UTC(2030, 0, 1, 12, 0, 0)).toISOString();
    store.matches.push({ id: 'm1', status: 'scheduled', scheduled_at: ts });

    const r1 = await fastForwardScheduledMatches(makeFakeDb(store), 0);
    const r2 = await fastForwardScheduledMatches(makeFakeDb(store), -5);
    const r3 = await fastForwardScheduledMatches(makeFakeDb(store), Number.NaN);

    expect(r1).toEqual({ matchesShifted: 0, hoursShifted: 0 });
    expect(r2).toEqual({ matchesShifted: 0, hoursShifted: 0 });
    expect(r3).toEqual({ matchesShifted: 0, hoursShifted: 0 });
    // Original timestamp must be unchanged after all three calls.
    expect(store.matches[0]!.scheduled_at).toBe(ts);
  });

  it('returns matchesShifted=0 cleanly when no scheduled rows exist', async () => {
    // Empty store — common during a fresh-season setup before fixture
    // generation has run.  Must not crash; must not write anything.
    const result = await fastForwardScheduledMatches(makeFakeDb(store), 1);
    expect(result).toEqual({ matchesShifted: 0, hoursShifted: 1 });
  });
});
