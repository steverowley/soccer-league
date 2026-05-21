// ── Roadmap.tsx ─────────────────────────────────────────────────────────────
// `/roadmap` route — visual project-management dashboard for the team.
//
// WHO CAN SEE THIS
//   Access is gated client-side by the `profiles.is_admin` column (migration
//   0032).  Non-admin authenticated users and anonymous visitors both see a
//   generic "Access Denied" surface — the same pattern as Admin.tsx and
//   WhatIf.tsx.  The page also lives behind the admin tabbed nav inside
//   `/admin?tab=roadmap`, which is the intended entry point.  The
//   stand-alone `/roadmap` URL is preserved (a) so existing bookmarks /
//   chat links don't 404, and (b) so admins can deep-link straight to the
//   board without going through the admin overview first.
//
// WHY GATED:
//   The roadmap board exposes internal product planning — bd issues,
//   curator-authored cards, live Claude session activity.  We don't want
//   non-admin players reading the next-features list before they ship; on-
//   brand for the Blaseball-style "watch the experiment, don't see the
//   wiring" framing.
//
// LAYOUT:
//   Header (global) → SectionHeader intro → RoadmapBoard → Footer.

import Header from '../components/Header';
import { COLORS, Container, Footer, SectionHeader } from '../components/Layout';
import { RoadmapBoard } from '../features/roadmap';
import { useAuth } from '../features/auth';
import { Link } from 'react-router-dom';

// ── Shared inline styles ────────────────────────────────────────────────────
// Duplicated from Admin.tsx so the Access Denied surface is byte-identical
// across the two admin-gated pages.  Extracting into a shared component is
// a worthy follow-up, but the duplication is small and the boundary is
// clearer when each page owns its own gate.

/** Uppercase mono label — matches Admin.tsx's `LABEL_STYLE`. */
const LABEL_STYLE: React.CSSProperties = {
  fontFamily: 'Space Mono, monospace',
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.14em',
  color: COLORS.dust50,
};

/** Body-copy mono — matches Admin.tsx's `VALUE_STYLE`. */
const VALUE_STYLE: React.CSSProperties = {
  fontFamily: 'Space Mono, monospace',
  fontSize: 13,
  fontWeight: 400,
  color: COLORS.dust,
};

/**
 * Render the /roadmap page with an admin-only auth gate.  Authenticated
 * non-admins and anonymous visitors both see the same "Access Denied"
 * surface so we leak no information about the gating mechanism.  Admin
 * visitors get the full Header + intro + RoadmapBoard tree.
 *
 * @returns The page tree (either the access-denied surface or the
 *          authenticated board).
 */
export default function Roadmap() {
  const { profile, loading: authLoading } = useAuth();

  // ── Auth resolving ───────────────────────────────────────────────────────
  // While auth is in-flight we render an unobtrusive "Authenticating…" stub
  // rather than the Access Denied surface, so a legitimate admin whose
  // session token is still loading doesn't get a flash of the denial copy.
  if (authLoading) {
    return (
      <div style={{ background: COLORS.abyss, minHeight: '100vh', color: COLORS.dust }}>
        <Header />
        <main>
          <Container>
            <p style={{ ...VALUE_STYLE, padding: '80px 0', textAlign: 'center', color: COLORS.dust50 }}>
              Authenticating…
            </p>
          </Container>
        </main>
        <Footer />
      </div>
    );
  }

  // ── Non-admin gate ───────────────────────────────────────────────────────
  // Anonymous viewers (`profile === null`) and authenticated non-admins
  // both land here.  Copy intentionally vague about the gating mechanism
  // so an attacker has nothing to target.
  if (profile?.is_admin !== true) {
    return (
      <div style={{ background: COLORS.abyss, minHeight: '100vh', color: COLORS.dust }}>
        <Header />
        <main>
          <Container>
            <div style={{ padding: '80px 0', textAlign: 'center' }}>
              <p style={{ ...LABEL_STYLE, color: COLORS.flare, marginBottom: 12 }}>
                Access Denied
              </p>
              <p style={{ ...VALUE_STYLE, color: COLORS.dust50, marginBottom: 24 }}>
                This surface is restricted to league administrators.
              </p>
              <Link
                to="/"
                style={{ ...LABEL_STYLE, color: COLORS.quantum, textDecoration: 'none' }}
              >
                Return Home
              </Link>
            </div>
          </Container>
        </main>
        <Footer />
      </div>
    );
  }

  // ── Admin: full board ────────────────────────────────────────────────────
  return (
    <div style={{ background: COLORS.abyss, minHeight: '100vh', color: COLORS.dust }}>
      <Header />
      <main>
        <Container>
          <section style={{ padding: '32px 0' }}>
            <SectionHeader
              pageKicker="ROADMAP"
              kicker="0"
              label="THE NEXT FRONTIER"
              title="What's brewing in the league"
              subtitle="A curator-tended board of ideas, planned work, and shipped milestones. New ideas land in the leftmost column; the team moves cards right as work progresses. Admin-only view — also reachable from the Admin dashboard's Roadmap tab."
            />
          </section>

          <section style={{ padding: '8px 0 48px' }}>
            <RoadmapBoard />
          </section>
        </Container>
      </main>
      <Footer />
    </div>
  );
}
