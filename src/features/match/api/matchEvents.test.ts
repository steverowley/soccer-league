// ── matchEvents.test.ts ──────────────────────────────────────────────────────
// Unit tests for the live-viewer Supabase API surface.  We mock the client
// at the call boundary (chainable .from().select()...) so no real Supabase
// instance is touched.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getLiveMatch,
  getMatchEvents,
  getMatchDurationSeconds,
  getLatestMatchEvent,
  DEFAULT_MATCH_DURATION_SECONDS,
} from './matchEvents';

// ── Chainable Supabase query mock ─────────────────────────────────────────────
//
// Supabase's PostgREST builder methods return `this` until the terminator
// (.single() / await on the builder).  We replicate that with an object
// where every chainable method returns the same object, and a .single()
// (or default thenable) returns the queued response.
//
// A test calls `mockResponseFor(<table>, <data>, <error>)` to queue what the
// next query for that table resolves to.  The builder records the calls so
// assertions can check filter values.

interface QueuedResponse {
  data:  unknown;
  error: { message: string } | null;
}

function makeQueryMock() {
  const queue = new Map<string, QueuedResponse[]>();
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];

  function pushCall(table: string, method: string, args: unknown[]): void {
    calls.push({ table, method, args });
  }

  function dequeue(table: string): QueuedResponse {
    const list = queue.get(table);
    if (!list || list.length === 0) {
      return { data: null, error: { message: `no queued response for ${table}` } };
    }
    return list.shift()!;
  }

  function queryFor(table: string) {
    let resolved: Promise<QueuedResponse> | null = null;
    const builder = {
      select(..._args: unknown[]) { pushCall(table, 'select', _args); return builder; },
      eq(..._args: unknown[])     { pushCall(table, 'eq', _args);     return builder; },
      lte(..._args: unknown[])    { pushCall(table, 'lte', _args);    return builder; },
      order(..._args: unknown[])  { pushCall(table, 'order', _args);  return builder; },
      limit(..._args: unknown[])  { pushCall(table, 'limit', _args);  return builder; },
      single() {
        pushCall(table, 'single', []);
        if (!resolved) resolved = Promise.resolve(dequeue(table));
        return resolved;
      },
      // Some queries (getMatchEvents) await the builder directly.
      then(onFulfilled: (r: QueuedResponse) => unknown) {
        if (!resolved) resolved = Promise.resolve(dequeue(table));
        return resolved.then(onFulfilled);
      },
    };
    return builder;
  }

  // Channel mock for Realtime.
  const channelStubs: Array<{ name: string; on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> }> = [];
  function channel(name: string) {
    const stub = {
      name,
      on:        vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    };
    channelStubs.push(stub);
    return stub;
  }
  const removeChannel = vi.fn();

  const db = {
    from: vi.fn((table: string) => queryFor(table)),
    channel,
    removeChannel,
  };

  return {
    db,
    queue: {
      push(table: string, data: unknown, error: { message: string } | null = null) {
        const list = queue.get(table) ?? [];
        list.push({ data, error });
        queue.set(table, list);
      },
    },
    calls,
    channelStubs,
    removeChannel,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('getLiveMatch', () => {
  let mock: ReturnType<typeof makeQueryMock>;
  beforeEach(() => { mock = makeQueryMock(); });

  it('returns the joined match row on success', async () => {
    const fakeRow = {
      id: 'm1', status: 'in_progress', home_score: 1, away_score: 0,
      scheduled_at: '2026-04-01T12:00:00Z', played_at: null,
      competition_id: 'c1',
      home_team: { id: 'h', name: 'Home', short_name: 'HOM', color: '#fff', home_ground: 'X', location: 'Earth' },
      away_team: { id: 'a', name: 'Away', short_name: 'AWA', color: '#000', home_ground: 'Y', location: 'Mars'  },
    };
    mock.queue.push('matches', fakeRow);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getLiveMatch(mock.db as any, 'm1');
    expect(result).toEqual(fakeRow);
    expect(mock.calls.find((c) => c.method === 'eq')?.args).toEqual(['id', 'm1']);
  });

  it('returns null when the query errors', async () => {
    mock.queue.push('matches', null, { message: 'not found' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getLiveMatch(mock.db as any, 'missing');
    expect(result).toBeNull();
  });
});

describe('getMatchEvents', () => {
  let mock: ReturnType<typeof makeQueryMock>;
  beforeEach(() => { mock = makeQueryMock(); });

  it('returns the events array sorted by minute then subminute', async () => {
    const events = [
      { id: 'e1', match_id: 'm1', minute: 1, subminute: 0, type: 'kickoff', payload: {}, created_at: 'x' },
      { id: 'e2', match_id: 'm1', minute: 12, subminute: 0, type: 'shot', payload: {}, created_at: 'x' },
    ];
    mock.queue.push('match_events', events);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getMatchEvents(mock.db as any, 'm1');
    expect(result).toEqual(events);
    // Verify the order calls happened.
    const orderCalls = mock.calls.filter((c) => c.method === 'order');
    expect(orderCalls).toHaveLength(2);
    expect(orderCalls[0]?.args[0]).toBe('minute');
    expect(orderCalls[1]?.args[0]).toBe('subminute');
  });

  it('returns empty array on error', async () => {
    mock.queue.push('match_events', null, { message: 'oops' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getMatchEvents(mock.db as any, 'm1');
    expect(result).toEqual([]);
  });

  it('returns empty array when data is null but no error', async () => {
    mock.queue.push('match_events', null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getMatchEvents(mock.db as any, 'm1');
    expect(result).toEqual([]);
  });
});

describe('getMatchDurationSeconds', () => {
  let mock: ReturnType<typeof makeQueryMock>;
  beforeEach(() => { mock = makeQueryMock(); });

  it('walks matches → competitions → season_config and returns the configured value', async () => {
    mock.queue.push('matches',       { competition_id: 'c1' });
    mock.queue.push('competitions',  { season_id: 's1' });
    mock.queue.push('season_config', { match_duration_seconds: 180 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dur = await getMatchDurationSeconds(mock.db as any, 'm1');
    expect(dur).toBe(180);
  });

  it('falls back to default when the match query errors', async () => {
    mock.queue.push('matches', null, { message: 'oops' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dur = await getMatchDurationSeconds(mock.db as any, 'm1');
    expect(dur).toBe(DEFAULT_MATCH_DURATION_SECONDS);
  });

  it('falls back to default when season_config is missing', async () => {
    mock.queue.push('matches',       { competition_id: 'c1' });
    mock.queue.push('competitions',  { season_id: 's1' });
    mock.queue.push('season_config', null, { message: 'no row' });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dur = await getMatchDurationSeconds(mock.db as any, 'm1');
    expect(dur).toBe(DEFAULT_MATCH_DURATION_SECONDS);
  });
});

describe('getLatestMatchEvent', () => {
  let mock: ReturnType<typeof makeQueryMock>;
  beforeEach(() => { mock = makeQueryMock(); });

  it('asks for the single latest row by minute then subminute, newest first', async () => {
    const latest = { id: 'e9', match_id: 'm1', minute: 88, subminute: 0.5, type: 'shot', payload: {}, created_at: 'x' };
    mock.queue.push('match_events', [latest]);
    const row = await getLatestMatchEvent(mock.db as any, 'm1');
    expect(row).toEqual(latest);
    expect(mock.calls.find((c) => c.method === 'eq')?.args).toEqual(['match_id', 'm1']);
    const orders = mock.calls.filter((c) => c.method === 'order');
    expect(orders.map((c) => c.args)).toEqual([
      ['minute', { ascending: false }],
      ['subminute', { ascending: false }],
    ]);
    expect(mock.calls.find((c) => c.method === 'limit')?.args).toEqual([1]);
  });

  it('returns null when the match has no events or the read fails', async () => {
    mock.queue.push('match_events', []);
    expect(await getLatestMatchEvent(mock.db as any, 'm1')).toBeNull();
    mock.queue.push('match_events', null, { message: 'timeout' });
    expect(await getLatestMatchEvent(mock.db as any, 'm1')).toBeNull();
  });

  it('never opens a Realtime channel (live views poll the read cache)', async () => {
    mock.queue.push('match_events', []);
    await getLatestMatchEvent(mock.db as any, 'm1');
    expect(mock.channelStubs).toHaveLength(0);
  });
});
