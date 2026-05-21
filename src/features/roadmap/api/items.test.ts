// ── roadmap/api/items.test.ts ───────────────────────────────────────────────
// Tests for the roadmap api layer.  Uses the same hand-rolled in-memory
// Supabase double pattern as `features/admin/api/admin.test.ts` and
// `features/betting/api/wagers.test.ts` — no `vi.mock`, no module
// patching, no real network.
//
// Coverage goals:
//   * `listItems`    — returns validated rows, drops malformed rows.
//   * `createItem`   — round-trips a row through insert → select → parse.
//   * `updateItem`   — patches only the supplied keys.
//   * `deleteItem`   — removes the row.
//   * `swapPriority` — writes both priorities in parallel.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  listItems,
  createItem,
  updateItem,
  deleteItem,
  swapPriority,
} from './items';
import type { IslSupabaseClient } from '@shared/supabase/client';

// ── In-memory store shape ──────────────────────────────────────────────────
// Mirrors the columns the api file actually touches.  Any column not
// referenced here would surface as `undefined` in the read path, which
// `RoadmapItemSchema` would reject — exactly what we want a real schema
// drift to do too.

interface ItemRow {
  id: string;
  title: string;
  notes: string | null;
  status: string;
  priority: number;
  tags: string[];
  effort: string | null;
  pillar: string | null;
  source: string | null;
  bd_issue_id: string | null;
  shipped_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface FakeStore {
  roadmap_items: ItemRow[];
}

/**
 * Build a fresh fake Supabase client backed by `store`.  Implements only
 * the chain surface the api file uses: from / select / insert / update /
 * delete / eq / order / single + await-thenable.  Anything else throws
 * so a future api change against an unstubbed call fails loudly.
 */
function makeFakeDb(store: FakeStore): IslSupabaseClient {
  function from(table: keyof FakeStore) {
    const filters: Array<{ col: string; val: unknown }> = [];
    let mode: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: Record<string, unknown> | Record<string, unknown>[] | null = null;
    let single = false;

    function applyFilters(rows: ItemRow[]): ItemRow[] {
      let out = rows;
      for (const f of filters) {
        out = out.filter((r) => (r as unknown as Record<string, unknown>)[f.col] === f.val);
      }
      return out;
    }

    async function executor() {
      const rows = store[table];
      // ── SELECT ────────────────────────────────────────────────────────
      if (mode === 'select') {
        const matched = applyFilters(rows);
        if (single) {
          return { data: matched[0] ?? null, error: matched[0] ? null : { message: 'no rows' } };
        }
        return { data: matched, error: null };
      }
      // ── INSERT ────────────────────────────────────────────────────────
      if (mode === 'insert' && payload) {
        const now = new Date().toISOString();
        const inserted: ItemRow = {
          // Defaults that Postgres would normally supply at INSERT time.
          // v4-shaped UUID so the Zod boundary in items.ts accepts it; the
          // third group must start with the version byte 4 and the fourth
          // with the variant byte 8/9/a/b for `z.string().uuid()` to pass.
          id: `11111111-1111-4111-8111-${String(rows.length + 1).padStart(12, '1')}`,
          title: 'untitled',
          notes: null,
          status: 'idea',
          priority: 50,
          tags: [],
          effort: null,
          pillar: null,
          source: null,
          bd_issue_id: null,
          shipped_at: null,
          created_by: null,
          created_at: now,
          updated_at: now,
          // User-supplied payload overrides defaults.
          ...(payload as Record<string, unknown>),
        } as ItemRow;
        // Simulate the shipped_at insert trigger.
        if (inserted.status === 'shipped' && !inserted.shipped_at) {
          inserted.shipped_at = now;
        }
        rows.push(inserted);
        return { data: single ? inserted : [inserted], error: null };
      }
      // ── UPDATE ────────────────────────────────────────────────────────
      if (mode === 'update' && payload) {
        const matched = applyFilters(rows);
        for (const r of matched) {
          const before = r.status;
          Object.assign(r, payload);
          r.updated_at = new Date().toISOString();
          // Simulate the shipped_at update trigger.
          if (r.status === 'shipped' && before !== 'shipped') {
            r.shipped_at = new Date().toISOString();
          } else if (r.status !== 'shipped' && before === 'shipped') {
            r.shipped_at = null;
          }
        }
        return { data: single ? (matched[0] ?? null) : matched, error: null };
      }
      // ── DELETE ────────────────────────────────────────────────────────
      if (mode === 'delete') {
        const matched = applyFilters(rows);
        for (const r of matched) {
          const idx = rows.indexOf(r);
          if (idx >= 0) rows.splice(idx, 1);
        }
        return { data: null, error: null };
      }
      return { data: null, error: { message: 'unsupported chain' } };
    }

    const builder: Record<string, unknown> = {
      select() { return builder; },
      insert(p: Record<string, unknown> | Record<string, unknown>[]) {
        mode = 'insert'; payload = p; return builder;
      },
      update(p: Record<string, unknown>) {
        mode = 'update'; payload = p; return builder;
      },
      delete() { mode = 'delete'; return builder; },
      eq(col: string, val: unknown) { filters.push({ col, val }); return builder; },
      order() { return builder; },
      single() { single = true; return builder; },
      then<T>(resolve: (v: { data: T; error: { message: string } | null }) => unknown) {
        return executor().then((res) => resolve(res as unknown as { data: T; error: { message: string } | null }));
      },
    };
    return builder;
  }
  return { from } as unknown as IslSupabaseClient;
}

/** Helper that pre-fills a row with valid defaults for read-path tests. */
function seedRow(overrides: Partial<ItemRow> = {}): ItemRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'seed',
    notes: null,
    status: 'idea',
    priority: 50,
    tags: [],
    effort: null,
    pillar: null,
    source: null,
    bd_issue_id: null,
    shipped_at: null,
    created_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// ── listItems ──────────────────────────────────────────────────────────────

describe('listItems', () => {
  let store: FakeStore;
  let db: IslSupabaseClient;

  beforeEach(() => {
    store = { roadmap_items: [] };
    db = makeFakeDb(store);
  });

  it('returns an empty array when the table is empty', async () => {
    expect(await listItems(db)).toEqual([]);
  });

  it('returns validated rows', async () => {
    store.roadmap_items.push(seedRow({ id: '11111111-1111-4111-8111-111111111111', title: 'a' }));
    store.roadmap_items.push(seedRow({ id: '22222222-2222-4222-8222-222222222222', title: 'b' }));
    const items = await listItems(db);
    expect(items.map((i) => i.title).sort()).toEqual(['a', 'b']);
  });

  it('drops rows with invalid status and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    store.roadmap_items.push(seedRow({ id: '11111111-1111-4111-8111-111111111111', status: 'idea' }));
    store.roadmap_items.push(seedRow({ id: '22222222-2222-4222-8222-222222222222', status: 'bogus' }));
    const items = await listItems(db);
    expect(items.map((i) => i.id)).toEqual(['11111111-1111-4111-8111-111111111111']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ── createItem ─────────────────────────────────────────────────────────────

describe('createItem', () => {
  it('inserts a row and returns the validated shape', async () => {
    const store: FakeStore = { roadmap_items: [] };
    const db = makeFakeDb(store);
    const created = await createItem(db, { title: 'new idea' });
    expect(created).not.toBeNull();
    expect(created!.title).toBe('new idea');
    expect(created!.status).toBe('idea');
    expect(store.roadmap_items).toHaveLength(1);
  });

  it('honours an explicit shipped status by stamping shipped_at', async () => {
    const store: FakeStore = { roadmap_items: [] };
    const db = makeFakeDb(store);
    const created = await createItem(db, { title: 'born done', status: 'shipped' });
    expect(created!.shipped_at).not.toBeNull();
  });
});

// ── updateItem ─────────────────────────────────────────────────────────────

describe('updateItem', () => {
  it('patches only the supplied keys', async () => {
    const store: FakeStore = { roadmap_items: [seedRow({ title: 'before' })] };
    const db = makeFakeDb(store);
    const updated = await updateItem(db, store.roadmap_items[0]!.id, { title: 'after' });
    expect(updated!.title).toBe('after');
    expect(store.roadmap_items[0]!.priority).toBe(50); // unchanged
  });

  it('stamps shipped_at when status flips to shipped', async () => {
    const store: FakeStore = { roadmap_items: [seedRow({ status: 'in_progress' })] };
    const db = makeFakeDb(store);
    const updated = await updateItem(db, store.roadmap_items[0]!.id, { status: 'shipped' });
    expect(updated!.shipped_at).not.toBeNull();
  });

  it('clears shipped_at when status moves back out of shipped', async () => {
    const store: FakeStore = {
      roadmap_items: [seedRow({ status: 'shipped', shipped_at: '2026-04-01T00:00:00Z' })],
    };
    const db = makeFakeDb(store);
    const updated = await updateItem(db, store.roadmap_items[0]!.id, { status: 'planned' });
    expect(updated!.shipped_at).toBeNull();
  });
});

// ── deleteItem ─────────────────────────────────────────────────────────────

describe('deleteItem', () => {
  it('removes the row from the store', async () => {
    const store: FakeStore = { roadmap_items: [seedRow()] };
    const db = makeFakeDb(store);
    const ok = await deleteItem(db, store.roadmap_items[0]!.id);
    expect(ok).toBe(true);
    expect(store.roadmap_items).toHaveLength(0);
  });
});

// ── swapPriority ───────────────────────────────────────────────────────────

describe('swapPriority', () => {
  it('writes both new priority values', async () => {
    const store: FakeStore = {
      roadmap_items: [
        seedRow({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', priority: 10 }),
        seedRow({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', priority: 40 }),
      ],
    };
    const db = makeFakeDb(store);
    const ok = await swapPriority(
      db,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 40,
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 10,
    );
    expect(ok).toBe(true);
    const byId = Object.fromEntries(store.roadmap_items.map((r) => [r.id, r.priority]));
    expect(byId['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']).toBe(40);
    expect(byId['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']).toBe(10);
  });
});
