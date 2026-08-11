// ── features/entities/api/entities.test.ts ───────────────────────────────────
// Unit tests for the narrative read behind the Galaxy Dispatch feed. Mocks
// Supabase at the chainable-query boundary (same approach as chronicle.test.ts)
// so no real client is touched.
//
// COVERAGE
//   • Happy path: valid rows parse and come back newest-first as handed over.
//   • Filters: `source` / `kind` map to .eq() calls (server-side filtering is
//     what lets low-frequency kinds survive the row limit).
//   • Empty wire: no rows resolves to [] — a state the page renders as "the
//     cosmos hasn't spoken yet".
//   • Error path: a Supabase error THROWS. It used to resolve to [], which the
//     page could only show as the empty-wire copy — asserting silence when the
//     read had actually failed.

import { describe, it, expect, vi, afterEach } from 'vitest';

import type { IslSupabaseClient } from '@shared/supabase/client';

import { getRecentNarratives } from './entities';

// ── Chainable Supabase query mock ────────────────────────────────────────────

interface MockResult {
  data: unknown;
  error: { message: string } | null;
}

function makeDb(result: MockResult) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const record = (method: string, args: unknown[]) => calls.push({ method, args });

  const builder = {
    select(...a: unknown[]) { record('select', a); return builder; },
    order(...a: unknown[])  { record('order', a);  return builder; },
    limit(...a: unknown[])  { record('limit', a);  return builder; },
    eq(...a: unknown[])     { record('eq', a);     return builder; },
    then(resolve: (v: MockResult) => unknown) { return resolve(result); },
  };

  const db = {
    from(table: string) { record('from', [table]); return builder; },
  } as unknown as IslSupabaseClient;

  return { db, calls };
}

/** A complete, valid narrative row as PostgREST would return it. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    kind: 'pundit_takes',
    summary: 'That was, technically, football.',
    entities_involved: [],
    source: 'scheduled',
    created_at: '2026-08-11T08:00:00Z',
    acknowledged_by: [],
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getRecentNarratives', () => {
  it('returns parsed rows in the order PostgREST handed them over', async () => {
    const { db } = makeDb({
      data: [
        row({ summary: 'newest' }),
        row({ id: '00000000-0000-0000-0000-000000000002', summary: 'older' }),
      ],
      error: null,
    });
    const rows = await getRecentNarratives(db, 20);
    expect(rows.map((r) => r.summary)).toEqual(['newest', 'older']);
  });

  it('reads the narratives table newest-first under the requested limit', async () => {
    const { db, calls } = makeDb({ data: [], error: null });
    await getRecentNarratives(db, 7);
    expect(calls.find((c) => c.method === 'from')?.args).toEqual(['narratives']);
    expect(calls.find((c) => c.method === 'order')?.args).toEqual([
      'created_at',
      { ascending: false },
    ]);
    expect(calls.find((c) => c.method === 'limit')?.args).toEqual([7]);
  });

  it('pushes source and kind filters into the query', async () => {
    const { db, calls } = makeDb({ data: [], error: null });
    await getRecentNarratives(db, 20, 'scheduled', 'daybreak');
    const eqs = calls.filter((c) => c.method === 'eq').map((c) => c.args);
    expect(eqs).toEqual([['source', 'scheduled'], ['kind', 'daybreak']]);
  });

  it('applies no filters when neither is given', async () => {
    const { db, calls } = makeDb({ data: [], error: null });
    await getRecentNarratives(db, 20);
    expect(calls.filter((c) => c.method === 'eq')).toHaveLength(0);
  });

  it('resolves to an empty array when the wire is genuinely empty', async () => {
    const { db } = makeDb({ data: [], error: null });
    await expect(getRecentNarratives(db, 20)).resolves.toEqual([]);
  });

  it('throws on a query error rather than passing an empty wire off as the truth', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db } = makeDb({ data: null, error: { message: 'permission denied' } });
    await expect(getRecentNarratives(db, 20)).rejects.toThrow(/permission denied/);
  });
});
