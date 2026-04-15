// ── ArchitectLog.jsx ────────────────────────────────────────────────────────
// Route wrapper for the dev-only Architect intervention audit log at
// /architect-log.
//
// WHY gated behind import.meta.env.DEV: the audit table contains internal
// game mechanics (old/new snapshots, rewrite reasons) that the design
// principle "hidden mechanics" explicitly forbids exposing to players. In
// production builds Vite tree-shakes the entire page because the DEV
// constant is false — the route never appears in the prod bundle.
//
// In development the page is accessible so engineers can verify:
//   1. Every Architect rewrite produced an audit row.
//   2. Compensating ROLLBACK NOTICE rows appear on mutation failures.
//   3. Reason strings are meaningful and at least MIN_REASON_LENGTH.

import { ArchitectLogPage } from '../features/architect';

/**
 * /architect-log route wrapper (DEV only).
 *
 * Renders a hard "not available in production" notice in non-dev builds
 * rather than a blank page, so if the route is accidentally left in the
 * router in prod the user sees a clear message rather than an error.
 *
 * In dev, renders {@link ArchitectLogPage} inside the standard container.
 *
 * @returns {JSX.Element}
 */
export default function ArchitectLog() {
  // ── Production gate ────────────────────────────────────────────────────
  // import.meta.env.DEV is replaced by Vite at build time with a boolean
  // literal, so the `if` branch (and this entire module) is dead-code-
  // eliminated from production bundles.
  if (!import.meta.env.DEV) {
    return (
      <div className="container" style={{ paddingTop: '40px' }}>
        <p style={{ opacity: 0.6 }}>This page is not available in production.</p>
      </div>
    );
  }

  return (
    <div className="container" style={{ paddingTop: '40px', paddingBottom: '80px' }}>
      <ArchitectLogPage />
    </div>
  );
}
