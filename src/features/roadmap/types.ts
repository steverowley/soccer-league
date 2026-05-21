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

// ── Unified board item (bd snapshot + Supabase merge) ──────────────────────
// The roadmap board renders cards sourced from two places:
//
//   1. `roadmap_items` in Supabase  — curator-authored ideas with full
//      admin chrome (create / edit / move / delete).
//   2. `.beads/issues.jsonl` snapshot — read-only mirror of the bd issue
//      tracker, fetched at runtime from `public/bd-snapshot.json`.
//
// A discriminated union with a `kind` tag lets the board iterate one flat
// stream while the card component branches its rendering and the action
// chrome.  Each variant carries enough on its own to fully render and
// sort within its column — `priority`, `status`, `id`, `title` are
// hoisted to the outer shape so the column-grouping logic doesn't need
// to peek into the inner payload.

import type { BdIssue } from './api/bdSnapshot';

/** Base fields shared by every card on the board, regardless of source. */
export interface BoardItemCommon {
  /** Stable identifier — `roadmap_items.id` (uuid) or bd id (e.g. 'isl-du4'). */
  id: string;
  /** Display title — short single-line label. */
  title: string;
  /** Kanban column membership after status mapping. */
  status: RoadmapStatus;
  /** Sortable priority within column.  Lower = higher priority. */
  priority: number;
  /** ISO-8601 timestamp used to break priority ties (oldest first). */
  created_at: string;
  /** ISO-8601 timestamp surfaced as "updated <ago>" on the card. */
  updated_at: string;
}

/** Supabase-sourced board item.  Admin chrome lights up for this variant. */
export interface SupabaseBoardItem extends BoardItemCommon {
  kind: 'supabase';
  /** The full validated row.  Admin actions need the rest of the columns. */
  item: RoadmapItem;
}

/** bd-sourced board item.  Read-only — no admin chrome, no DB write path. */
export interface BdBoardItem extends BoardItemCommon {
  kind: 'bd';
  /** The trimmed bd issue.  Used to render the bd badge + close reason. */
  issue: BdIssue;
}

/**
 * Discriminated union of every card the board can render.  The `kind`
 * tag drives card chrome, while the hoisted common fields drive sort and
 * grouping.
 */
export type BoardItem = SupabaseBoardItem | BdBoardItem;
