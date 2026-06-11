// ── feature: admin ──────────────────────────────────────────────────────────
// WHY: Out-of-band testing controls so a maintainer can drive the playable-
// state loop end-to-end on dev databases without waiting for production
// cadences (1 day per match → 224 days for a full season).
//
// IMPORTANT — this feature is dev/maintainer-facing only.  The actual
// security boundary is the server-side `admin_reset_season()` RPC (migration
// 0032), which rejects non-admin callers with HTTP 403 by inspecting the
// `profiles.is_admin` flag of `auth.uid()`.  The client-side UI gate (see
// Profile.tsx / Admin.tsx) reads the same flag, which is RLS-protected to
// the owning user, so an attacker can never read another user's admin
// status.  Every action exposed here can additionally be reproduced by
// hand against the database with service-role credentials.
//
// COMPOSITION:
//   - api/    — Supabase mutations for the admin actions (fast-forward,
//               manual enactment).
//   - ui/     — the route-level AdminPage component.
//
// CROSS-FEATURE WIRING:
//   - api/admin.ts dynamically imports `enactSeasonFocuses` from the voting
//     feature so the admin feature isn't a static load-time dependency.
//
// STATUS: Package 14 — initial scaffold + tests.

// ── API (Supabase) ───────────────────────────────────────────────────────────
export {
  getActiveSeason,
  getAdminFixtures,
  getArchitectInterventions,
  fastForwardScheduledMatches,
  triggerSeasonEnactment,
  // Phase B additions — system stats, season controls, testing tools
  getSystemStats,
  setSeasonStatus,
  resetSeasonResults,
  injectNarrative,
  addPlayer,
  getTeamList,
  // Manual completion path used by the Fixture Browser's per-row "Complete"
  // affordance.  Emits `match.completed` so the standard listeners fire.
  completeMatchManually,
} from './api/admin';
export type {
  AdminSeason,
  AdminFixture,
  ArchitectIntervention,
  FastForwardResult,
  TriggerEnactmentResult,
  // Phase B additions
  SystemStats,
  AddPlayerInput,
  CompleteMatchManuallyResult,
} from './api/admin';

// ── UI ───────────────────────────────────────────────────────────────────────
// Panel subcomponents live under `ui/` and are composed by `pages/Admin.tsx`
// into the full dashboard.  Re-exported here so cross-feature callers
// (currently none — the panels are only used by the route file) can import
// from `@features/admin` without reaching into the deep `ui/<file>` paths.
export {
  AdminAccessGate,
  OverviewPanel,
  SeasonControlsPanel,
  FixtureBrowser,
  TestingPanel,
  ArchitectInterventionLog,
} from './ui';
