// ── roadmap/api/bdIssues.test.ts ────────────────────────────────────────────
// Tests for the bd-issue Supabase query + Realtime subscription layer.
//
// We don't spin up a real Supabase here — instead we hand-roll a minimal
// in-memory client double that records the query chain (`.from`,
// `.select`, `.order`, `.limit`, `.maybeSingle`) and returns a
// configurable row set.  Same pattern as `claudeSessions.test.ts`.
//
// Coverage goals:
//   * `listBdIssues` returns validated rows.
//   * Invalid rows are dropped at the Zod boundary.
//   * The list query targets the right table + ordering.
//   * `getBdSyncedAt` returns the latest sync timestamp or '' on miss.
//   * `subscribeToBdIssues` wires the channel to the right table /
//     event set.

import { describe, it, expect, vi } from 'vitest';
import {
  listBdIssues,
  getBdSyncedAt,
  subscribeToBdIssues,
} from './bdIssues';
import type { IslSupabaseClient } from '@shared/supabase/client';

// ── Minimal in-memory client double ────────────────────────────────────────
// One builder shape supports every chained method we use across the
// module.  Terminal calls (`.order`, `.maybeSingle`) return a thenable
// so `await` resolves to the canned response.

/**
 * Recorded call to the fake query builder.  Each chained method appends
 * one of these so tests can assert the query shape without re-running
 * SQL.
 */
type ChainCall =
  | { fn: 'from';        table: string }
  | { fn: 'select';      cols: string }
  | { fn: 'order';       col: string; options: unknown }
  | { fn: 'limit';       n: number }
  | { fn: 'maybeSingle' };

/**
 * Build a fake Supabase client whose chain terminates at `.order(...)`
 * with `{ data: rows, error: null }`.  Used by the `listBdIssues` tests.
 *
 * @param rows  - Rows the eventual `.order(...)` resolves to.
 * @param calls - Mutable array that the chain pushes recorded calls into.
 * @returns     A typed double assignable to `IslSupabaseClient`.
 */
function makeListClient(rows: unknown[], calls: ChainCall[]): IslSupabaseClient {
  const builder = {
    select(cols: string) {
      calls.push({ fn: 'select', cols });
      return this;
    },
    order(col: string, options: unknown) {
      calls.push({ fn: 'order', col, options });
      return Promise.resolve({ data: rows, error: null });
    },
  };
  return {
    from(table: string) {
      calls.push({ fn: 'from', table });
      return builder;
    },
  } as unknown as IslSupabaseClient;
}

/**
 * Build a fake Supabase client whose chain terminates at
 * `.maybeSingle()` with `{ data, error: null }`.  Used by the
 * `getBdSyncedAt` test.
 *
 * @param data  - Single-row result (or null) the chain resolves to.
 * @param calls - Recorded chain calls.
 */
function makeSingleClient(data: unknown, calls: ChainCall[]): IslSupabaseClient {
  const builder = {
    select(cols: string) {
      calls.push({ fn: 'select', cols });
      return this;
    },
    order(col: string, options: unknown) {
      calls.push({ fn: 'order', col, options });
      return this;
    },
    limit(n: number) {
      calls.push({ fn: 'limit', n });
      return this;
    },
    maybeSingle() {
      calls.push({ fn: 'maybeSingle' });
      return Promise.resolve({ data, error: null });
    },
  };
  return {
    from(table: string) {
      calls.push({ fn: 'from', table });
      return builder;
    },
  } as unknown as IslSupabaseClient;
}

// ── Fixtures ───────────────────────────────────────────────────────────────

const validRow = {
  id: 'isl-bqx',
  title: 'Epic: Universal Agent System',
  description: 'Personas, memories, decisions, voice corpus.',
  notes: null,
  status: 'closed',
  priority: 0,
  issue_type: 'epic',
  assignee: 'claude',
  created_at: '2026-05-01T12:00:00.000Z',
  updated_at: '2026-05-21T16:55:22.000Z',
  started_at: '2026-05-02T09:00:00.000Z',
  closed_at: '2026-05-21T16:55:22.000Z',
  close_reason: 'shipped',
  synced_at: '2026-05-21T17:01:53.571Z',
};

// ── listBdIssues ───────────────────────────────────────────────────────────

describe('listBdIssues', () => {
  it('returns validated rows', async () => {
    const calls: ChainCall[] = [];
    const db = makeListClient([validRow], calls);
    const out = await listBdIssues(db);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('isl-bqx');
  });

  it('drops rows that fail Zod validation', async () => {
    const calls: ChainCall[] = [];
    // Missing required `status` field — should be dropped.
    const bad = { ...validRow, status: undefined };
    const db = makeListClient([validRow, bad], calls);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await listBdIssues(db);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe(validRow.id);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('queries the right table ordered by updated_at desc', async () => {
    const calls: ChainCall[] = [];
    const db = makeListClient([], calls);
    await listBdIssues(db);

    expect(calls[0]).toEqual({ fn: 'from', table: 'bd_issues' });
    expect(calls).toContainEqual({
      fn: 'order',
      col: 'updated_at',
      options: { ascending: false },
    });
  });

  it('returns [] when the query errors', async () => {
    const calls: ChainCall[] = [];
    const erroringClient = {
      from() {
        calls.push({ fn: 'from', table: 'bd_issues' });
        return {
          select() { return this; },
          order()  { return Promise.resolve({ data: null, error: { message: 'kaboom' } }); },
        };
      },
    } as unknown as IslSupabaseClient;

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await listBdIssues(erroringClient);
    expect(out).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ── getBdSyncedAt ──────────────────────────────────────────────────────────

describe('getBdSyncedAt', () => {
  it('returns the synced_at from the latest row', async () => {
    const calls: ChainCall[] = [];
    const db = makeSingleClient({ synced_at: '2026-05-21T17:01:53.571Z' }, calls);
    const ts = await getBdSyncedAt(db);
    expect(ts).toBe('2026-05-21T17:01:53.571Z');
    expect(calls[0]).toEqual({ fn: 'from', table: 'bd_issues' });
    // Ordered desc + limited to 1 — single-row lookup.
    expect(calls).toContainEqual({ fn: 'limit', n: 1 });
  });

  it('returns "" when the table is empty', async () => {
    const calls: ChainCall[] = [];
    const db = makeSingleClient(null, calls);
    const ts = await getBdSyncedAt(db);
    expect(ts).toBe('');
  });

  it('returns "" when the query errors', async () => {
    const erroringClient = {
      from() {
        return {
          select() { return this; },
          order()  { return this; },
          limit()  { return this; },
          maybeSingle() {
            return Promise.resolve({ data: null, error: { message: 'kaboom' } });
          },
        };
      },
    } as unknown as IslSupabaseClient;

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ts = await getBdSyncedAt(erroringClient);
    expect(ts).toBe('');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ── subscribeToBdIssues ────────────────────────────────────────────────────

describe('subscribeToBdIssues', () => {
  it('opens a postgres_changes channel on the right table', () => {
    const recordedOn: Array<Record<string, unknown>> = [];
    let subscribed = false;
    const channel = {
      on(event: string, filter: unknown, _cb: unknown) {
        recordedOn.push({ event, filter });
        return this;
      },
      subscribe() {
        subscribed = true;
        return this;
      },
    };
    const db = {
      channel(name: string) {
        recordedOn.push({ channelName: name });
        return channel;
      },
    } as unknown as IslSupabaseClient;

    const onChange = vi.fn();
    subscribeToBdIssues(db, onChange);

    expect(subscribed).toBe(true);
    expect(recordedOn[0]).toEqual({ channelName: 'bd_issues:board' });
    expect(recordedOn[1]).toMatchObject({
      event: 'postgres_changes',
      filter: { event: '*', schema: 'public', table: 'bd_issues' },
    });
  });
});
