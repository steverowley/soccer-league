// ── matchPositions.test.ts ─────────────────────────────────────────────────────
// Unit tests for getMatchPositions, focused on the pagination that fixes the
// "pitch freezes ~33 minutes in" bug: a 90-minute match stores ~2 700 snapshots
// but PostgREST caps a single response at ~1000 rows, so the reader MUST page
// through .range() to load the whole match.

import { describe, it, expect, vi } from 'vitest';
import { getMatchPositions } from './matchPositions';

/** A valid `match_positions` row (one 2-second snapshot). */
function makeRow(index: number) {
  return {
    minute: Math.floor((index * 2) / 60) + 1,
    second: (index * 2) % 60,
    snapshots: {
      players: [{ id: `p${index % 22}`, x: 1, y: 2, hasBall: false }],
      ball: { x: 3, y: 4, ownerId: null },
    },
  };
}

/**
 * Build a chainable Supabase mock whose `.range(from, to)` returns the matching
 * slice of `allRows`, capped at `serverCap` to emulate PostgREST's max-rows.
 * `errorOnFrom` forces an error response when a page starts at that offset.
 */
function makePagedDb(
  allRows: unknown[],
  { serverCap = 1000, errorOnFrom }: { serverCap?: number; errorOnFrom?: number } = {},
) {
  const ranges: Array<[number, number]> = [];
  function builder() {
    let from = 0;
    let to = Number.POSITIVE_INFINITY;
    const b = {
      select() { return b; },
      eq() { return b; },
      order() { return b; },
      range(f: number, t: number) { from = f; to = t; ranges.push([f, t]); return b; },
      then(onFulfilled: (r: { data: unknown[] | null; error: { message: string } | null }) => unknown) {
        if (errorOnFrom != null && from === errorOnFrom) {
          return Promise.resolve({ data: null, error: { message: 'boom' } }).then(onFulfilled);
        }
        const requested = to - from + 1;
        const slice = allRows.slice(from, from + Math.min(requested, serverCap));
        return Promise.resolve({ data: slice, error: null }).then(onFulfilled);
      },
    };
    return b;
  }
  return { db: { from: vi.fn(() => builder()) }, ranges };
}

describe('getMatchPositions — pagination', () => {
  it('loads every snapshot of a full match, not just the first page', async () => {
    const all = Array.from({ length: 2300 }, (_, i) => makeRow(i)); // > 2× the 1000 cap
    const { db, ranges } = makePagedDb(all, { serverCap: 1000 });

    const result = await getMatchPositions(db as any, 'm1');

    expect(result).toHaveLength(2300);
    expect(result[0]?.minute).toBe(1);
    expect(result[2299]?.minute).toBe(makeRow(2299).minute); // last frame is present
    // Paged in 1000-row hops, then a final empty page to confirm the end.
    expect(ranges[0]).toEqual([0, 999]);
    expect(ranges[1]).toEqual([1000, 1999]);
  });

  it('pages correctly even when the server cap is below the page size', async () => {
    const all = Array.from({ length: 1500 }, (_, i) => makeRow(i));
    const { db } = makePagedDb(all, { serverCap: 400 }); // returns ≤400 per request

    const result = await getMatchPositions(db as any, 'm1');

    expect(result).toHaveLength(1500); // advancing by rows-returned avoids early stop
  });

  it('returns [] when the first page errors', async () => {
    const all = Array.from({ length: 10 }, (_, i) => makeRow(i));
    const { db } = makePagedDb(all, { errorOnFrom: 0 });

    const result = await getMatchPositions(db as any, 'm1');
    expect(result).toEqual([]);
  });

  it('skips malformed snapshot rows but keeps the rest', async () => {
    const all: unknown[] = [makeRow(0), { minute: 1, second: 2, snapshots: { bogus: true } }, makeRow(2)];
    const { db } = makePagedDb(all, { serverCap: 1000 });

    const result = await getMatchPositions(db as any, 'm1');
    expect(result).toHaveLength(2); // the malformed middle row is dropped
  });
});
