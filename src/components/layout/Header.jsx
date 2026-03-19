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
      {/* align-items: flex-start so the logo can use a negative marginBottom to
          overhang the divider below, while the nav links sit flush to the top
          of the strip with a small paddingTop for visual balance.
          The logo drives the strip height via its effective height (actual height
          minus the negative margin); the divider appears at the strip's bottom. */}
      <div
        className="container"
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          padding: '12px var(--space-8)',
        }}
      >
        {/* ── Logo ─────────────────────────────────────────────────────────── */}
        {/* width: 100px desktop / 60px mobile (overridden in responsive CSS).
            marginBottom: -60px — pulls the logo's layout contribution up by 60px
            so the flex strip ends at the divider while the image itself continues
            to render below it (the shield overhangs into the page content area).
            position: relative + zIndex: 1 ensure it renders above page content
            in the overhang zone without creating a new stacking context issue. */}
        <Link to="/" style={{ display: 'block', flexShrink: 0, position: 'relative', zIndex: 1 }}>
          <img
            src={`${import.meta.env.BASE_URL}isl-logo.png`}
            alt="Intergalactic Soccer League"
            className="header-logo"
            style={{ width: 100, height: 'auto', display: 'block', marginBottom: '-60px' }}
          />
        </Link>

        {/* ── Desktop navigation ───────────────────────────────────────────── */}
        {/* gap: 32px — matches --space-8 token; gives each link room without
            crowding at the 1312px max-width.
            paddingTop: 10px — with alignItems: flex-start on the parent, nudges
            the links down so they sit visually centred in the ~50px strip. */}
        <nav
          className="desktop-nav"
          style={{ display: 'flex', gap: '32px', alignItems: 'center', paddingTop: '10px' }}
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
        {/* marginTop: 10px — mirrors the nav paddingTop so the hamburger icon
            sits at the same vertical position as the nav links on desktop. */}
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
            marginTop: '10px',
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
      {/* .header-logo mobile override: 60px wide with -30px bottom margin keeps
          the same overhang-below-divider behaviour at mobile proportions.
          The 100px desktop size would be too dominant on a 380px mobile layout. */}
      <style>{`
        @media (max-width: 767px) {
          .desktop-nav     { display: none !important; }
          .mobile-menu-btn { display: flex !important; }
          .header-logo     { width: 60px !important; margin-bottom: -30px !important; }
        }
        @media (min-width: 768px) {
          .mobile-menu-btn { display: none !important; }
        }
      `}</style>
    </header>
  );
}
