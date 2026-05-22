// ── relationships.test.ts ────────────────────────────────────────────────────
// Unit tests for the relationship-graph fetch surface (issue isl-szm).
// Mocks Supabase at the chainable-query boundary using the same shape as
// `src/features/match/api/matchEvents.test.ts:31-100` so no real client
// is touched and tests stay deterministic.
//
// COVERAGE AGAINST THE ISSUE'S ACCEPTANCE CRITERIA
//   • Zod-validated shapes  → every test asserts return shape, malformed
//                              rows are dropped not crashed.
//   • Empty results         → covered for all three helpers.
//   • Single-direction edges → outgoing-only and incoming-only assertions.
//   • Bidirectional edges   → both queries return rows; union is deduped
//                              by (from_id, to_id, kind).
//   • No React in api/      → ensured by the file living in api/ + having
//                              zero React imports.

import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { IslSupabaseClient } from '@shared/supabase/client';

import {
  getEntity,
  getEntityRelationships,
  getEntitiesByIds,
} from './relationships';

// ── Chainable Supabase query mock ─────────────────────────────────────────────
// Mirrors the shape used by matchEvents.test.ts: every chainable method
// returns the same builder, terminating with either `.maybeSingle()` or
// the `then` thenable when the consumer awaits the builder directly.
//
// `queue` is a per-table FIFO of `{ data, error }`; helpers are pushed
// to it in the order the call sites consume them.  When a call exhausts
// the queue, we return an explicit "no queued response" error so
// missing-mock cases fail loud rather than hanging.

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
      select(...args: unknown[]) { pushCall(table, 'select', args); return builder; },
      eq(...args: unknown[])     { pushCall(table, 'eq',     args); return builder; },
      in(...args: unknown[])     { pushCall(table, 'in',     args); return builder; },
      order(...args: unknown[])  { pushCall(table, 'order',  args); return builder; },
      maybeSingle() {
        pushCall(table, 'maybeSingle', []);
        if (!resolved) resolved = Promise.resolve(dequeue(table));
        return resolved;
      },
      // Consumers that await the builder directly (getEntityRelationships,
      // getEntitiesByIds) terminate via the thenable contract.
      then(onFulfilled: (r: QueuedResponse) => unknown) {
        if (!resolved) resolved = Promise.resolve(dequeue(table));
        return resolved.then(onFulfilled);
      },
    };
    return builder;
  }

  const db = { from: vi.fn((t: string) => queryFor(t)) };

  return {
    db: db as unknown as IslSupabaseClient,
    queue: {
      push(table: string, data: unknown, error: { message: string } | null = null) {
        const list = queue.get(table) ?? [];
        list.push({ data, error });
        queue.set(table, list);
      },
    },
    calls,
  };
}

// ── Fixture factories ────────────────────────────────────────────────────────

function entityRow(over: Partial<Record<string, unknown>> & { id: string }) {
  return {
    id:           over.id,
    kind:         over.kind         ?? 'player',
    name:         over.name         ?? `Entity ${String(over.id)}`,
    display_name: over.display_name ?? null,
    meta:         over.meta         ?? null,
    created_at:   over.created_at   ?? '2026-04-01T12:00:00Z',
  };
}

function relRow(over: Partial<Record<string, unknown>> & { from_id: string; to_id: string }) {
  return {
    from_id:  over.from_id,
    to_id:    over.to_id,
    kind:     over.kind     ?? 'rival',
    strength: over.strength ?? -40,
    meta:     over.meta     ?? null,
  };
}

// ── getEntity ────────────────────────────────────────────────────────────────

describe('getEntity', () => {
  let mock: ReturnType<typeof makeQueryMock>;
  beforeEach(() => { mock = makeQueryMock(); });

  it('returns the validated entity row on a hit', async () => {
    mock.queue.push('entities', entityRow({ id: 'e1', kind: 'pundit', name: 'Vox' }));
    const result = await getEntity(mock.db, 'e1');
    expect(result).toEqual({
      id:           'e1',
      kind:         'pundit',
      name:         'Vox',
      display_name: null,
      meta:         {},
      created_at:   '2026-04-01T12:00:00Z',
    });
    expect(mock.db.from).toHaveBeenCalledWith('entities');
  });

  it('normalises null/array meta to an empty object', async () => {
    mock.queue.push('entities', entityRow({ id: 'e2', meta: null }));
    const a = await getEntity(mock.db, 'e2');
    expect(a?.meta).toEqual({});

    // Arrays are valid JSONB but the typed Entity shape promises a record.
    mock.queue.push('entities', entityRow({ id: 'e3', meta: ['bogus'] }));
    const b = await getEntity(mock.db, 'e3');
    expect(b?.meta).toEqual({});
  });

  it('preserves object meta untouched', async () => {
    mock.queue.push('entities', entityRow({ id: 'e4', meta: { homeworld: 'Mars' } }));
    const a = await getEntity(mock.db, 'e4');
    expect(a?.meta).toEqual({ homeworld: 'Mars' });
  });

  it('returns null when the row is missing (data: null)', async () => {
    mock.queue.push('entities', null);
    const result = await getEntity(mock.db, 'missing');
    expect(result).toBeNull();
  });

  it('returns null when the query errors', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mock.queue.push('entities', null, { message: 'boom' });
    const result = await getEntity(mock.db, 'broken');
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('drops a malformed row (missing required columns) with a warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Missing `kind` and `name` — Zod must reject.
    mock.queue.push('entities', { id: 'bad', display_name: null, meta: null, created_at: '2026-04-01T12:00:00Z' });
    const result = await getEntity(mock.db, 'bad');
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ── getEntityRelationships ───────────────────────────────────────────────────

describe('getEntityRelationships', () => {
  let mock: ReturnType<typeof makeQueryMock>;
  beforeEach(() => { mock = makeQueryMock(); });

  it('returns an empty array when the entity has no edges', async () => {
    mock.queue.push('entity_relationships', []); // outgoing
    mock.queue.push('entity_relationships', []); // incoming
    const result = await getEntityRelationships(mock.db, 'lonely');
    expect(result).toEqual([]);
  });

  it('returns only outgoing edges when no incoming exist', async () => {
    mock.queue.push('entity_relationships', [
      relRow({ from_id: 'seed', to_id: 'b', kind: 'mentor', strength: 60 }),
    ]);
    mock.queue.push('entity_relationships', []);
    const result = await getEntityRelationships(mock.db, 'seed');
    expect(result).toEqual([
      { from_id: 'seed', to_id: 'b', kind: 'mentor', strength: 60, meta: {} },
    ]);
  });

  it('returns only incoming edges when no outgoing exist', async () => {
    mock.queue.push('entity_relationships', []);
    mock.queue.push('entity_relationships', [
      relRow({ from_id: 'a', to_id: 'seed', kind: 'rival', strength: -30 }),
    ]);
    const result = await getEntityRelationships(mock.db, 'seed');
    expect(result.map(r => `${r.from_id}->${r.to_id}`)).toEqual(['a->seed']);
  });

  it('unions outgoing + incoming edges for a bidirectionally-connected entity', async () => {
    mock.queue.push('entity_relationships', [
      relRow({ from_id: 'seed', to_id: 'b', kind: 'mentor', strength: 60 }),
      relRow({ from_id: 'seed', to_id: 'c', kind: 'rival',  strength: -50 }),
    ]);
    mock.queue.push('entity_relationships', [
      relRow({ from_id: 'd', to_id: 'seed', kind: 'admires', strength: 40 }),
    ]);
    const result = await getEntityRelationships(mock.db, 'seed');
    expect(result.map(r => `${r.from_id}->${r.to_id}:${r.kind}`).sort()).toEqual([
      'd->seed:admires',
      'seed->b:mentor',
      'seed->c:rival',
    ]);
  });

  it('dedupes by (from_id, to_id, kind) PK when the same row appears in both lists', async () => {
    // Self-edge: from_id === to_id === seed.  Both eq() queries would match
    // the same row.  The dedupe must collapse to one.
    const selfEdge = relRow({ from_id: 'seed', to_id: 'seed', kind: 'narcissism', strength: 100 });
    mock.queue.push('entity_relationships', [selfEdge]);
    mock.queue.push('entity_relationships', [selfEdge]);
    const result = await getEntityRelationships(mock.db, 'seed');
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('narcissism');
  });

  it('drops invalid rows (missing strength) without crashing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mock.queue.push('entity_relationships', [
      // Missing strength column entirely — Zod must reject.
      { from_id: 'seed', to_id: 'x', kind: 'mystery', meta: null },
      relRow({ from_id: 'seed', to_id: 'y', kind: 'rival', strength: -10 }),
    ]);
    mock.queue.push('entity_relationships', []);
    const result = await getEntityRelationships(mock.db, 'seed');
    expect(result.map(r => r.to_id)).toEqual(['y']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('logs both errors but does not throw when both queries fail', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mock.queue.push('entity_relationships', null, { message: 'out-fail' });
    mock.queue.push('entity_relationships', null, { message: 'in-fail' });
    const result = await getEntityRelationships(mock.db, 'broken');
    expect(result).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('normalises null meta on each returned edge to an empty object', async () => {
    mock.queue.push('entity_relationships', [
      relRow({ from_id: 'seed', to_id: 'b', meta: null }),
    ]);
    mock.queue.push('entity_relationships', []);
    const result = await getEntityRelationships(mock.db, 'seed');
    expect(result[0]?.meta).toEqual({});
  });
});

// ── getEntitiesByIds ─────────────────────────────────────────────────────────

describe('getEntitiesByIds', () => {
  let mock: ReturnType<typeof makeQueryMock>;
  beforeEach(() => { mock = makeQueryMock(); });

  it('short-circuits on an empty id list (no DB call)', async () => {
    const result = await getEntitiesByIds(mock.db, []);
    expect(result).toEqual([]);
    expect(mock.db.from).not.toHaveBeenCalled();
  });

  it('returns validated entity rows in the order PostgREST gives them', async () => {
    mock.queue.push('entities', [
      entityRow({ id: 'a', name: 'Alpha', kind: 'manager' }),
      entityRow({ id: 'b', name: 'Beta',  kind: 'player'  }),
    ]);
    const result = await getEntitiesByIds(mock.db, ['a', 'b']);
    expect(result.map(e => e.name)).toEqual(['Alpha', 'Beta']);
  });

  it('dedupes duplicate ids before sending the `in` query', async () => {
    mock.queue.push('entities', [entityRow({ id: 'a' })]);
    await getEntitiesByIds(mock.db, ['a', 'a', 'a']);
    // The deduped id list should arrive as a 1-element array.
    const inCall = mock.calls.find(c => c.method === 'in');
    expect(inCall?.args[1]).toEqual(['a']);
  });

  it('drops malformed rows but keeps the rest', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mock.queue.push('entities', [
      entityRow({ id: 'good' }),
      { id: 'bad' }, // missing every other required column
    ]);
    const result = await getEntitiesByIds(mock.db, ['good', 'bad']);
    expect(result.map(e => e.id)).toEqual(['good']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns [] and logs on a query error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mock.queue.push('entities', null, { message: 'boom' });
    const result = await getEntitiesByIds(mock.db, ['a']);
    expect(result).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('normalises meta consistently across the batch', async () => {
    mock.queue.push('entities', [
      entityRow({ id: 'a', meta: { team: 'home' } }),
      entityRow({ id: 'b', meta: null }),
      entityRow({ id: 'c', meta: [1, 2, 3] }),
    ]);
    const result = await getEntitiesByIds(mock.db, ['a', 'b', 'c']);
    expect(result.map(e => e.meta)).toEqual([
      { team: 'home' },
      {},
      {},
    ]);
  });
});
