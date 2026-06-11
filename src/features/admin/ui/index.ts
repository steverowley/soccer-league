// ── features/admin/ui/index.ts ───────────────────────────────────────────────
// Barrel for the admin dashboard subcomponents.  `src/pages/Admin.tsx`
// imports from here so the page file stays free of deep `ui/<file>` paths
// and so future panel additions / renames are a single-file edit.
//
// CONTENTS
//   - The five named panels referenced from `/admin`:
//       AdminAccessGate, OverviewPanel, SeasonControlsPanel,
//       FixtureBrowser,  TestingPanel, ArchitectInterventionLog.
//   - The shared design tokens + small presentational primitives from
//     `primitives.tsx` (PanelHeader, button + colour constants, etc.).
//     Re-exporting them here means panel callers — and the Admin page
//     shell itself — only need a single import path.

// ── Panels ───────────────────────────────────────────────────────────────────
export { AdminAccessGate }              from './AdminAccessGate';
export { OverviewPanel }                from './SystemStatsCard';
export { SeasonControlsPanel }          from './SeasonControlsPanel';
export { FixtureBrowser }               from './FixtureBrowser';
export { TestingPanel }                 from './TestingPanel';
export { ArchitectInterventionLog }     from './ArchitectInterventionLog';

// ── Shell pieces (consumed by pages/Admin.tsx) ───────────────────────────────
export { AdminPageHero }                from './AdminPageHero';
export {
  AdminTabStrip,
  ADMIN_TABS,
  DEFAULT_ADMIN_TAB,
  parseAdminTab,
} from './AdminTabStrip';
export type { AdminTab }                from './AdminTabStrip';

// ── Primitives (re-exported for the Admin.tsx shell) ─────────────────────────
export {
  // Components
  PanelHeader,
  StatCell,
  AdminButton,
  FilterChip,
  ActionToast,
  Skeleton,
  // Style constants
  LABEL_STYLE,
  VALUE_STYLE,
  adminSelectStyle,
  adminInputStyle,
  // Colour tokens
  DUST,
  DUST_50,
  DUST_70,
  DUST_FAINT,
  ABYSS,
  HAIRLINE,
  QUANTUM,
  FLARE,
  TERRA,
  PHOBOS,
  // Helpers + hooks
  fmtDatetime,
  useAutoDismissToast,
} from './primitives';

export type { Toast, ToastKind, AdminButtonVariant } from './primitives';
