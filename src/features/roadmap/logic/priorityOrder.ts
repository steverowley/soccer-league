// ── roadmap/logic/priorityOrder.ts ──────────────────────────────────────────
// Pure helpers for the kanban board's in-column ordering.
//
// WHY a separate pure module rather than inlining in the UI:
//   1. Sorting and neighbour-swap logic is easier to reason about in
//      isolation than mixed with React state and Supabase round-trips.
//   2. The board's "move up / move down" buttons need to compute the
//      priority pair to write BEFORE issuing the DB update — getting the
//      neighbour identification wrong silently corrupts ordering, so the
//      logic deserves its own test surface.
//   3. `logic/` has zero React and zero Supabase imports by convention,
//      which keeps unit tests fast and dependency-free.
//
// MENTAL MODEL OF `priority`:
//   * Range 0..100, smallint in Postgres.
//   * LOWER value = higher priority within a column.  This mirrors how the
//     team talks ("P0 trumps P1") and keeps the SQL ORDER BY trivial.
//   * Default 50 puts new items in the middle of the column so reordering
//     in either direction is cheap.
//   * Ties on priority are broken by `created_at` ASC (oldest first) so
//     historical context wins ties — a 4-week-old "P1" outranks a fresh
//     "P1" even if they share the integer.

import type { BoardItem, RoadmapItem, RoadmapStatus } from '../types';

// ── Sorting ─────────────────────────────────────────────────────────────────

/**
 * Sort roadmap items by priority ascending, then by `created_at` ascending
 * as a stable tiebreak so the same input always renders the same column
 * order across reloads.
 *
 * Returns a new array — the input is never mutated, so callers can pass
 * React state slices directly without violating immutability.
 *
 * @param items - Items to sort (any status mix; filter first if needed).
 * @returns     A new array sorted lowest-priority-number first.
 */
export function sortByPriority(items: readonly RoadmapItem[]): RoadmapItem[] {
  return [...items].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    // Stable tiebreak — `created_at` is ISO-8601 so lexicographic compare
    // is correct chronological order without parsing to Date.
    return a.created_at.localeCompare(b.created_at);
  });
}

/**
 * Group items by status into the four kanban buckets, sorted within
 * each bucket by priority.  Buckets without items are still present
 * as empty arrays so the UI can iterate a constant-shaped object.
 *
 * @param items - All items (any status mix).
 * @returns     Object keyed by status containing the sorted items per column.
 */
export function groupByStatus(
  items: readonly RoadmapItem[],
): Record<RoadmapStatus, RoadmapItem[]> {
  const buckets: Record<RoadmapStatus, RoadmapItem[]> = {
    idea: [],
    planned: [],
    in_progress: [],
    shipped: [],
  };
  for (const item of items) buckets[item.status].push(item);
  for (const status of Object.keys(buckets) as RoadmapStatus[]) {
    buckets[status] = sortByPriority(buckets[status]);
  }
  return buckets;
}

// ── Merged board-item grouping (bd + Supabase) ─────────────────────────────
// Same shape as `groupByStatus` but for the unified `BoardItem` union —
// used by the kanban board when rendering both sources in the same
// columns.  Sort + tiebreak are identical to the Supabase-only path so
// bd cards and Supabase cards interleave deterministically.

/**
 * Sort a list of board items (Supabase + bd, mixed) by priority asc, then
 * by `created_at` asc as a stable tiebreak.  Returns a new array; the
 * input is not mutated.
 *
 * @param items - Mixed items to sort.
 * @returns     A new array sorted lowest-priority-number first.
 */
export function sortBoardItemsByPriority(items: readonly BoardItem[]): BoardItem[] {
  return [...items].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.created_at.localeCompare(b.created_at);
  });
}

/**
 * Group a mixed stream of board items into the four kanban buckets and
 * sort each bucket by priority.  Used by `RoadmapBoard` once the bd
 * snapshot has been mapped into `BdBoardItem`s and merged with the
 * Supabase `SupabaseBoardItem`s.
 *
 * @param items - Mixed board items.
 * @returns     Object keyed by status; every column is a sorted array
 *              (possibly empty).
 */
export function groupBoardItemsByStatus(
  items: readonly BoardItem[],
): Record<RoadmapStatus, BoardItem[]> {
  const buckets: Record<RoadmapStatus, BoardItem[]> = {
    idea: [],
    planned: [],
    in_progress: [],
    shipped: [],
  };
  for (const item of items) buckets[item.status].push(item);
  for (const status of Object.keys(buckets) as RoadmapStatus[]) {
    buckets[status] = sortBoardItemsByPriority(buckets[status]);
  }
  return buckets;
}

// ── Neighbour-swap reprioritisation ────────────────────────────────────────

/**
 * The pair of items whose priorities need to be swapped to achieve a
 * one-step reorder.  `null` when the target item is already at the
 * top/bottom of its column and cannot move further in the requested
 * direction.
 */
export interface PrioritySwap {
  /** The item the user clicked the up/down arrow on. */
  target: RoadmapItem;
  /** Its neighbour in the requested direction (above for 'up', below for 'down'). */
  neighbour: RoadmapItem;
  /** The new priority to write onto `target` (= neighbour's current priority). */
  targetPriority: number;
  /** The new priority to write onto `neighbour` (= target's current priority). */
  neighbourPriority: number;
}

/**
 * Compute the priority-swap pair to move an item one slot up or down
 * within its column.  Returns `null` if the item is missing from the
 * list or already at the relevant edge.
 *
 * WHY swap rather than insert a new value: keeping priorities as an
 * always-bounded smallint means we never need to "rebalance" the column
 * (the classic linked-list-with-priorities trap).  Two items trade values;
 * everyone else's relative order is preserved.
 *
 * EDGE CASE — duplicate priorities: when two items in the same column
 * share the same `priority`, the swap still works because we identify the
 * neighbour by sort index, not by priority value.  The DB writes the new
 * pair of values; ties resolved by `created_at` keep the visual ordering
 * deterministic before and after the swap.
 *
 * @param items     - All items in the same column as `targetId`.
 * @param targetId  - The item the user wants to move.
 * @param direction - 'up' (towards index 0) or 'down' (towards last).
 * @returns         The swap to apply, or `null` if no move is possible.
 */
export function reprioritizeNeighbours(
  items: readonly RoadmapItem[],
  targetId: string,
  direction: 'up' | 'down',
): PrioritySwap | null {
  const sorted = sortByPriority(items);
  const targetIdx = sorted.findIndex((i) => i.id === targetId);
  if (targetIdx === -1) return null;

  const neighbourIdx = direction === 'up' ? targetIdx - 1 : targetIdx + 1;
  if (neighbourIdx < 0 || neighbourIdx >= sorted.length) return null;

  const target = sorted[targetIdx]!;
  const neighbour = sorted[neighbourIdx]!;

  // When the neighbours share the same priority value, a literal swap
  // would be a no-op and leave the items in the same visual order.  Nudge
  // the target's new priority one step past the neighbour so the move
  // visually "takes".  Clamp to 0..100 so we never exit the CHECK range.
  let targetPriority = neighbour.priority;
  const neighbourPriority = target.priority;
  if (targetPriority === neighbourPriority) {
    if (direction === 'up') {
      targetPriority = Math.max(0, neighbour.priority - 1);
    } else {
      targetPriority = Math.min(100, neighbour.priority + 1);
    }
  }

  return { target, neighbour, targetPriority, neighbourPriority };
}

// ── Display bucketing ──────────────────────────────────────────────────────
// The card UI shows a coarse P0..P3 chip rather than the raw 0..100 value
// because the integer is a sortable handle, not a number anyone needs to
// reason about directly.

/** Coarse priority bucket displayed on each card. */
export type PriorityBucket = 'P0' | 'P1' | 'P2' | 'P3';

/**
 * Convert a raw `priority` value to its display bucket.
 *   0–24  → P0  (top urgency)
 *   25–49 → P1
 *   50–74 → P2  (default new-item zone)
 *   75–100 → P3
 *
 * @param priority - Raw smallint 0..100.
 * @returns        Display label for the card chip.
 */
export function priorityBucket(priority: number): PriorityBucket {
  if (priority < 25) return 'P0';
  if (priority < 50) return 'P1';
  if (priority < 75) return 'P2';
  return 'P3';
}
