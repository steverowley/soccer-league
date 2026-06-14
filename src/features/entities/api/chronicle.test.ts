// ── features/entities/api/chronicle.test.ts ──────────────────────────────────
// Unit tests for the Chronicle read surface (#575). Mocks Supabase at the
// chainable-query boundary (same approach as relationships.test.ts) so no real
// client is touched and tests stay deterministic.
//
// COVERAGE
//   • Happy path: valid rows parse + return newest-first as handed back.
//   • Filters: each ChronicleQuery field maps to the expected .eq/.contains call.
//   • Drift tolerance: malformed rows are dropped, not thrown.
//   • null entities_involved coerces to [] (a participant-less event is kept).
//   • Error path: a Supabase error yields [] rather than throwing.

import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { IslSupabaseClient } from '@shared/supabase/client';

import { getChronicle, ChronicleEventSchema } from './chronicle';

// ── Chainable Supabase query mock ─────────────────────────────────────────────
// Every chainable method records its call and returns the builder; awaiting the
// builder resolves to the queued `{ data, error }`. This lets a test assert both
// the returned rows AND which filters were applied.

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
    contains(...a: unknown[]) { record('contains', a); return builder; },
    // Thenable so `await builder` resolves to the queued result.
    then(resolve: (v: MockResult) => unknown) { return resolve(result); },
  };

  const db = {
    from(table: string) { record('from', [table]); return builder; },
  } as unknown as IslSupabaseClient;

  return { db, calls };
}

/** A complete, valid chronicle row as PostgREST would return it. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'n1',
    kind: 'feud_declaration',
    action: 'feud',
    summary: 'Pluto and Eris trade barbs across the void.',
    actor_entity_id: '00000000-0000-0000-0000-000000000001',
    target_entity_id: '00000000-0000-0000-0000-000000000002',
    place_entity_id: null,
    season_id: '00000000-0000-0000-0000-0000000000aa',
    tick: null,
    importance: 3,
    entities_involved: ['00000000-0000-0000-0000-000000000001'],
    source: 'scheduled',
    created_at: '2026-06-14T00:00:00Z',
    ...overrides,
  };
}

describe('getChronicle', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns parsed rows, newest first as handed back', async () => {
    const { db } = makeDb({ data: [row(), row({ id: 'n2' })], error: null });
    const out = await getChronicle(db);
    expect(out).toHaveLength(2);
    expect(out[0]!.id).toBe('n1');
    expect(out[0]!.action).toBe('feud');
  });

  it('always orders newest-first and applies the default limit of 50', async () => {
    const { db, calls } = makeDb({ data: [], error: null });
    await getChronicle(db);
    expect(calls).toContainEqual({ method: 'from', args: ['narratives'] });
    expect(calls).toContainEqual({ method: 'order', args: ['created_at', { ascending: false }] });
    expect(calls).toContainEqual({ method: 'limit', args: [50] });
  });

  it('maps each filter to the expected query call', async () => {
    const { db, calls } = makeDb({ data: [], error: null });
    await getChronicle(db, {
      actorEntityId: 'a',
      placeEntityId: 'p',
      seasonId: 's',
      action: 'feud',
      kind: 'feud_declaration',
      involvingEntityId: 'e',
      limit: 10,
    });
    expect(calls).toContainEqual({ method: 'eq', args: ['actor_entity_id', 'a'] });
    expect(calls).toContainEqual({ method: 'eq', args: ['place_entity_id', 'p'] });
    expect(calls).toContainEqual({ method: 'eq', args: ['season_id', 's'] });
    expect(calls).toContainEqual({ method: 'eq', args: ['action', 'feud'] });
    expect(calls).toContainEqual({ method: 'eq', args: ['kind', 'feud_declaration'] });
    expect(calls).toContainEqual({ method: 'contains', args: ['entities_involved', ['e']] });
    expect(calls).toContainEqual({ method: 'limit', args: [10] });
  });

  it('does not apply a filter that was not provided', async () => {
    const { db, calls } = makeDb({ data: [], error: null });
    await getChronicle(db, { seasonId: 's' });
    const eqCalls = calls.filter((c) => c.method === 'eq');
    expect(eqCalls).toEqual([{ method: 'eq', args: ['season_id', 's'] }]);
    expect(calls.some((c) => c.method === 'contains')).toBe(false);
  });

  it('drops malformed rows instead of throwing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Second row is missing `summary` (required) → dropped.
    const { db } = makeDb({ data: [row(), { id: 'bad', kind: 'x' }], error: null });
    const out = await getChronicle(db);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe('n1');
  });

  it('returns [] and warns on a Supabase error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db } = makeDb({ data: null, error: { message: 'boom' } });
    const out = await getChronicle(db);
    expect(out).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });
});

describe('ChronicleEventSchema', () => {
  it('coerces a null entities_involved to an empty array', () => {
    const parsed = ChronicleEventSchema.parse(row({ entities_involved: null }));
    expect(parsed.entities_involved).toEqual([]);
  });

  it('accepts nullable structured columns and any source value', () => {
    const parsed = ChronicleEventSchema.parse(
      row({ action: null, actor_entity_id: null, season_id: null, tick: 12, source: 'training' }),
    );
    expect(parsed.action).toBeNull();
    expect(parsed.tick).toBe(12);
    expect(parsed.source).toBe('training');
  });
});
