// ── roadmap/types.ts ────────────────────────────────────────────────────────
// Typed shapes for the roadmap feature.  The DB row is sourced directly
// from the generated `database.ts` Row helper — no manual mirror — so a
// schema drift surfaces at compile time.
//
// The four kanban statuses, four design pillars, and four effort sizes
// are duplicated as TS string-literal unions because the Postgres CHECK
// constraints don't survive type-generation.  Both ends are tested via
// the API-layer Zod boundary (see api/items.ts) so any future drift fails
// loud at runtime, not silently in the UI.

import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';

// ── Row shapes (DB-typed) ───────────────────────────────────────────────────

/**
 * Full row as returned by `select *` from `roadmap_items`.  Use this as
 * the canonical shape across the feature — `RoadmapStatus`, `RoadmapEffort`,
 * and `RoadmapPillar` below narrow the string columns once they've passed
 * the Zod boundary.
 */
export type RoadmapItemRow = Tables<'roadmap_items'>;

/** Insert payload — id / timestamps / shipped_at populated by Postgres. */
export type RoadmapItemInsert = TablesInsert<'roadmap_items'>;

/** Patch payload — every column optional, no implicit clears. */
export type RoadmapItemUpdate = TablesUpdate<'roadmap_items'>;

// ── Domain unions ───────────────────────────────────────────────────────────

/** Kanban column membership.  Order here matches left-to-right column order. */
export const ROADMAP_STATUSES = ['idea', 'planned', 'in_progress', 'shipped'] as const;
export type RoadmapStatus = (typeof ROADMAP_STATUSES)[number];

/** Effort sizing — XS through L.  Optional on every item. */
export const ROADMAP_EFFORTS = ['xs', 's', 'm', 'l'] as const;
export type RoadmapEffort = (typeof ROADMAP_EFFORTS)[number];

/** Design pillars from CLAUDE.md.  Optional tie-back so vision drift is visible. */
export const ROADMAP_PILLARS = [
  'architect',
  'fan-driven',
  'emergent-narrative',
  'modular',
] as const;
export type RoadmapPillar = (typeof ROADMAP_PILLARS)[number];

// ── Narrowed item (post-Zod) ────────────────────────────────────────────────

/**
 * A `RoadmapItemRow` after passing through the Zod schema in `api/items.ts`.
 * `status` / `effort` / `pillar` are narrowed from `string` to their
 * respective unions, so feature code can switch over them exhaustively.
 */
export interface RoadmapItem extends Omit<RoadmapItemRow, 'status' | 'effort' | 'pillar'> {
  status: RoadmapStatus;
  effort: RoadmapEffort | null;
  pillar: RoadmapPillar | null;
}

// ── Human-readable labels ──────────────────────────────────────────────────
// Used by the column header and the editor modal.  Centralised here so a
// future rename ("Shipped" → "Released") stays one-shot.

export const STATUS_LABELS: Record<RoadmapStatus, string> = {
  idea: 'Ideas',
  planned: 'Planned',
  in_progress: 'In Progress',
  shipped: 'Shipped',
};

export const EFFORT_LABELS: Record<RoadmapEffort, string> = {
  xs: 'XS',
  s: 'S',
  m: 'M',
  l: 'L',
};

export const PILLAR_LABELS: Record<RoadmapPillar, string> = {
  architect: 'Architect',
  'fan-driven': 'Fan-Driven',
  'emergent-narrative': 'Emergent Narrative',
  modular: 'Modular',
};
