// ── feature: roadmap ───────────────────────────────────────────────────────
// WHY: The team kept losing product/design ideas across chats, Notion,
// and the `bd` engineering tracker.  The /roadmap page gives a single
// visual home for raw ideas → planned work → in-flight work → shipped
// items.  Admin-write / public-read; complements (does not replace) `bd`
// for engineering issues.
//
// Tables (added in migration 0034):
//   - roadmap_items (admin-write, public-read)
//
// Cross-feature wiring:
//   - Consumes useAuth() to gate write controls on `profile.is_admin`.
//   - Does NOT emit or subscribe to bus events — it's a presentational
//     CRUD feature.  Add an event later if some other feature needs to
//     react to roadmap state.
//
// Public API surface follows the feature-barrel pattern: types →
// logic → api → ui.  Deep imports (`@features/roadmap/api/items`) are
// forbidden by ESLint's `no-restricted-imports` rule.

// ── Types ──────────────────────────────────────────────────────────────────
export type {
  RoadmapItem,
  RoadmapItemRow,
  RoadmapItemInsert,
  RoadmapItemUpdate,
  RoadmapStatus,
  RoadmapEffort,
  RoadmapPillar,
  BoardItem,
  SupabaseBoardItem,
  BdBoardItem,
  BoardItemCommon,
} from './types';

export {
  ROADMAP_STATUSES,
  ROADMAP_EFFORTS,
  ROADMAP_PILLARS,
  STATUS_LABELS,
  EFFORT_LABELS,
  PILLAR_LABELS,
} from './types';

// ── Logic (pure TS, no React / no Supabase) ────────────────────────────────
export {
  sortByPriority,
  sortBoardItemsByPriority,
  groupByStatus,
  groupBoardItemsByStatus,
  reprioritizeNeighbours,
  priorityBucket,
} from './logic/priorityOrder';
export type { PrioritySwap, PriorityBucket } from './logic/priorityOrder';

// ── Logic — bd ↔ kanban translation ────────────────────────────────────────
// Pure mappers from bd status / priority into the dashboard's vocabulary.
// Exported so future tooling (e.g. an admin "import from bd" button) can
// reuse the same translations without re-encoding the table.
export { mapBdStatus, mapBdPriority } from './logic/bdMapping';

// ── Logic — Architect Roulette (issue isl-aak) ─────────────────────────────
// Weighted-random pick from the Ideas column for the chaos-director-themed
// "let the cosmos decide" button on the roadmap board.
export { pickArchitectIdea } from './logic/architectRoulette';

// ── API (Supabase queries, injected client, Zod-validated) ─────────────────
export {
  listItems,
  createItem,
  updateItem,
  deleteItem,
  swapPriority,
} from './api/items';
export type { CreateItemInput } from './api/items';

// ── API — bd issues (Supabase mirror + Realtime, Zod-validated) ────────────
// Read-only mirror of bd issues populated by the bd-sync GitHub Action
// (`scripts/sync-bd-to-supabase.mjs`).  The board subscribes via
// Supabase Realtime so closing / creating bd issues shows up live.
export {
  listBdIssues,
  getBdSyncedAt,
  subscribeToBdIssues,
} from './api/bdIssues';
export type { BdIssue } from './api/bdIssues';

// ── UI (React components) ─────────────────────────────────────────────────
// `RoadmapBoard` is the only component the page wrapper mounts directly;
// `RoadmapColumn` / `RoadmapCard` / `ItemEditorModal` are internal to the
// feature and not re-exported to keep the public surface small.
export { RoadmapBoard } from './ui/RoadmapBoard';

// ── UI — Quick Capture FAB (issue isl-aal) ─────────────────────────────────
// Admin-only floating action button mounted once at the app root.  Opens
// a one-line capture modal that inserts a row into the Ideas column
// without navigating away from the current page.  Renders null for
// non-admins so it's safe to mount unconditionally.
export { QuickCaptureFAB } from './ui/QuickCaptureFAB';
