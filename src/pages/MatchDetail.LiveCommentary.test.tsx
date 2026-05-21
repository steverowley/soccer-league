// ── MatchDetail.LiveCommentary.test.tsx ─────────────────────────────────────
// Component-level tests for the live-match event-stream verifier (isl-dmf,
// Phase A).  Covers the three end-to-end scenarios called out in the issue:
//
//   1. Normal paced replay     — a viewer opens an in-progress match a few
//                                game-minutes after kickoff and sees events
//                                revealed up to elapsed-minute, with future
//                                events held back until the wall clock
//                                crosses each boundary.
//   2. Mid-simulation join     — a viewer opens the page while the worker is
//                                still inserting events; the initial fetch
//                                returns the rows written so far and the
//                                Realtime subscription delivers the rest as
//                                the worker writes them.
//   3. Early completion        — the worker flips matches.status to
//                                `completed` within seconds of kickoff (its
//                                normal mode) while the viewer is still
//                                pacing through minutes 1–89; the viewer's
//                                experience stays time-driven from
//                                scheduled_at + duration regardless.
//
// AUDIT GOALS (also asserted explicitly):
//   • Dedup-by-id holds across the initial fetch + the Realtime stream
//     when the same row is delivered twice.
//   • filterEventsByElapsedMinute is applied UNIFORMLY to both sources —
//     events from Realtime that arrive ahead of their game-minute do not
//     leak into the visible feed.
//
// MOCK STRATEGY:
//   Reuses the chainable-query + channel-stub pattern from
//   matchEvents.test.ts:200-255.  The component receives the fake client
//   via <SupabaseProvider>, so no module-level mocking is required.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { LiveCommentary, mergeAndSortEvents } from './MatchDetail';
import { SupabaseProvider } from '../shared/supabase/SupabaseProvider';
import type { IslSupabaseClient } from '../shared/supabase/client';
import type { MatchEventRow } from '../features/match';

// ── Chainable query + Realtime channel mock ──────────────────────────────────
// Lifted from src/features/match/api/matchEvents.test.ts:31-100 with one
// addition: a `flush()` helper that resolves the pending promise queue so
// tests can advance React effect cycles deterministically without having to
// `await new Promise(setImmediate)` in every test body.

interface QueuedResponse {
  data: unknown;
  error: { message: string } | null;
}

function makeQueryMock() {
  const queue = new Map<string, QueuedResponse[]>();

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
      select(..._args: unknown[]) { return builder; },
      eq(..._args: unknown[])     { return builder; },
      lte(..._args: unknown[])    { return builder; },
      order(..._args: unknown[])  { return builder; },
      single() {
        if (!resolved) resolved = Promise.resolve(dequeue(table));
        return resolved;
      },
      then(onFulfilled: (r: QueuedResponse) => unknown) {
        if (!resolved) resolved = Promise.resolve(dequeue(table));
        return resolved.then(onFulfilled);
      },
    };
    return builder;
  }

  // Channel stubs let tests pull the Realtime callback the component
  // registered and invoke it as the Supabase Realtime broker would.
  const channelStubs: Array<{
    name: string;
    on: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
  }> = [];

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
    from:          vi.fn((table: string) => queryFor(table)),
    channel,
    removeChannel,
  } as unknown as IslSupabaseClient;

  return {
    db,
    queue: {
      /** Queue one response for the next query against the named table. */
      push(table: string, data: unknown, error: { message: string } | null = null) {
        const list = queue.get(table) ?? [];
        list.push({ data, error });
        queue.set(table, list);
      },
    },
    /**
     * Fire the most recent Realtime channel's INSERT handler with a row,
     * mimicking what the Supabase broker does when a Postgres `INSERT`
     * matches the channel's filter.  Returns the channel stub so callers
     * can also assert on it.
     */
    fireRealtimeInsert(row: Partial<MatchEventRow>) {
      const stub = channelStubs[channelStubs.length - 1];
      if (!stub) throw new Error('no realtime channel registered yet');
      const handler = stub.on.mock.calls[0]?.[2] as ((p: { new: unknown }) => void) | undefined;
      if (!handler) throw new Error('channel.on() not called yet');
      handler({ new: row });
    },
    channelStubs,
    removeChannel,
  };
}

/**
 * Render `<LiveCommentary>` with a fake Supabase client and a router stub.
 * `<LiveCommentary>` doesn't read the URL itself but the broader Match page
 * does, and importing the page pulls in <Link> which needs router context.
 */
function renderLive(match: { id?: string; status?: string; scheduled_at?: string | null },
                   db: IslSupabaseClient) {
  return render(
    <MemoryRouter>
      <SupabaseProvider client={db}>
        <LiveCommentary match={match} />
      </SupabaseProvider>
    </MemoryRouter>,
  );
}

/**
 * Settle React's microtask queue so `useEffect` and pending promises run.
 * Wrapping in `act` silences the "not wrapped in act" warning when the
 * component re-renders in response to fake-timer ticks.
 */
async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

// ── Fixture builders ─────────────────────────────────────────────────────────

const KICKOFF_ISO = '2026-04-01T12:00:00.000Z';
const KICKOFF_MS  = new Date(KICKOFF_ISO).getTime();
const DURATION_S  = 600; // production default — 600 s / 90 min ≈ 6.67 s/min

function ev(overrides: Partial<MatchEventRow> & { id: string; minute: number }): MatchEventRow {
  return {
    id:         overrides.id,
    match_id:   'm1',
    minute:     overrides.minute,
    subminute:  overrides.subminute ?? 0,
    type:       overrides.type ?? 'shot',
    payload:    overrides.payload ?? { commentary: `event ${overrides.id}` },
    created_at: overrides.created_at ?? '2026-04-01T12:00:00Z',
  } as unknown as MatchEventRow;
}

// Queue the matches → competitions → season_config chain that
// getMatchDurationSeconds walks (three sequential .single() lookups).
function queueDurationChain(queue: ReturnType<typeof makeQueryMock>['queue'], duration = DURATION_S) {
  queue.push('matches',       { competition_id: 'c1' });
  queue.push('competitions',  { season_id: 's1' });
  queue.push('season_config', { match_duration_seconds: duration });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('LiveCommentary — pure helper', () => {
  describe('mergeAndSortEvents', () => {
    it('dedupes by id when the same row is delivered by both sources', () => {
      const row1  = ev({ id: 'a', minute: 5 });
      const row2  = ev({ id: 'b', minute: 12 });
      const dup1  = ev({ id: 'a', minute: 5 }); // same id, second source
      const merged = mergeAndSortEvents([row1], [dup1, row2]);
      expect(merged.map((e) => e.id)).toEqual(['a', 'b']);
    });

    it('sorts the merged list by (minute, subminute) so the viewer-side filter sees chronological input', () => {
      const merged = mergeAndSortEvents(
        [ev({ id: 'late',  minute: 80 })],
        [ev({ id: 'early', minute: 3 }), ev({ id: 'mid',   minute: 45, subminute: 2 })],
      );
      expect(merged.map((e) => e.minute)).toEqual([3, 45, 80]);
    });

    it('breaks minute ties by numeric subminute, even when subminute arrives as a string', () => {
      const merged = mergeAndSortEvents(
        [],
        // subminute is numeric in Postgres but PostgREST surfaces it as a
        // string in some shapes — Number() coercion in the comparator keeps
        // the sort stable regardless.
        [
          ev({ id: 'b', minute: 12, subminute: '2' as unknown as number }),
          ev({ id: 'a', minute: 12, subminute: '1' as unknown as number }),
        ],
      );
      expect(merged.map((e) => e.id)).toEqual(['a', 'b']);
    });

    it('never mutates either input array', () => {
      const existing = [ev({ id: 'a', minute: 5 })];
      const incoming = [ev({ id: 'b', minute: 6 })];
      const snapshotExisting = [...existing];
      const snapshotIncoming = [...incoming];
      mergeAndSortEvents(existing, incoming);
      expect(existing).toEqual(snapshotExisting);
      expect(incoming).toEqual(snapshotIncoming);
    });
  });
});

describe('LiveCommentary — paced live viewer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // ── Scenario 1: Normal paced replay ────────────────────────────────────────
  // A viewer opens an in-progress match 60 s after kickoff.  At 600 s
  // duration that's elapsed-minute 9, so all events at minute ≤ 9 should be
  // revealed and a minute-45 event held back until the wall clock advances.

  it('Scenario 1: normal paced replay — reveals events up to elapsed-minute and holds the rest', async () => {
    const mock = makeQueryMock();
    // 60 000 ms after kickoff → minute 9 elapsed @ 600 s pacing.
    vi.setSystemTime(new Date(KICKOFF_MS + 60_000));

    const earlyEvent = ev({ id: 'early', minute: 3,  payload: { commentary: 'EARLY EVENT' } });
    const lateEvent  = ev({ id: 'late',  minute: 45, payload: { commentary: 'LATE EVENT' } });
    mock.queue.push('match_events', [earlyEvent, lateEvent]);
    queueDurationChain(mock.queue);

    renderLive({ id: 'm1', status: 'in_progress', scheduled_at: KICKOFF_ISO }, mock.db);
    await flushEffects();

    expect(screen.getByText('EARLY EVENT')).toBeInTheDocument();
    expect(screen.queryByText('LATE EVENT')).not.toBeInTheDocument();
    // Live-state UI cue confirms we're in the paced window, not the replay branch.
    expect(screen.getByText(/Live Feed/i)).toBeInTheDocument();

    // Advance wall-clock to 5 min in (still inside 10-min window) → minute 45.
    await act(async () => {
      vi.setSystemTime(new Date(KICKOFF_MS + 300_000));
      vi.advanceTimersByTime(1000);
    });
    await flushEffects();

    expect(screen.getByText('LATE EVENT')).toBeInTheDocument();
  });

  // ── Scenario 2: Mid-simulation join ────────────────────────────────────────
  // Viewer mounts mid-simulation.  Initial fetch returns the events written
  // so far; the worker keeps inserting; Realtime fills the gap.  We then
  // simulate the same row arriving from both sources (a real race the worker
  // can produce when batch insertion and a viewer's fetch overlap) and
  // assert dedup-by-id holds.

  it('Scenario 2: mid-simulation join — Realtime events fill the gap and dedup by id', async () => {
    const mock = makeQueryMock();
    // 60 s in: viewer joins mid-simulation, paced window still open.
    vi.setSystemTime(new Date(KICKOFF_MS + 60_000));

    const fetched = ev({ id: 'fetched', minute: 3, payload: { commentary: 'FETCHED' } });
    mock.queue.push('match_events', [fetched]);
    queueDurationChain(mock.queue);

    renderLive({ id: 'm1', status: 'in_progress', scheduled_at: KICKOFF_ISO }, mock.db);
    await flushEffects();

    expect(screen.getByText('FETCHED')).toBeInTheDocument();

    // Realtime delivers a NEW event the initial fetch missed.  Its minute (8)
    // is within elapsed-minute 9, so it should appear immediately.
    const realtimeEvent = ev({ id: 'realtime', minute: 8, payload: { commentary: 'REALTIME' } });
    await act(async () => {
      mock.fireRealtimeInsert(realtimeEvent);
    });
    expect(screen.getByText('REALTIME')).toBeInTheDocument();

    // Same row delivered AGAIN (race the worker batch + Realtime can produce
    // if the broker re-delivers under reconnect).  Dedup must prevent a
    // duplicate row in the feed.
    await act(async () => {
      mock.fireRealtimeInsert(realtimeEvent);
    });
    expect(screen.getAllByText('REALTIME')).toHaveLength(1);

    // Realtime delivers an event AHEAD of its minute (minute 80 at elapsed 9).
    // filterEventsByElapsedMinute must hold it back uniformly — i.e. the
    // Realtime source should not bypass the elapsed-minute gate that the
    // initial fetch is subject to.
    const futureEvent = ev({ id: 'future', minute: 80, payload: { commentary: 'FUTURE' } });
    await act(async () => {
      mock.fireRealtimeInsert(futureEvent);
    });
    expect(screen.queryByText('FUTURE')).not.toBeInTheDocument();
  });

  // ── Scenario 3: Early completion ───────────────────────────────────────────
  // Worker flips status=completed within seconds of kickoff (its normal mode)
  // while the viewer is still pacing through minutes 1–89.  Because the
  // viewer's experience is anchored on `scheduled_at + duration`, the
  // status flip should not collapse the timeline; events at minute > elapsed
  // stay hidden until the wall clock crosses them.

  it('Scenario 3: early completion — status=completed mid-pacing does not skip the timeline', async () => {
    const mock = makeQueryMock();
    // 30 s after kickoff → elapsed minute 4 @ 600 s pacing.
    vi.setSystemTime(new Date(KICKOFF_MS + 30_000));

    // Worker has finished simulating and inserted the full event log; the
    // viewer's initial fetch sees all of it.  But the viewer should still
    // pace minute-by-minute — the row's `status` is incidental.
    const events = [
      ev({ id: 'a', minute: 2,  payload: { commentary: 'EVENT MIN 2' } }),
      ev({ id: 'b', minute: 10, payload: { commentary: 'EVENT MIN 10' } }),
      ev({ id: 'c', minute: 89, payload: { commentary: 'EVENT MIN 89' } }),
    ];
    mock.queue.push('match_events', events);
    queueDurationChain(mock.queue);

    // status='completed' even though we're only 30 s into a 600 s paced window.
    renderLive({ id: 'm1', status: 'completed', scheduled_at: KICKOFF_ISO }, mock.db);
    await flushEffects();

    // Only minute-2 is visible at elapsed-minute 4.  Both later events are
    // held back even though they exist in the DB and would render
    // immediately in "completed" mode if the viewer's pacing collapsed to
    // status-driven.
    expect(screen.getByText('EVENT MIN 2')).toBeInTheDocument();
    expect(screen.queryByText('EVENT MIN 10')).not.toBeInTheDocument();
    expect(screen.queryByText('EVENT MIN 89')).not.toBeInTheDocument();
    // Still inside the paced window → header reads as Live, not Replay.
    expect(screen.getByText(/Live Feed/i)).toBeInTheDocument();

    // Advance to 70 s — minute 10 elapses.
    await act(async () => {
      vi.setSystemTime(new Date(KICKOFF_MS + 70_000));
      vi.advanceTimersByTime(1000);
    });
    await flushEffects();
    expect(screen.getByText('EVENT MIN 10')).toBeInTheDocument();
    expect(screen.queryByText('EVENT MIN 89')).not.toBeInTheDocument();

    // Advance past the 600 s pacing window — viewer enters replay mode and
    // every event is revealed.
    await act(async () => {
      vi.setSystemTime(new Date(KICKOFF_MS + 600_001));
      vi.advanceTimersByTime(1000);
    });
    await flushEffects();
    expect(screen.getByText('EVENT MIN 89')).toBeInTheDocument();
    expect(screen.getByText(/The Replay/i)).toBeInTheDocument();
  });

  // ── Subscription lifecycle: opened during pacing, closed after ────────────
  // Confirms the channel is opened during the paced window (so a viewer
  // who joined mid-simulation receives Realtime events) and removed when
  // the window closes (no further inserts can arrive).

  it('opens the Realtime channel during the paced window and removes it after replay starts', async () => {
    const mock = makeQueryMock();
    vi.setSystemTime(new Date(KICKOFF_MS + 60_000));
    mock.queue.push('match_events', []);
    queueDurationChain(mock.queue);

    renderLive({ id: 'm1', status: 'in_progress', scheduled_at: KICKOFF_ISO }, mock.db);
    await flushEffects();

    expect(mock.channelStubs).toHaveLength(1);
    expect(mock.channelStubs[0]?.name).toBe('match_events:m1');
    expect(mock.removeChannel).not.toHaveBeenCalled();

    // Cross the end of the pacing window.  The next render must clean up
    // the channel because `livePacingWindowOpen` flips to false.
    await act(async () => {
      vi.setSystemTime(new Date(KICKOFF_MS + 600_001));
      vi.advanceTimersByTime(1000);
    });
    await flushEffects();
    expect(mock.removeChannel).toHaveBeenCalledTimes(1);
  });

  it('renders nothing for cancelled matches even after kickoff time', async () => {
    const mock = makeQueryMock();
    vi.setSystemTime(new Date(KICKOFF_MS + 60_000));

    const { container } = renderLive(
      { id: 'm1', status: 'cancelled', scheduled_at: KICKOFF_ISO },
      mock.db,
    );
    await flushEffects();
    expect(container).toBeEmptyDOMElement();
    expect(mock.channelStubs).toHaveLength(0);
  });
});
