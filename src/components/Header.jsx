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
//   QUANTUM #9A5CF4 the auth CTA (THE focus colour — primary attention)
//                   Solar Flare (#FF4F5E) is error-only per the design
//                   system; see Layout.jsx COLORS for the full map.
//
// Active-page indicator: a faint dust-tinted rectangle behind the label
// (NOT a coloured underline; NOT a purple pill).
//
// Mobile (<768 px) collapses the cluster into a hamburger drawer.

import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { useAuth } from '../features/auth';

// ── Palette tokens (hard-coded; no design-system file by deliberate choice) ──
// Re-introducing a tokens layer is deferred until 2+ pages legitimately
// share the same hex values (premature-abstraction guard).
// ── Palette aliases ──────────────────────────────────────────────────────
// Hard-coded here (not imported from Layout) because Header sits at the
// top of the providers tree and we want it stable even if Layout's
// shape changes.  These MUST stay in lock-step with the COLORS object
// in components/Layout.jsx.
//
// QUANTUM is the focus / primary-CTA hue — the Sign Up pill is the only
// flare-equivalent surface in the header, but Solar Flare is the
// error-only colour per the design system, so the pill uses Quantum
// Purple instead.  See Layout.jsx COLORS for the full semantic map.
const DUST       = '#E3E0D5';
const ABYSS      = '#111111';
const QUANTUM    = '#9A5CF4';
const DUST_FAINT = 'rgba(227, 224, 213, 0.12)';
const HAIRLINE   = 'rgba(227, 224, 213, 0.18)';

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
 *   - Authenticated → AccountMenu pill — credit balance + username
 *                     + dropdown menu (Profile / Wagers / Sign Out).
 *                     Rebuilt in PR 9 alongside the /wagers route.
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
              Authenticated → AccountMenu pill (credit balance +
              username + dropdown to Profile / Wagers / Sign Out). */}
          <div style={{ flexShrink: 0 }}>
            {user ? <AccountMenu /> : <FlareButton to="/login">Sign Up</FlareButton>}
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
          {!user ? (
            <div style={{ marginTop: 8 }}>
              <FlareButton to="/login" onClick={() => setMobileOpen(false)}>
                Sign Up
              </FlareButton>
            </div>
          ) : (
            <div style={{
              marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8,
            }}>
              {/* In the mobile drawer the AccountMenu's dropdown
                  positioning would collide with the drawer chrome —
                  flatten to three plain NavLinks instead. */}
              <NavLink to="/profile"  active={false} onClick={() => setMobileOpen(false)}>Profile</NavLink>
              <NavLink to="/wagers"   active={false} onClick={() => setMobileOpen(false)}>Wagers</NavLink>
              <MobileSignOutButton onAfter={() => setMobileOpen(false)} />
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
 * AccountMenu — authenticated-user pill in the desktop header.
 *
 * Layout: credit balance + bullet + username, packed into a single
 * hairline-bordered pill.  Clicking the pill opens a small dropdown
 * with three items: Profile / Wagers / Sign Out.  Dropdown closes on
 * any outside click (handled by a document-level mousedown listener
 * registered while open) or when one of the items is activated.
 *
 * @returns {JSX.Element}
 */
function AccountMenu() {
  const { profile, user, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Outside-click handler — only registered while the dropdown is
  // open so we're not paying for a global mousedown listener on every
  // page.  The cleanup function removes it the moment `open` flips
  // back to false.
  useEffect(() => {
    if (!open) return undefined;
    const onDocMouseDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  const credits  = profile?.credits ?? 0;
  // Username falls back to the local-part of the email (split on '@'
  // and take the prefix) so a freshly-signed-up user who hasn't set
  // a username still sees a meaningful label.
  const username = profile?.username ?? user?.email?.split('@')[0] ?? 'Account';

  const onSignOut = async () => {
    setOpen(false);
    await signOut();
    navigate('/', { replace: true });
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          background: open ? DUST_FAINT : 'transparent',
          border: `1px solid ${HAIRLINE}`,
          color: DUST,
          padding: '8px 14px',
          fontFamily: 'Space Mono, monospace',
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          cursor: 'pointer',
        }}
      >
        {/* Credit balance painted in Quantum Purple — the user's
            focus number, NOT an error state.  Solar Flare here would
            misread as "your credits are in trouble". */}
        <span style={{ color: QUANTUM, fontVariantNumeric: 'tabular-nums' }}>
          {credits.toLocaleString()}
        </span>
        <span style={{ color: 'rgba(227, 224, 213, 0.50)' }}>•</span>
        <span>{username}</span>
        <span aria-hidden="true" style={{ color: 'rgba(227, 224, 213, 0.70)' }}>
          {open ? '▴' : '▾'}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            minWidth: 180,
            background: ABYSS,
            border: `1px solid ${HAIRLINE}`,
            display: 'flex',
            flexDirection: 'column',
            zIndex: 10,
          }}
        >
          <MenuLink to="/profile" onClick={() => setOpen(false)}>Profile</MenuLink>
          <MenuLink to="/wagers"  onClick={() => setOpen(false)}>Wagers</MenuLink>
          <MenuButton onClick={onSignOut}>Sign Out</MenuButton>
        </div>
      )}
    </div>
  );
}

/**
 * Single dropdown item rendered as a router link.  Mirrors NavLink's
 * typography but stretches edge-to-edge inside the menu shell.
 *
 * @param {object} props
 * @param {string} props.to
 * @param {() => void} props.onClick
 * @param {React.ReactNode} props.children
 */
function MenuLink({ to, onClick, children }) {
  return (
    <Link
      to={to}
      onClick={onClick}
      role="menuitem"
      style={{
        display: 'block',
        padding: '10px 14px',
        color: DUST,
        textDecoration: 'none',
        fontFamily: 'Space Mono, monospace',
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        borderBottom: `1px solid ${HAIRLINE}`,
      }}
    >
      {children}
    </Link>
  );
}

/**
 * Single dropdown item rendered as a plain button (for Sign Out,
 * which has no destination).  Same typography as MenuLink so the
 * dropdown reads as a uniform list.
 *
 * @param {object} props
 * @param {() => void} props.onClick
 * @param {React.ReactNode} props.children
 */
function MenuButton({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="menuitem"
      style={{
        display: 'block',
        textAlign: 'left',
        padding: '10px 14px',
        color: DUST,
        background: 'transparent',
        border: 'none',
        fontFamily: 'Space Mono, monospace',
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        cursor: 'pointer',
        width: '100%',
      }}
    >
      {children}
    </button>
  );
}

/**
 * Mobile-drawer sign-out button.  Stripped-down variant of
 * MenuButton — flatter styling so it sits cleanly inside the
 * drawer's stacked NavLink list rather than as a dropdown item.
 *
 * @param {{ onAfter: () => void }} props  Called after signOut resolves
 *   so the drawer can close itself.
 */
function MobileSignOutButton({ onAfter }) {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const onClick = async () => {
    await signOut();
    onAfter?.();
    navigate('/', { replace: true });
  };
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-block',
        textAlign: 'left',
        fontFamily: 'Space Mono, monospace',
        fontSize: 13,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        color: DUST,
        background: 'transparent',
        border: 'none',
        padding: '8px 12px',
        cursor: 'pointer',
      }}
    >
      Sign Out
    </button>
  );
}

/**
 * Quantum Purple auth CTA — purple fill + dust text + purple border.
 *
 * Used in the header (Sign Up) and in the mobile drawer.  Quantum
 * Purple is the design system's focus colour — primary attention.
 * The component name is kept as `FlareButton` for legacy reasons
 * (PR 12 corrected the fill colour but renaming all callers across
 * the desktop + mobile branches is a separate cleanup).
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
        background: QUANTUM,
        border: `1px solid ${QUANTUM}`,
        padding: '12px 24px',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Link>
  );
}
