// ── pagination.ts ────────────────────────────────────────────────────────────
// Pure (no Deno-only or Supabase-client imports) helper used by
// `bd-sync-now/index.ts` to walk the `bd_issues.id` column across
// PostgREST's `max-rows` cap.  Lives in its own file so Vitest (Node
// runtime, no Deno globals) can import and exercise it directly — the
// edge-function entry point can't be tested by Vitest because of its
// `Deno.serve` + `https://esm.sh/...` imports.
//
// PostgREST applies the project-level `max-rows` setting (1000 by
// default) to every `.select()` query.  A naive single-page read of
// `bd_issues.id` would therefore silently drop any row beyond that cap
// from the tombstone diff, leaving stale rows undeletable and the mirror
// permanently drifted.  This module's `fetchAllIds()` paginates with
// `.range()` until it sees a short page, guaranteeing every row is
// visible to the diff regardless of table size.

/**
 * Default page size for `fetchAllIds()`.  Matches PostgREST's default
 * `max-rows` ceiling so we always pull a full page when one exists.
 * Smaller pages still work but multiply round-trips for no correctness
 * gain; larger pages risk hitting `max-rows` and looking like a short
 * page (which would terminate the loop early and miss rows).
 */
export const ID_PAGE_SIZE = 1000;

/**
 * Shape of one page returned by the fetcher callback passed to
 * `fetchAllIds()`.  Mirrors the relevant subset of the Supabase client's
 * `.select().range()` response so the production caller can forward
 * the response object directly; tests inject plain objects with the
 * same fields.
 */
export interface IdPage {
  /** One row per id — same shape as `.select('id')` from PostgREST. */
  data:  { id: string }[] | null;
  /** Either a Supabase-style error object or `null` on success. */
  error: { message: string } | null;
}

/**
 * Async fetcher signature — given an inclusive `[start, end]` row range,
 * return a single page of `{ id }` rows.  Production wires this to the
 * Supabase client; tests wire it to an in-memory array.
 */
export type FetchPage = (start: number, end: number) => Promise<IdPage>;

/**
 * Walk every page of an `id` column and return the de-duplicated set of
 * ids plus the total row count.
 *
 * Iterates over `.range(start, end)` calls until a page returns fewer
 * rows than `pageSize` — the unambiguous signal that we've reached the
 * end of the table.  Aggregates ids into a `Set` so the caller can
 * diff against the JSONL set in O(1) per lookup.
 *
 * @param fetchPage  Callback returning one page for the inclusive
 *                   `[start, end]` row range.  See `FetchPage`.
 * @param pageSize   Rows per page; defaults to `ID_PAGE_SIZE` (1000).
 *                   Must match the upstream `max-rows` cap so a full
 *                   page never looks like a partial one.
 *
 * @returns          `{ ids, count }` where `ids` is the unioned id set
 *                   and `count` is the raw row total (`ids.size` unless
 *                   the source contains duplicates — the PK on
 *                   `bd_issues` forbids that in production).
 *
 * @throws  Error with the failing page's message if any page read returns
 *          a non-null `error` field; caller maps this to a 5xx response.
 *
 * Edge cases:
 *   * Empty table → one zero-row page → returns `{ ids: ∅, count: 0 }`.
 *   * Exactly N×pageSize rows → N full pages + one empty terminator page.
 *   * `data === null` on a page is treated as an empty page (loop ends).
 *   * Caller can pass `pageSize < total` to stress-test pagination in
 *     unit tests without seeding 1000+ rows.
 */
export async function fetchAllIds(
  fetchPage: FetchPage,
  pageSize:  number = ID_PAGE_SIZE,
): Promise<{ ids: Set<string>; count: number }> {
  const ids = new Set<string>();
  let count = 0;

  // ── Sliding window over the PostgREST `Range` header ─────────────────
  // `.range(start, end)` is inclusive on both ends, so the first page
  // spans `[0..pageSize-1]`, the second `[pageSize..2*pageSize-1]`, etc.
  // The loop is unbounded because the row count isn't known upfront; it
  // terminates the instant a page returns fewer rows than `pageSize`.
  for (let start = 0; ; start += pageSize) {
    const end  = start + pageSize - 1;
    const page = await fetchPage(start, end);
    if (page.error) {
      throw new Error(page.error.message);
    }
    const rows = page.data ?? [];
    for (const row of rows) {
      ids.add(row.id);
    }
    count += rows.length;
    // ── Termination: a short page (or empty data) means we've hit the
    // tail of the table — no further round-trips needed.
    if (rows.length < pageSize) break;
  }

  return { ids, count };
}
