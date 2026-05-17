// ── Header.jsx ────────────────────────────────────────────────────────────────
// Site-wide navigation header — Redesign 2026-05 (corrected).
//
// Two-zone layout per the corrected Figma nav strip:
//
//   [logo]                                  [home leagues teams … news idols voting] [Sign Up]
//
// Logo at far left (large — ~64 px shield), the rest of the row pushed to
// the RIGHT and packed: primary nav links clustered together at small-caps
// + tracked weight, then the Solar Flare auth CTA at the far edge.  No
// bottom hairline beneath the strip — the corrected design wants the
// header to bleed into the page below.
//
// Mobile (<768 px) collapses the nav into a hamburger drawer.
//
// CHANGES from the previous header pass:
//   - Nav is right-aligned (was centred between logo and CTA).
//   - Logo bumped 40 → 64 px to read at publication-masthead scale.
//   - Bottom hairline removed.
//   - "Galaxy Dispatch" renamed back to plain "News".
//   - Active state is a dust-tinted chip behind the label (set by
//     .nav-link.active in index.css), NOT an orange underline.
//   - Auth CTA uses Solar Flare red via the .btn-active class — both
//     here and on every other "active" CTA app-wide.

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
  { label: 'Home',    to: '/'        },
  { label: 'Leagues', to: '/leagues' },
  { label: 'Teams',   to: '/teams'   },
  { label: 'Matches', to: '/matches' },
  { label: 'News',    to: '/news'    },
  { label: 'Idols',   to: '/idols'   },
  { label: 'Voting',  to: '/voting'  },
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
        // No bottom hairline per the corrected design — the strip
        // bleeds straight into the page below.
      }}
    >
      <div
        className="container"
        style={{
          display: 'flex',
          alignItems: 'center',
          // Logo on the far left, EVERYTHING else (nav + auth) pushed
          // hard right.  Achieved by making the nav row's left margin
          // auto so the logo + the row are at opposite ends of the
          // container.  No `flex: 1` on the nav — packed at natural
          // width so the cluster stays compact against the right edge.
          gap: 'var(--space-6)',
          paddingBlock: 'var(--space-5)',
        }}
      >
        {/* ── Logo ─────────────────────────────────────────────────────────── */}
        {/* 64 px shield — large enough to read as a publication masthead.
            The previous 40 px size made the strip look like a generic
            SaaS app rather than a broadsheet.  flexShrink: 0 prevents
            the shield from getting squashed at narrow widths. */}
        <Link to="/" style={{ display: 'block', flexShrink: 0 }} aria-label="ISL home">
          <img
            src={`${import.meta.env.BASE_URL}isl-logo.svg`}
            alt="Intergalactic Soccer League"
            className="header-logo"
            style={{ width: 64, height: 64, display: 'block' }}
          />
        </Link>

        {/* ── Right-aligned cluster: nav + auth ──────────────────────────────
            marginLeft: auto pushes the entire cluster to the far right
            so the centre of the strip stays empty.  Nav + auth share
            one flex row so the auth CTA sits flush against the last
            nav link (matches Frame 21's tight cluster). */}
        <div
          className="desktop-cluster"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-6)',
            marginLeft: 'auto',
          }}
        >
          <nav
            className="desktop-nav"
            style={{
              display: 'flex',
              gap: 'var(--space-4)',
              alignItems: 'center',
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

          {/* ── Auth control (desktop) ───────────────────────────────────────
              Authenticated users get the AccountMenu (username + credits +
              dropdown to Profile / Voting / Training / sign-out).
              Anonymous visitors get the Solar Flare "active" CTA
              ("Sign Up") — the corrected spec confirms flare red, not
              orange and not purple. */}
          <div className="desktop-auth" style={{ flexShrink: 0 }}>
            {user ? (
              <AccountMenu />
            ) : (
              <Link to="/login" className="btn btn-active">
                Sign Up
              </Link>
            )}
          </div>
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

          {/* Auth CTA in the mobile drawer mirrors the desktop pattern
              (Quantum Purple "active" variant per Frame 21).  Closes the
              drawer on tap via the inline onClick so the user isn't
              stuck looking at the open drawer after navigation. */}
          {user ? (
            <AccountMenu />
          ) : (
            <Link
              to="/login"
              className="btn btn-active"
              onClick={() => setMobileOpen(false)}
              style={{ alignSelf: 'flex-start' }}
            >
              Sign Up
            </Link>
          )}
        </nav>
      )}

      {/* ── Responsive CSS ─────────────────────────────────────────────────────
          Single breakpoint at 768 px.  Below: hide the desktop cluster
          (nav + auth packed together), show the hamburger.  Above: hide
          the hamburger, restore the two-zone layout (logo left, cluster
          right-aligned via marginLeft:auto). */}
      <style>{`
        @media (max-width: 767px) {
          .desktop-cluster { display: none !important; }
          .mobile-menu-btn { display: flex !important; }
        }
        @media (min-width: 768px) {
          .mobile-menu-btn { display: none !important; }
        }
      `}</style>
    </header>
  );
}
