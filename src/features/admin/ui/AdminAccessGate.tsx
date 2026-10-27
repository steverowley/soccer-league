// ── features/admin/ui/AdminAccessGate.tsx ────────────────────────────────────
// Auth-gating shell rendered around the entire /admin surface.
//
// WHO CAN SEE THE INNER PANELS
//   Access is gated client-side by the `profiles.is_admin` column (server-side
//   flag added in migration 0032 + RLS-protected so a user can only ever read
//   their own flag).  Non-admin authenticated users and anonymous visitors
//   both see the same generic "Access Denied" surface — no information about
//   who is an admin is surfaced to the browser.  The actual security
//   boundary is the RPC-side check inside `admin_reset_season()` (also from
//   0032), which raises SQLSTATE 28000 (HTTP 403) for any non-admin caller.
//   This gate is therefore a dev-convenience tool, not a hardened admin
//   panel — the server-side check is what actually protects destructive ops.
//
// WHY EXTRACTED
//   The previous Admin.tsx in-lined three branches (loading / denied / OK)
//   plus their wrappers.  Pulling the gate out shrinks the page wrapper to a
//   thin shell and lets the test surface for the gate evolve independently.

import type { ReactNode } from 'react';
import { useAuth } from '../../auth';
import { PageHeader, PageShell } from '../../../shared/ui';

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Render `children` when the active user is an admin; otherwise render an
 * "Authenticating" page header while the session token is loading, or an
 * "Access Denied" surface for non-admin / anonymous visitors.
 *
 * The denial copy intentionally reveals nothing about the gating mechanism —
 * no mention of a column, RPC, or env var that could give an attacker
 * something to target.
 *
 * The loading placeholder exists so a legitimate admin whose session is still
 * resolving never sees a flash of the denial surface.
 *
 * @param children  The admin dashboard body — only rendered for admins.
 * @returns         Either the children (admin path) or a wrapped placeholder.
 */
export function AdminAccessGate({ children }: { children: ReactNode }) {
  const { profile, loading: authLoading } = useAuth();

  // ── Branch 1: auth still resolving ─────────────────────────────────────────
  // Render a minimal placeholder rather than the denial surface so a
  // legitimate admin does not see a "wrong" frame for the ~1 frame their
  // session token takes to hydrate. Like every state, it opens with the
  // shared PageHeader, so it renders exactly one h1.
  if (authLoading) {
    return (
      <PageShell>
        <PageHeader eyebrow="Admin" title="Authenticating" />
      </PageShell>
    );
  }

  // ── Branch 2: not an admin (anon or signed-in non-admin) ──────────────────
  // Treat anonymous (profile === null) and non-admin signed-in users
  // identically (same copy, same way home) to avoid leaking whether any
  // particular UID is an admin.
  if (profile?.is_admin !== true) {
    return (
      <PageShell>
        <PageHeader
          eyebrow="Admin"
          title="Access Denied"
          back={{ to: '/', label: 'Return home' }}
          subtitle="This surface is restricted to league administrators."
        />
      </PageShell>
    );
  }

  // ── Branch 3: admin — render the dashboard body ────────────────────────────
  return <>{children}</>;
}
