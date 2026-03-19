// ── Header.jsx ────────────────────────────────────────────────────────────────
// Site-wide navigation header implementing the ISL design system spec:
//
//  Desktop (≥768px):
//    ISL logo (left, overlapping the bottom rule)  |  nav links (right, inline)
//    A full-width horizontal rule separates the logo from the page content.
//
//  Mobile (<768px):
//    ISL logo (left)  |  hamburger menu icon (right)
//    The hamburger toggles a full-width vertical nav drawer below the rule.
//
// Active link detection uses React Router's useLocation so the current page
// is always highlighted with the Quantum Purple accent colour.

import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';

// ── Navigation link definitions ───────────────────────────────────────────────
// Ordered as they appear left-to-right in the design mockup.
// Each entry maps a display label to its route path.
const NAV_LINKS = [
  { label: 'Home',    to: '/' },
  { label: 'Leagues', to: '/leagues' },
  { label: 'Teams',   to: '/teams' },
  { label: 'Players', to: '/players' },
  { label: 'Matches', to: '/matches' },
  { label: 'Log In',  to: '/login' },
];

/**
 * Site-wide header with ISL logo and primary navigation.
 *
 * Renders a desktop (horizontal) or mobile (hamburger drawer) layout
 * depending on viewport width via CSS media queries.  The logo overhangs
 * the bottom divider line by design — matching the Figma mockup where the
 * shield crest visually crosses the horizontal rule.
 *
 * @returns {JSX.Element}
 */
export default function Header() {
  // Controls the mobile drawer open/closed state.
  // Closes automatically when the user navigates to a new page (via the
  // NavLink onClick handler) so they are never left with an open drawer.
  const [mobileOpen, setMobileOpen] = useState(false);

  const location = useLocation();

  /**
   * Determines whether a given nav link should be styled as active.
   * Exact match is used for '/' (Home) to prevent every route matching it.
   * Prefix match is used for all other routes (e.g. /leagues/rocky-inner
   * still highlights the Leagues nav item).
   *
   * @param {string} to - The link's target path
   * @returns {boolean}
   */
  const isActive = (to) => {
    if (to === '/') return location.pathname === '/';
    return location.pathname.startsWith(to);
  };

  return (
    <header style={{ backgroundColor: 'var(--color-abyss)', position: 'relative', zIndex: 10 }}>
      {/* ── Inner wrapper — max-width container with logo + nav ──────────────── */}
      <div
        className="container"
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          paddingTop: '8px',
          paddingBottom: '0',
          position: 'relative',
        }}
      >
        {/* ── Logo ─────────────────────────────────────────────────────────── */}
        {/* The logo is deliberately oversized relative to the header line so
            the shield crest overlaps the divider — matching the design spec. */}
        <Link to="/" style={{ display: 'block', flexShrink: 0 }}>
          <img
            src="/isl-logo.svg"
            alt="Intergalactic Soccer League"
            style={{ width: 72, height: 'auto', display: 'block', marginBottom: '-12px' }}
          />
        </Link>

        {/* ── Desktop navigation ───────────────────────────────────────────── */}
        <nav
          className="desktop-nav"
          style={{ display: 'flex', gap: '32px', alignItems: 'center', paddingBottom: '14px' }}
        >
          {NAV_LINKS.map(({ label, to }) => (
            <Link
              key={to}
              to={to}
              className={`nav-link${isActive(to) ? ' active' : ''}`}
            >
              {label}
            </Link>
          ))}
        </nav>

        {/* ── Mobile hamburger button ──────────────────────────────────────── */}
        <button
          className="mobile-menu-btn"
          onClick={() => setMobileOpen(prev => !prev)}
          aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
          style={{
            background: 'none',
            border: '1px solid rgba(227,224,213,0.3)',
            color: 'var(--color-dust)',
            cursor: 'pointer',
            padding: '6px',
            display: 'none', // shown via CSS at mobile breakpoint
            marginBottom: '12px',
          }}
        >
          {mobileOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {/* ── Full-width horizontal divider ────────────────────────────────────── */}
      {/* This rule appears in both desktop and mobile layouts; on desktop
          the logo overlaps it from above. */}
      <div style={{ borderTop: '1px solid rgba(227,224,213,0.2)' }} />

      {/* ── Mobile navigation drawer ─────────────────────────────────────────── */}
      {/* Only rendered in the DOM when open to avoid focus-trap issues. */}
      {mobileOpen && (
        <nav
          style={{
            backgroundColor: 'var(--color-abyss)',
            borderBottom: '1px solid rgba(227,224,213,0.2)',
            padding: '16px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          {NAV_LINKS.map(({ label, to }) => (
            <Link
              key={to}
              to={to}
              className={`nav-link${isActive(to) ? ' active' : ''}`}
              onClick={() => setMobileOpen(false)}
            >
              {label}
            </Link>
          ))}
        </nav>
      )}

      {/* ── Responsive CSS ───────────────────────────────────────────────────── */}
      <style>{`
        @media (max-width: 767px) {
          .desktop-nav  { display: none !important; }
          .mobile-menu-btn { display: flex !important; }
        }
        @media (min-width: 768px) {
          .mobile-menu-btn { display: none !important; }
        }
      `}</style>
    </header>
  );
}
