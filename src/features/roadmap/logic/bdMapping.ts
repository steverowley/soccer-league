// ── roadmap/logic/bdMapping.ts ──────────────────────────────────────────────
// Pure mappers that translate bd (beads) issues into the kanban board's
// own column / priority vocabulary.
//
// WHY a dedicated mapping layer:
//   bd has its own status set (open / ready / blocked / in_progress /
//   closed) and a priority scale (typically 0..5 where 0 = top urgency).
//   The kanban board uses 4 status columns + a 0..100 priority value
//   (lower = higher).  Bridging these in one place keeps the mapping
//   honest, testable, and centrally documented for future schema drift
//   on either side.
//
// REVERSAL: we never write back to bd from the dashboard — bd is read-
// only.  This module only maps inbound (bd → board); curated edits stay
// in the Supabase `roadmap_items` table.

import type { RoadmapStatus } from '../types';

// ── bd → kanban status ─────────────────────────────────────────────────────
// Mapping rationale per bd status:
//
//   open        → idea         raw, not yet shaped or prioritised
//   blocked     → idea         can't be worked on; sits in the ideas pile
//                              until unblocked
//   ready       → planned      groomed, picked up next
//   in_progress → in_progress  active work
//   closed      → shipped      done; powers the wins log
//
// Anything outside that set (future bd statuses, typos) falls through to
// `idea` so the card still appears somewhere — silent loss would be worse
// than mis-placement.

const STATUS_MAP: Record<string, RoadmapStatus> = {
  open: 'idea',
  blocked: 'idea',
  ready: 'planned',
  in_progress: 'in_progress',
  closed: 'shipped',
};

/**
 * Map a raw bd status string to the kanban board's status column.
 *
 * @param bdStatus - Status string from bd JSONL (e.g. 'ready', 'closed').
 * @returns        The kanban column membership.  Unknown statuses fall
 *                 back to 'idea' so the card never disappears.
 */
export function mapBdStatus(bdStatus: string): RoadmapStatus {
  return STATUS_MAP[bdStatus] ?? 'idea';
}

// ── bd → kanban priority ────────────────────────────────────────────────────
// bd uses small integers where lower = more urgent (0 = drop-everything,
// 5 = nice-to-have).  The dashboard's `priority` is a smallint 0..100,
// lower = higher priority.  Mapping with explicit anchors:
//
//   bd 0 → 5    (deep P0 zone)
//   bd 1 → 20   (P0 boundary)
//   bd 2 → 45   (P1)
//   bd 3 → 70   (P2)
//   bd 4 → 85   (P3)
//   bd 5+ → 95  (low-priority pile)
//
// Anchors picked so the bd item lands inside the matching `priorityBucket`
// label (P0..P3) without being on a boundary.

const PRIORITY_ANCHORS: Record<number, number> = {
  0: 5,
  1: 20,
  2: 45,
  3: 70,
  4: 85,
  5: 95,
};

/**
 * Map a bd integer priority to the dashboard's 0..100 scale.
 *
 * @param bdPriority - bd priority integer (typically 0..5).  `null` /
 *                     undefined / negative / out-of-range values default
 *                     to 50 (mid-priority) — same default the Supabase
 *                     dashboard uses for fresh-but-unsized items.
 * @returns          A priority value in [0, 100].
 */
export function mapBdPriority(bdPriority: number | null | undefined): number {
  if (typeof bdPriority !== 'number' || Number.isNaN(bdPriority)) return 50;
  if (bdPriority < 0) return 50;
  if (bdPriority >= 5) return PRIORITY_ANCHORS[5] ?? 95;
  return PRIORITY_ANCHORS[bdPriority] ?? 50;
}
