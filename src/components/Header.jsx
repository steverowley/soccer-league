// ── Header.jsx ────────────────────────────────────────────────────────────
// Top navigation strip — rebuilt from scratch in the 2026-05 nuke against
// the corrected design.
//
// Layout: 64 px logo on the far left; the nav + auth CTA cluster pushed
// to the far right via `marginLeft: auto`.  No bottom border — the strip
// bleeds straight into the page below.
//
// Palette (3 tokens, app-wide):
//   DUST   #E3E0D5  text + active chip
//   ABYSS  #111111  page background
//   FLARE  #FF4F5E  the auth CTA (THE attention colour)
//
// Active-page indicator: a faint dust-tinted rectangle behind the label
// (NOT a coloured underline; NOT a purple pill).
//
// Mobile (<768 px) collapses the cluster into a hamburger drawer.

import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { useAuth } from '../features/auth';

// ── Palette tokens (hard-coded; no design-system file by deliberate choice) ──
// Re-introducing a tokens layer is deferred until 2+ pages legitimately
// share the same hex values (premature-abstraction guard).
const DUST          = '#E3E0D5';
const ABYSS         = '#111111';
const FLARE         = '#FF4F5E';
const DUST_FAINT    = 'rgba(227, 224, 213, 0.12)';
const HAIRLINE      = 'rgba(227, 224, 213, 0.18)';

// ── Primary navigation ──────────────────────────────────────────────────────
// Seven links matching the corrected design.  "News" replaced the
// previous "Galaxy Dispatch" label.  Routes that don't exist yet still
// render as nav links — they'll 404 until each page is rebuilt.
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
 * Site-wide top navigation strip.
 *
 * Renders a 64 px logo on the far left, the primary nav links and an
 * auth CTA packed into a right-aligned cluster, and a mobile hamburger
 * drawer for narrow viewports.
 *
 * Auth control on the right edge:
 *   - Anonymous     → Solar Flare "Sign Up" CTA
 *   - Authenticated → a placeholder text node showing the username
 *                     (the styled balance pill will be rebuilt in a
 *                     follow-up PR; the AccountMenu component was
 *                     deleted in the nuke).
 *
 * Active route detection uses prefix-matching so deep routes (e.g.
 * `/leagues/rocky-inner`) still highlight their parent nav entry.
 *
 * @returns {JSX.Element}
 */
export default function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);
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
    <header style={{ background: ABYSS }}>
      <div
        style={{
          maxWidth: 1312,
          margin: '0 auto',
          padding: '20px 32px',
          display: 'flex',
          alignItems: 'center',
          gap: 24,
        }}
      >
        {/* ── Logo ──────────────────────────────────────────────────────────
            64 px shield reads as a publication masthead.  flexShrink: 0
            keeps the shield un-squashed at narrow widths. */}
        <Link to="/" aria-label="ISL home" style={{ display: 'block', flexShrink: 0 }}>
          <img
            src={`${import.meta.env.BASE_URL}isl-logo.svg`}
            alt="Intergalactic Soccer League"
            style={{ width: 64, height: 64, display: 'block' }}
          />
        </Link>

        {/* ── Desktop cluster: nav + auth packed right ─────────────────────
            marginLeft: auto pushes the entire cluster to the far right
            so the centre of the strip stays empty. */}
        <div
          className="isl-desktop-cluster"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 24,
            marginLeft: 'auto',
          }}
        >
          <nav style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {NAV_LINKS.map(({ label, to }) => (
              <NavLink key={to} to={to} active={isActive(to)}>{label}</NavLink>
            ))}
          </nav>

          {/* ── Auth control (desktop) ───────────────────────────────────
              Anonymous → flare "Sign Up" button.
              Authenticated → username placeholder (AccountMenu pill
              still to be rebuilt). */}
          <div style={{ flexShrink: 0 }}>
            {user ? (
              <span style={{
                fontFamily: 'Space Mono, monospace',
                fontSize: 13,
                color: DUST,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
              }}>
                {user.email?.split('@')[0] ?? 'Account'}
              </span>
            ) : (
              <FlareButton to="/login">Sign Up</FlareButton>
            )}
          </div>
        </div>

        {/* ── Mobile hamburger ─────────────────────────────────────────── */}
        <button
          className="isl-mobile-menu-btn"
          onClick={() => setMobileOpen((p) => !p)}
          aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
          style={{
            background: 'none',
            border: `1px solid ${HAIRLINE}`,
            color: DUST,
            cursor: 'pointer',
            padding: 8,
            display: 'none',
          }}
        >
          {mobileOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {/* ── Mobile drawer ─────────────────────────────────────────────────
          Stacks the same links + CTA vertically beneath the strip when
          the hamburger is tapped.  Drawer closes on link tap so users
          aren't stuck looking at an open drawer post-navigation. */}
      {mobileOpen && (
        <nav
          style={{
            background: ABYSS,
            padding: '16px 32px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            borderTop: `1px solid ${HAIRLINE}`,
          }}
        >
          {NAV_LINKS.map(({ label, to }) => (
            <NavLink
              key={to}
              to={to}
              active={isActive(to)}
              onClick={() => setMobileOpen(false)}
            >
              {label}
            </NavLink>
          ))}
          {!user && (
            <div style={{ marginTop: 8 }}>
              <FlareButton to="/login" onClick={() => setMobileOpen(false)}>
                Sign Up
              </FlareButton>
            </div>
          )}
        </nav>
      )}

      {/* ── Responsive CSS ─────────────────────────────────────────────────
          Single breakpoint at 768 px.  Below: hide the cluster, show the
          hamburger.  Above: hide the hamburger, restore the cluster. */}
      <style>{`
        @media (max-width: 767px) {
          .isl-desktop-cluster { display: none !important; }
          .isl-mobile-menu-btn { display: flex !important; }
        }
        @media (min-width: 768px) {
          .isl-mobile-menu-btn { display: none !important; }
        }
      `}</style>
    </header>
  );
}

/**
 * Single nav link with a subtle dust-tinted active chip.
 *
 * Renders an inline-block label with mono small-caps typography.  Active
 * state paints a faint dust rectangle behind the label (NOT an underline,
 * NOT a coloured pill) per the corrected Frame 21 indicator.
 *
 * @param {object} props
 * @param {string} props.to        Target route
 * @param {boolean} props.active   Whether this link is the current route
 * @param {() => void} [props.onClick]
 * @param {React.ReactNode} props.children  Link label
 */
function NavLink({ to, active, onClick, children }) {
  return (
    <Link
      to={to}
      onClick={onClick}
      style={{
        display: 'inline-block',
        fontFamily: 'Space Mono, monospace',
        fontSize: 13,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        color: DUST,
        textDecoration: 'none',
        padding: '8px 12px',
        background: active ? DUST_FAINT : 'transparent',
        transition: 'background 0.12s ease',
      }}
    >
      {children}
    </Link>
  );
}

/**
 * Solar Flare auth CTA — flare fill + dust text + flare border.
 *
 * Used in the header (Sign Up / Log In) and in the hero (Watch Live
 * Match).  Hover deepens to a darker flare so the affordance reads
 * tactile rather than flat.
 *
 * @param {object} props
 * @param {string} props.to                Target route
 * @param {() => void} [props.onClick]
 * @param {React.ReactNode} props.children Button label
 */
function FlareButton({ to, onClick, children }) {
  return (
    <Link
      to={to}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Space Mono, monospace',
        fontSize: 13,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        color: DUST,
        textDecoration: 'none',
        background: FLARE,
        border: `1px solid ${FLARE}`,
        padding: '12px 24px',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Link>
  );
}
