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
import { Link } from 'react-router-dom';
import Header from '../../../components/Header';
import { Container, Footer } from '../../../components/Layout';
import { useAuth } from '../../auth';
import {
  DUST_50, FLARE, QUANTUM,
  LABEL_STYLE, VALUE_STYLE,
} from './primitives';

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Render `children` when the active user is an admin; otherwise render an
 * "Authenticating…" placeholder while the session token is loading, or an
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
  // session token takes to hydrate.
  if (authLoading) {
    return (
      <>
        <Header />
        <main>
          <Container>
            <p style={{ ...VALUE_STYLE, padding: '80px 0', textAlign: 'center', color: DUST_50 }}>
              Authenticating…
            </p>
          </Container>
        </main>
        <Footer />
      </>
    );
  }

  // ── Branch 2: not an admin (anon or signed-in non-admin) ──────────────────
  // Treat anonymous (profile === null) and non-admin signed-in users
  // identically — same copy, same CTA — to avoid leaking whether any
  // particular UID is an admin.
  if (profile?.is_admin !== true) {
    return (
      <>
        <Header />
        <main>
          <Container>
            <div style={{ padding: '80px 0', textAlign: 'center' }}>
              <p style={{ ...LABEL_STYLE, color: FLARE, marginBottom: 12 }}>Access Denied</p>
              <p style={{ ...VALUE_STYLE, color: DUST_50, marginBottom: 24 }}>
                This surface is restricted to league administrators.
              </p>
              <Link to="/" style={{ ...LABEL_STYLE, color: QUANTUM, textDecoration: 'none' }}>
                Return Home
              </Link>
            </div>
          </Container>
        </main>
        <Footer />
      </>
    );
  }

  // ── Branch 3: admin — render the dashboard body ────────────────────────────
  return <>{children}</>;
}
