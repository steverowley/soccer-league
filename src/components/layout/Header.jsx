// ── Header.jsx ────────────────────────────────────────────────────────────────
// Site-wide navigation header — Redesign 2026-05.
//
// New three-zone layout (matches the redesign Figma):
//
//   [logo]                  [home leagues teams matches galaxy …]      [Create Account]
//
// Logo on the far left, primary nav clustered to the right of the logo with
// generous tracking, and a Solar Flare CTA button at the far right (replaced
// by AccountMenu when authenticated).  A single hairline divider sits below
// the strip — there is no overhang behaviour on the logo any more (the
// previous design had the shield bleeding past the divider; the new one
// keeps everything inside the strip).
//
// Mobile (<768 px) collapses the nav into a hamburger drawer.
//
// CHANGES from the previous Header:
//   - Logo no longer overhangs the divider (cleaner, matches new spec).
//   - Right-side CTA is now a Solar Flare button rather than a "Log In"
//     text link — the design treats authentication as the primary call
//     to action for new visitors.
//   - Galaxy Dispatch label replaces "News" per the new top nav.
//   - Drops Election + Voting + Training from the primary nav (they sit
//     in the AccountMenu dropdown for authenticated users now).
//   - Active-state uses the new orange Solar Flare underline (set by the
//     .nav-link.active CSS rule in index.css), not Quantum Purple.

import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { useAuth, AccountMenu } from '../../features/auth';

// ── Primary navigation ────────────────────────────────────────────────────────
// Six items.  The redesign deliberately trims the previous ten-item nav so
// the top strip reads as a publication masthead rather than a site map.
// Less-frequently-visited routes (Election / Voting / Training) move to
// the AccountMenu dropdown for authenticated users; anonymous visitors
// reach them by signing up.
const NAV_LINKS = [
  { label: 'Home',            to: '/'        },
  { label: 'Leagues',         to: '/leagues' },
  { label: 'Teams',           to: '/teams'   },
  { label: 'Matches',         to: '/matches' },
  { label: 'Galaxy Dispatch', to: '/news'    },
  { label: 'Idols',           to: '/idols'   },
  { label: 'Voting',          to: '/voting'  },
];

/**
 * Site-wide header with logo, primary nav, and right-edge auth CTA.
 *
 * Renders a desktop horizontal layout or a mobile hamburger drawer based
 * on viewport width via the inline media-query stylesheet at the bottom
 * of this file.  Active route detection uses prefix-matching so deep
 * routes (e.g. /leagues/rocky-inner) still highlight their parent nav
 * entry.
 *
 * Auth control on the right edge:
 *   - Anonymous   → Solar Flare "Create Account" CTA (signs in flow)
 *   - Authenticated → <AccountMenu> (username, credits, dropdown)
 *
 * @returns {JSX.Element}
 */
export default function Header() {
  // Mobile drawer open/closed state.  Reset on route navigation via the
  // onClick handlers attached to each NavLink so the drawer never lingers.
  const [mobileOpen, setMobileOpen] = useState(false);

  // Auth gates which right-edge control renders.
  const { user } = useAuth();
  const location = useLocation();

  /**
   * Whether a given nav link should be styled as active.
   * Exact match for '/' (Home); prefix match for everything else.
   *
   * @param {string} to - The link's target path
   * @returns {boolean}
   */
  const isActive = (to) => {
    if (to === '/') return location.pathname === '/';
    return location.pathname.startsWith(to);
  };

  return (
    <header
      style={{
        backgroundColor: 'var(--color-abyss)',
        position: 'relative',
        zIndex: 10,
        borderBottom: '1px solid var(--color-hairline)',
      }}
    >
      <div
        className="container"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-6)',
          paddingBlock: 'var(--space-4)',
        }}
      >
        {/* ── Logo ─────────────────────────────────────────────────────────── */}
        {/* Smaller than the previous header (40 px vs 100 px) — the redesign
            puts the publication masthead inside hero sections rather than the
            top chrome, so the header logo only needs to identify the site. */}
        <Link to="/" style={{ display: 'block', flexShrink: 0 }} aria-label="ISL home">
          <img
            src={`${import.meta.env.BASE_URL}isl-logo.svg`}
            alt="Intergalactic Soccer League"
            className="header-logo"
            style={{ width: 40, height: 40, display: 'block' }}
          />
        </Link>

        {/* ── Desktop navigation ───────────────────────────────────────────── */}
        {/* gap: --space-6 — slightly tighter than the previous --space-8 to
            fit the seven labels comfortably at the 1312 px max-width without
            wrapping at common laptop widths. */}
        <nav
          className="desktop-nav"
          style={{
            display: 'flex',
            gap: 'var(--space-6)',
            alignItems: 'center',
            flex: 1,
            justifyContent: 'center',
          }}
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

        {/* ── Right-edge auth control (desktop) ────────────────────────────── */}
        {/* Authenticated users get the AccountMenu (username + credits +
            dropdown to Profile / Voting / Training / sign-out).  Anonymous
            visitors get a Solar Flare CTA — "Create Account" leads to /login
            which presents both sign-up and sign-in tabs. */}
        <div className="desktop-auth" style={{ flexShrink: 0 }}>
          {user ? (
            <AccountMenu />
          ) : (
            <Link to="/login" className="btn btn-primary">
              Create Account
            </Link>
          )}
        </div>

        {/* ── Mobile hamburger button ──────────────────────────────────────── */}
        <button
          className="mobile-menu-btn"
          onClick={() => setMobileOpen(prev => !prev)}
          aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
          style={{
            background: 'none',
            border: '1px solid var(--color-hairline)',
            color: 'var(--color-dust)',
            cursor: 'pointer',
            padding: 'var(--space-2)',
            display: 'none',
          }}
        >
          {mobileOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {/* ── Mobile navigation drawer ─────────────────────────────────────────
          Only mounted when open.  Stacked links + auth control match the
          desktop list so the same destinations are reachable.  Drawer closes
          on link tap via the onClick handlers. */}
      {mobileOpen && (
        <nav
          style={{
            backgroundColor: 'var(--color-abyss)',
            borderBottom: '1px solid var(--color-hairline)',
            padding: 'var(--space-4) var(--space-6)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-4)',
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

          {user ? (
            <AccountMenu />
          ) : (
            <Link
              to="/login"
              className="btn btn-primary"
              onClick={() => setMobileOpen(false)}
              style={{ alignSelf: 'flex-start' }}
            >
              Create Account
            </Link>
          )}
        </nav>
      )}

      {/* ── Responsive CSS ─────────────────────────────────────────────────────
          Single breakpoint at 768 px.  Below: hide desktop nav + auth, show
          the hamburger.  Above: hide the hamburger, restore the desktop
          three-zone layout. */}
      <style>{`
        @media (max-width: 767px) {
          .desktop-nav     { display: none !important; }
          .desktop-auth    { display: none !important; }
          .mobile-menu-btn { display: flex !important; }
        }
        @media (min-width: 768px) {
          .mobile-menu-btn { display: none !important; }
        }
      `}</style>
    </header>
  );
}
