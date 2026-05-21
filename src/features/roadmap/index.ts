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
  groupByStatus,
  reprioritizeNeighbours,
  priorityBucket,
} from './logic/priorityOrder';
export type { PrioritySwap, PriorityBucket } from './logic/priorityOrder';

// ── API (Supabase queries, injected client, Zod-validated) ─────────────────
export {
  listItems,
  createItem,
  updateItem,
  deleteItem,
  swapPriority,
} from './api/items';
export type { CreateItemInput } from './api/items';

// ── UI (React components) ─────────────────────────────────────────────────
// `RoadmapBoard` is the only component the page wrapper mounts directly;
// `RoadmapColumn` / `RoadmapCard` / `ItemEditorModal` are internal to the
// feature and not re-exported to keep the public surface small.
export { RoadmapBoard } from './ui/RoadmapBoard';
