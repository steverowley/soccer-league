// ── roadmap/api/claudeSessions.test.ts ──────────────────────────────────────
// Tests for the live-session query + Realtime subscription layer.
//
// We don't spin up a real Supabase here — instead we hand-roll a minimal
// in-memory client double that records the query chain (`.from`,
// `.select`, `.is`, `.gte`, `.order`) and returns a configurable row
// set.  This matches the pattern used elsewhere in the feature
// (`items.test.ts`) and keeps the test deterministic + fast.
//
// Coverage goals:
//   * `listActiveClaudeSessions` returns validated rows.
//   * Invalid rows are dropped (Zod boundary), valid rows pass through.
//   * The query honours the "ended_at IS NULL + recent" filter.
//   * `subscribeToClaudeSessions` wires the channel to the right table /
//     event set and forwards payloads.

import { describe, it, expect, vi } from 'vitest';
import {
  listActiveClaudeSessions,
  subscribeToClaudeSessions,
  ACTIVE_SESSION_MAX_AGE_HOURS,
} from './claudeSessions';
import type { IslSupabaseClient } from '@shared/supabase/client';

// ── Minimal in-memory client double ────────────────────────────────────────

/**
 * Recorded call to the fake query builder.  Each chained method appends
 * one of these so tests can assert the query shape without re-running
 * SQL.
 */
type ChainCall =
  | { fn: 'from';   table: string }
  | { fn: 'select'; cols: string }
  | { fn: 'is';     col: string; value: unknown }
  | { fn: 'gte';    col: string; value: unknown }
  | { fn: 'order';  col: string; options: unknown };

/**
 * Build a fake Supabase client whose `.from('claude_sessions').select…`
 * chain terminates by resolving to `{ data, error: null }`.
 *
 * @param rows  - Rows the eventual `.order(...)` call resolves to.
 * @param calls - Mutable array that the chain pushes recorded calls into.
 * @returns     A typed double assignable to `IslSupabaseClient`.
 */
function makeClient(rows: unknown[], calls: ChainCall[]): IslSupabaseClient {
  const builder = {
    select(cols: string) {
      calls.push({ fn: 'select', cols });
      return this;
    },
    is(col: string, value: unknown) {
      calls.push({ fn: 'is', col, value });
      return this;
    },
    gte(col: string, value: unknown) {
      calls.push({ fn: 'gte', col, value });
      return this;
    },
    order(col: string, options: unknown) {
      calls.push({ fn: 'order', col, options });
      // PostgREST terminal — return a thenable so `await` resolves.
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

// ── Fixtures ───────────────────────────────────────────────────────────────

const validRow = {
  id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  session_id: 'cse_abc',
  branch_name: 'claude/test',
  title: 'test session',
  pr_url: null,
  container_id: null,
  account_uuid: null,
  started_at: '2026-05-21T10:00:00.000Z',
  ended_at: null,
  created_at: '2026-05-21T10:00:00.000Z',
  updated_at: '2026-05-21T10:00:00.000Z',
};

// ── listActiveClaudeSessions ───────────────────────────────────────────────

describe('listActiveClaudeSessions', () => {
  it('returns validated rows', async () => {
    const calls: ChainCall[] = [];
    const db = makeClient([validRow], calls);
    const out = await listActiveClaudeSessions(db);
    expect(out).toHaveLength(1);
    expect(out[0]?.session_id).toBe('cse_abc');
  });

  it('drops rows that fail Zod validation', async () => {
    const calls: ChainCall[] = [];
    const bad = { ...validRow, id: 'not-a-uuid' };
    const db = makeClient([validRow, bad], calls);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await listActiveClaudeSessions(db);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe(validRow.id);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('queries the right table with the right filters', async () => {
    const calls: ChainCall[] = [];
    const db = makeClient([], calls);
    await listActiveClaudeSessions(db);

    expect(calls[0]).toEqual({ fn: 'from', table: 'claude_sessions' });
    expect(calls).toContainEqual({ fn: 'is', col: 'ended_at', value: null });
    expect(calls.some((c) => c.fn === 'gte' && c.col === 'started_at')).toBe(true);
    expect(calls.some((c) => c.fn === 'order' && c.col === 'started_at')).toBe(true);
  });

  it('floors the "recent" filter at the configured age in hours', async () => {
    const calls: ChainCall[] = [];
    const db = makeClient([], calls);
    const before = Date.now();
    await listActiveClaudeSessions(db);
    const after = Date.now();

    const gte = calls.find((c) => c.fn === 'gte' && c.col === 'started_at') as
      | (Extract<ChainCall, { fn: 'gte' }>)
      | undefined;
    expect(gte).toBeDefined();
    const floor = new Date(gte!.value as string).getTime();
    const expectedMin = before - ACTIVE_SESSION_MAX_AGE_HOURS * 60 * 60 * 1000;
    const expectedMax = after  - ACTIVE_SESSION_MAX_AGE_HOURS * 60 * 60 * 1000;
    expect(floor).toBeGreaterThanOrEqual(expectedMin);
    expect(floor).toBeLessThanOrEqual(expectedMax);
  });

  it('returns [] when the query errors', async () => {
    // Override the builder to simulate a Postgrest error.
    const calls: ChainCall[] = [];
    const erroringClient = {
      from() {
        calls.push({ fn: 'from', table: 'claude_sessions' });
        return {
          select() { return this; },
          is()     { return this; },
          gte()    { return this; },
          order()  { return Promise.resolve({ data: null, error: { message: 'kaboom' } }); },
        };
      },
    } as unknown as IslSupabaseClient;

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await listActiveClaudeSessions(erroringClient);
    expect(out).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ── subscribeToClaudeSessions ──────────────────────────────────────────────

describe('subscribeToClaudeSessions', () => {
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
    subscribeToClaudeSessions(db, onChange);

    expect(subscribed).toBe(true);
    expect(recordedOn[0]).toEqual({ channelName: 'claude_sessions:board' });
    expect(recordedOn[1]).toMatchObject({
      event: 'postgres_changes',
      filter: { event: '*', schema: 'public', table: 'claude_sessions' },
    });
  });
});
