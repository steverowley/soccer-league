// ── pagination.test.ts ───────────────────────────────────────────────────────
// Unit tests for the pure paginated id-fetcher used by `bd-sync-now`.
// The fetcher is injected as a callback (production: wraps the Supabase
// client's `.range()` call; tests: returns canned page arrays) so we can
// exercise the loop logic without spinning up Supabase.
//
// The bug being guarded against here is the "single `.select('id')` cap"
// review finding: PostgREST returns at most `max-rows` (1000 by default)
// rows per request, so the original implementation silently lost any id
// past row 1000.  These tests prove the new implementation paginates
// correctly across that boundary and aggregates every id into the diff
// set.

import { describe, expect, it } from 'vitest';
import { fetchAllIds, ID_PAGE_SIZE, type FetchPage, type IdPage } from './pagination';

/**
 * Build an in-memory fetcher that serves rows from a fixed array and
 * records the `[start, end]` ranges it was asked to return.  The
 * recorded ranges feed assertions that prove pagination actually
 * happened (vs. one giant read that happened to return the right ids).
 *
 * @param allRows   Full row set to serve, in id order.
 * @param pageSize  Page size to honour — fetcher slices `allRows` to
 *                  this length so callers don't have to pre-chunk.
 * @returns         `{ fetch, calls }` — `fetch` is the FetchPage callback,
 *                  `calls` is a running log of `[start, end, served]` for
 *                  each invocation so tests can assert page counts.
 */
function makeFetcher(
  allRows: { id: string }[],
  pageSize: number,
): { fetch: FetchPage; calls: [number, number, number][] } {
  const calls: [number, number, number][] = [];
  // ── Closure over `allRows` ─────────────────────────────────────────
  // The fetcher slices the source array to the requested range and
  // logs the served length.  We honour `pageSize` by also capping the
  // slice — PostgREST does the same thing under `max-rows`, so this is
  // the most faithful simulation of the production behaviour.
  const fetch: FetchPage = async (start, end) => {
    const cap   = Math.min(end + 1, start + pageSize);
    const slice = allRows.slice(start, cap);
    calls.push([start, end, slice.length]);
    return { data: slice, error: null } satisfies IdPage;
  };
  return { fetch, calls };
}

describe('fetchAllIds', () => {
  it('returns empty set for an empty table after one zero-row page', async () => {
    // ── Empty-table path ─────────────────────────────────────────────
    // A single round-trip returns 0 rows, which is strictly less than
    // pageSize, so the loop terminates after one fetch.
    const { fetch, calls } = makeFetcher([], 1000);
    const { ids, count } = await fetchAllIds(fetch, 1000);
    expect(ids.size).toBe(0);
    expect(count).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([0, 999, 0]);
  });

  it('aggregates ids across two pages (1000 then 250)', async () => {
    // ── The headline correctness scenario from the review comment ────
    // 1250 rows means a full first page (0..999) followed by a short
    // second page (1000..1249).  Pre-fix this returned only the first
    // 1000 ids; the tombstone diff then misclassified the trailing 250
    // as "missing from the JSONL" — or worse, the diff never saw them
    // at all and stale rows lingered indefinitely.  Post-fix we see
    // all 1250 ids and exactly two round-trips.
    const rows = Array.from({ length: 1250 }, (_, i) => ({ id: `isl-${i}` }));
    const { fetch, calls } = makeFetcher(rows, 1000);

    const { ids, count } = await fetchAllIds(fetch, 1000);

    expect(count).toBe(1250);
    expect(ids.size).toBe(1250);
    // Spot-check both boundary regions.
    expect(ids.has('isl-0')).toBe(true);
    expect(ids.has('isl-999')).toBe(true);   // last id on page 1
    expect(ids.has('isl-1000')).toBe(true);  // first id on page 2
    expect(ids.has('isl-1249')).toBe(true);  // last id overall

    // Two fetches: full first page, short second page.
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual([0, 999, 1000]);
    expect(calls[1]).toEqual([1000, 1999, 250]);
  });

  it('stops after a single partial page when total < pageSize', async () => {
    // ── Short-circuit path ───────────────────────────────────────────
    // 42 rows on a 1000-row page size means the very first read comes
    // back short, so the loop must terminate without a follow-up fetch
    // (otherwise we'd issue a wasted round-trip per call).
    const rows = Array.from({ length: 42 }, (_, i) => ({ id: `r-${i}` }));
    const { fetch, calls } = makeFetcher(rows, 1000);
    const { ids, count } = await fetchAllIds(fetch, 1000);
    expect(count).toBe(42);
    expect(ids.size).toBe(42);
    expect(calls).toHaveLength(1);
  });

  it('issues an extra empty page when total is an exact multiple of pageSize', async () => {
    // ── Boundary case: total === N × pageSize ────────────────────────
    // A full last page can't be distinguished from "more rows ahead"
    // until the loop sees a short page.  With exactly 2000 rows and a
    // 1000-row page size we therefore expect three fetches: two full
    // pages plus one empty terminator.
    const rows = Array.from({ length: 2000 }, (_, i) => ({ id: `e-${i}` }));
    const { fetch, calls } = makeFetcher(rows, 1000);
    const { ids, count } = await fetchAllIds(fetch, 1000);
    expect(count).toBe(2000);
    expect(ids.size).toBe(2000);
    expect(calls).toHaveLength(3);
    expect(calls[2]).toEqual([2000, 2999, 0]);
  });

  it('respects a smaller pageSize for stress-test scenarios', async () => {
    // ── Non-default page size ────────────────────────────────────────
    // Tests can pass a small `pageSize` to exercise pagination without
    // seeding thousands of rows.  Here 5 rows / page size 2 → pages of
    // [0..1], [2..3], [4..4]: two full + one short = three fetches.
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: `s-${i}` }));
    const { fetch, calls } = makeFetcher(rows, 2);
    const { ids, count } = await fetchAllIds(fetch, 2);
    expect(count).toBe(5);
    expect(ids.size).toBe(5);
    expect(calls).toHaveLength(3);
  });

  it('throws when any page returns an error', async () => {
    // ── Error propagation ────────────────────────────────────────────
    // A page error must bubble up so the caller can map it onto a 5xx
    // response.  Silently swallowing the error would understate the
    // existing row count and inflate the tombstone candidate set.
    const fetch: FetchPage = async () => ({ data: null, error: { message: 'boom' } });
    await expect(fetchAllIds(fetch, 1000)).rejects.toThrow('boom');
  });

  it('treats a null data field as an empty page', async () => {
    // ── Defensive: null data ─────────────────────────────────────────
    // The Supabase client returns `null` for `data` on some edge
    // responses; the loop should treat that as an empty page and
    // terminate without throwing or counting phantom rows.
    const fetch: FetchPage = async () => ({ data: null, error: null });
    const { ids, count } = await fetchAllIds(fetch, 1000);
    expect(ids.size).toBe(0);
    expect(count).toBe(0);
  });

  it('exports a default page size matching PostgREST max-rows', () => {
    // ── Constant pin ─────────────────────────────────────────────────
    // The 1000-row default is meaningful: it has to match the upstream
    // PostgREST `max-rows` ceiling or the loop will terminate early on
    // a full page that PostgREST trimmed to the cap.  This assertion
    // catches an accidental change to either side of that contract.
    expect(ID_PAGE_SIZE).toBe(1000);
  });
});
