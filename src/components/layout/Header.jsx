// ── Header.jsx ────────────────────────────────────────────────────────────────
// Site-wide navigation header implementing the ISL design system spec:
//
//  Desktop (≥768px):
//    ISL logo (left, vertically centred)  |  nav links (right, vertically centred)
//    A full-width horizontal rule sits below the header row.
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
 * depending on viewport width via CSS media queries.  Logo and nav links
 * are vertically centred on the same row, separated by a bottom divider.
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
      {/* ── Inner wrapper ─────────────────────────────────────────────────────── */}
      {/* padding: '8px var(--space-8)' — 8px top/bottom centres the 40px logo
          and 13px nav text in a ~56px strip; horizontal padding defers to the
          shared --space-8 (32px) container token so the header gutters match
          every other page section. */}
      <div
        className="container"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px var(--space-8)',
        }}
      >
        {/* ── Logo ─────────────────────────────────────────────────────────── */}
        {/* width: 40px — sized to sit comfortably inline with the nav links
            at the header's 8px top/bottom padding (total strip ≈ 56px).
            height: auto preserves the PNG's aspect ratio. */}
        <Link to="/" style={{ display: 'block', flexShrink: 0 }}>
          <img
            src={`${import.meta.env.BASE_URL}isl-logo.png`}
            alt="Intergalactic Soccer League"
            style={{ width: 40, height: 'auto', display: 'block' }}
          />
        </Link>

        {/* ── Desktop navigation ───────────────────────────────────────────── */}
        {/* gap: 32px — matches --space-8 from the design token scale, giving
            each nav item enough breathing room without crowding at 1312px max
            width. alignItems: center keeps link text baseline-aligned with the
            logo when font metrics differ slightly across browsers. */}
        <nav
          className="desktop-nav"
          style={{ display: 'flex', gap: '32px', alignItems: 'center' }}
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
        {/* padding: 6px — tight hit-area around the 18px icon keeps the button
            compact in the narrow mobile header strip.
            border opacity 0.3 — subtle outline consistent with other ghost
            controls in the design system without overpowering the icon.
            display: none — hidden by default; the media query below overrides
            this to 'flex' at <768px so the icon stays vertically centred. */}
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
            display: 'none',
          }}
        >
          {mobileOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {/* ── Full-width horizontal divider ────────────────────────────────────── */}
      {/* opacity 0.2 — same translucency used by all ISL horizontal rules so
          the line reads as a subtle separator without creating visual weight. */}
      <div style={{ borderTop: '1px solid rgba(227,224,213,0.2)' }} />

      {/* ── Mobile navigation drawer ─────────────────────────────────────────── */}
      {/* Only rendered in the DOM when open to avoid focus-trap issues.
          padding: '16px 24px' — 16px top/bottom for comfortable touch targets;
          24px sides aligns the links with the logo above (logo left edge sits
          at 32px container padding, 24px here is intentionally slightly inset).
          gap: 16px — --space-4 between each stacked link, matching the card
          inner spacing used elsewhere in the design system. */}
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
