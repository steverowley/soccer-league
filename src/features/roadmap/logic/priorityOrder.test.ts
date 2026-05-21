// ── roadmap/logic/priorityOrder.test.ts ─────────────────────────────────────
// Unit tests for the pure priority-ordering helpers.  These guard the
// kanban board's column ordering invariants — getting them wrong silently
// corrupts visible ordering and undermines trust that the dashboard is
// telling the truth about what's next.
//
// Test taxonomy:
//   * sortByPriority   — ascending sort + stable tiebreak.
//   * groupByStatus    — bucketing semantics + per-column sort.
//   * reprioritizeNeighbours — top/bottom guard rails + tie handling.
//   * priorityBucket   — boundary values between P0..P3.

import { describe, it, expect } from 'vitest';
import {
  sortByPriority,
  groupByStatus,
  reprioritizeNeighbours,
  priorityBucket,
} from './priorityOrder';
import type { RoadmapItem, RoadmapStatus } from '../types';

// ── Fixture helper ──────────────────────────────────────────────────────────
// Builds a minimal `RoadmapItem` shape; tests pass only the fields they
// care about and the helper fills in plausible defaults.  Centralising the
// defaults keeps the test bodies focused on the property under test.

interface ItemSeed {
  id: string;
  status?: RoadmapStatus;
  priority?: number;
  created_at?: string;
}

function item(seed: ItemSeed): RoadmapItem {
  return {
    id: seed.id,
    title: `item-${seed.id}`,
    notes: null,
    status: seed.status ?? 'idea',
    priority: seed.priority ?? 50,
    tags: [],
    effort: null,
    pillar: null,
    source: null,
    bd_issue_id: null,
    shipped_at: null,
    created_by: null,
    created_at: seed.created_at ?? '2026-01-01T00:00:00Z',
    updated_at: seed.created_at ?? '2026-01-01T00:00:00Z',
  };
}

// ── sortByPriority ──────────────────────────────────────────────────────────

describe('sortByPriority', () => {
  it('returns an empty array unchanged', () => {
    expect(sortByPriority([])).toEqual([]);
  });

  it('orders by ascending priority (lower wins)', () => {
    const sorted = sortByPriority([
      item({ id: 'b', priority: 50 }),
      item({ id: 'a', priority: 10 }),
      item({ id: 'c', priority: 90 }),
    ]);
    expect(sorted.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('breaks ties on created_at ascending', () => {
    const sorted = sortByPriority([
      item({ id: 'new', priority: 50, created_at: '2026-05-01T00:00:00Z' }),
      item({ id: 'old', priority: 50, created_at: '2026-01-01T00:00:00Z' }),
    ]);
    expect(sorted.map((i) => i.id)).toEqual(['old', 'new']);
  });

  it('does not mutate the input array', () => {
    const input = [
      item({ id: 'b', priority: 50 }),
      item({ id: 'a', priority: 10 }),
    ];
    const snapshot = input.map((i) => i.id);
    sortByPriority(input);
    expect(input.map((i) => i.id)).toEqual(snapshot);
  });
});

// ── groupByStatus ───────────────────────────────────────────────────────────

describe('groupByStatus', () => {
  it('returns all four buckets even when some are empty', () => {
    const groups = groupByStatus([item({ id: 'a', status: 'idea' })]);
    expect(Object.keys(groups).sort()).toEqual(
      ['idea', 'in_progress', 'planned', 'shipped'].sort(),
    );
    expect(groups.planned).toEqual([]);
    expect(groups.in_progress).toEqual([]);
    expect(groups.shipped).toEqual([]);
  });

  it('routes each item to its status bucket', () => {
    const groups = groupByStatus([
      item({ id: 'i1', status: 'idea' }),
      item({ id: 'p1', status: 'planned' }),
      item({ id: 'ip1', status: 'in_progress' }),
      item({ id: 's1', status: 'shipped' }),
      item({ id: 'i2', status: 'idea' }),
    ]);
    expect(groups.idea.map((i) => i.id).sort()).toEqual(['i1', 'i2']);
    expect(groups.planned.map((i) => i.id)).toEqual(['p1']);
    expect(groups.in_progress.map((i) => i.id)).toEqual(['ip1']);
    expect(groups.shipped.map((i) => i.id)).toEqual(['s1']);
  });

  it('sorts within each bucket by priority', () => {
    const groups = groupByStatus([
      item({ id: 'low',  status: 'planned', priority: 80 }),
      item({ id: 'high', status: 'planned', priority: 5  }),
      item({ id: 'mid',  status: 'planned', priority: 40 }),
    ]);
    expect(groups.planned.map((i) => i.id)).toEqual(['high', 'mid', 'low']);
  });
});

// ── reprioritizeNeighbours ──────────────────────────────────────────────────

describe('reprioritizeNeighbours', () => {
  it('returns null when the target is missing', () => {
    const items = [item({ id: 'a', priority: 10 })];
    expect(reprioritizeNeighbours(items, 'missing', 'up')).toBeNull();
  });

  it('returns null when moving up from the top of the column', () => {
    const items = [
      item({ id: 'a', priority: 10 }),
      item({ id: 'b', priority: 20 }),
    ];
    expect(reprioritizeNeighbours(items, 'a', 'up')).toBeNull();
  });

  it('returns null when moving down from the bottom of the column', () => {
    const items = [
      item({ id: 'a', priority: 10 }),
      item({ id: 'b', priority: 20 }),
    ];
    expect(reprioritizeNeighbours(items, 'b', 'down')).toBeNull();
  });

  it('swaps priorities with the upward neighbour', () => {
    const items = [
      item({ id: 'a', priority: 10 }),
      item({ id: 'b', priority: 40 }),
      item({ id: 'c', priority: 80 }),
    ];
    const swap = reprioritizeNeighbours(items, 'b', 'up');
    expect(swap).not.toBeNull();
    expect(swap!.target.id).toBe('b');
    expect(swap!.neighbour.id).toBe('a');
    expect(swap!.targetPriority).toBe(10);
    expect(swap!.neighbourPriority).toBe(40);
  });

  it('swaps priorities with the downward neighbour', () => {
    const items = [
      item({ id: 'a', priority: 10 }),
      item({ id: 'b', priority: 40 }),
      item({ id: 'c', priority: 80 }),
    ];
    const swap = reprioritizeNeighbours(items, 'b', 'down');
    expect(swap!.target.id).toBe('b');
    expect(swap!.neighbour.id).toBe('c');
    expect(swap!.targetPriority).toBe(80);
    expect(swap!.neighbourPriority).toBe(40);
  });

  it('nudges priority by one when neighbours share the same priority (up)', () => {
    // Same priority — the tie was broken by created_at, but a literal
    // swap would no-op visually.  Expect target.priority := neighbour-1.
    const items = [
      item({ id: 'a', priority: 50, created_at: '2026-01-01T00:00:00Z' }),
      item({ id: 'b', priority: 50, created_at: '2026-02-01T00:00:00Z' }),
    ];
    const swap = reprioritizeNeighbours(items, 'b', 'up');
    expect(swap!.targetPriority).toBe(49); // 50-1
    expect(swap!.neighbourPriority).toBe(50);
  });

  it('nudges priority by one when neighbours share the same priority (down)', () => {
    const items = [
      item({ id: 'a', priority: 50, created_at: '2026-01-01T00:00:00Z' }),
      item({ id: 'b', priority: 50, created_at: '2026-02-01T00:00:00Z' }),
    ];
    const swap = reprioritizeNeighbours(items, 'a', 'down');
    expect(swap!.targetPriority).toBe(51); // 50+1
    expect(swap!.neighbourPriority).toBe(50);
  });

  it('clamps nudged priority to 0..100', () => {
    const items = [
      item({ id: 'top',    priority: 0, created_at: '2026-01-01T00:00:00Z' }),
      item({ id: 'second', priority: 0, created_at: '2026-02-01T00:00:00Z' }),
    ];
    const swap = reprioritizeNeighbours(items, 'second', 'up');
    // Neighbour is already at 0, so target can't go to -1 — stays at 0.
    expect(swap!.targetPriority).toBe(0);
  });
});

// ── priorityBucket ─────────────────────────────────────────────────────────

describe('priorityBucket', () => {
  it.each([
    [0,   'P0'],
    [24,  'P0'],
    [25,  'P1'],
    [49,  'P1'],
    [50,  'P2'],
    [74,  'P2'],
    [75,  'P3'],
    [100, 'P3'],
  ])('priority %i → %s', (priority, label) => {
    expect(priorityBucket(priority)).toBe(label);
  });
});
