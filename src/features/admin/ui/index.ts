// ── features/admin/ui/index.ts ───────────────────────────────────────────────
// Barrel for the admin dashboard subcomponents.  `src/pages/Admin.tsx`
// imports from here so the page file stays free of deep `ui/<file>` paths
// and so future panel additions / renames are a single-file edit.
//
// CONTENTS
//   - The named panels referenced from `/admin`:
//       AdminAccessGate, OverviewPanel, SeasonControlsPanel,
//       FixtureBrowser,  TestingPanel, ArchitectInterventionLog.
//   - The shell pieces (tab strip, tab parsing).
//
// The panels are built from the design system (src/shared/design tokens and
// src/shared/ui components). The admin-only look-alikes that used to live
// in `primitives.tsx` (PanelHeader, StatCell, AdminButton, FilterChip,
// ActionToast, Skeleton, the colour constants and style objects) were
// deleted in the design system's last group: SectionHeader, StatBlock,
// Button, Tag, the global toast, the shared Skeleton and the tokens replace
// them one for one.

// ── Panels ───────────────────────────────────────────────────────────────────
export { AdminAccessGate }              from './AdminAccessGate';
export { OverviewPanel }                from './SystemStatsCard';
export { SeasonControlsPanel }          from './SeasonControlsPanel';
export { FixtureBrowser }               from './FixtureBrowser';
export { TestingPanel }                 from './TestingPanel';
export { ArchitectInterventionLog }     from './ArchitectInterventionLog';

// ── Shell pieces (consumed by pages/Admin.tsx) ───────────────────────────────
export {
  AdminTabStrip,
  ADMIN_TABS,
  DEFAULT_ADMIN_TAB,
  parseAdminTab,
} from './AdminTabStrip';
export type { AdminTab }                from './AdminTabStrip';
