// ── feature: admin ──────────────────────────────────────────────────────────
// WHY: Out-of-band testing controls so a maintainer can drive the playable-
// state loop end-to-end on dev databases without waiting for production
// cadences (1 day per match → 224 days for a full season).
//
// IMPORTANT — this feature is dev/maintainer-facing only.  Server-side RLS
// is the actual security boundary; the UI gate via VITE_ADMIN_USER_IDS is
// purely usability.  Every action exposed here can be reproduced by hand
// against the database with service-role credentials, which is the
// underlying access model.
//
// COMPOSITION:
//   - logic/  — pure allowlist parsing + membership predicate (testable
//               without a DOM or Supabase client).
//   - api/    — Supabase mutations for the admin actions (fast-forward,
//               manual enactment).
//   - ui/     — the route-level AdminPage component.
//
// CROSS-FEATURE WIRING:
//   - api/admin.ts dynamically imports `enactSeasonFocuses` from the voting
//     feature so the admin feature isn't a static load-time dependency.
//
// STATUS: Package 14 — initial scaffold + tests.

// ── Logic (pure) ─────────────────────────────────────────────────────────────
export {
  parseAllowlist,
  isAdminUser,
} from './logic/allowlist';
export type { AdminAllowlist } from './logic/allowlist';

// ── API (Supabase) ───────────────────────────────────────────────────────────
export {
  fastForwardScheduledMatches,
  triggerSeasonEnactment,
} from './api/admin';
export type {
  FastForwardResult,
  TriggerEnactmentResult,
} from './api/admin';

// ── UI ───────────────────────────────────────────────────────────────────────
export { AdminPage } from './ui/AdminPage';
