// ── Header.tsx ────────────────────────────────────────────────────────────
// Top navigation strip — rebuilt from scratch in the 2026-05 nuke against
// the corrected design.
//
// Layout: 64 px logo on the far left; the nav + auth CTA cluster pushed
// to the far right via `marginLeft: auto`.  No bottom border — the strip
// bleeds straight into the page below.
//
// Active-page indicator: a Lunar-Dust text glow behind the label — the
// canonical nav treatment (see Nav.jsx / isl-pages.css in the isl-design
// skill). Hover lights a subtle glow; the active page burns brighter. No
// background chip, no coloured underline, no purple pill.
//
// Mobile (<768 px) collapses the cluster into a hamburger drawer.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { useAuth } from '../features/auth';

const DUST       = '#E3E0D5';
const ABYSS      = '#111111';
// Astro Explorer — the design system's loud action colour. Used for the auth
// CTA and to highlight the live credit balance (a warm accent, not the focus
// purple, which the design reserves for focus rings + live indicators).
const ASTRO      = '#FF6637';
// Pure white — the design system reserves it for hard dividers and the
// "logged-in nav outline" (the account chip border). Nowhere else.
const WHITE      = '#FFFFFF';
// Faint dust wash — used for the open-state fill on the account-menu trigger.
const DUST_FAINT = 'rgba(227, 224, 213, 0.12)';
const HAIRLINE   = 'rgba(227, 224, 213, 0.18)';
// Nav-link glow — the canonical hover/active treatment (see Nav.jsx /
// isl-pages.css in the isl-design skill). Hierarchy comes from glow
// intensity, not a background chip.
const NAV_GLOW_HOVER  = '0 0 10px rgba(227, 224, 213, 0.60)';
const NAV_GLOW_ACTIVE = '0 0 12px rgba(227, 224, 213, 0.95), 0 0 4px rgba(227, 224, 213, 0.80)';

const NAV_LINKS = [
  { label: 'Home',    to: '/'        },
  { label: 'Leagues', to: '/leagues' },
  { label: 'Teams',   to: '/teams'   },
  { label: 'Matches', to: '/matches' },
  { label: 'News',    to: '/news'    },
  { label: 'Idols',   to: '/idols'   },
  // Boards live alongside Idols (devotion) — same "who's winning" lens
  // but seen through the betting + idol-score views combined on one page.
  { label: 'Boards',  to: '/leaderboards' },
  { label: 'Voting',  to: '/voting'  },
  // World (Galaxy Atlas) — entity browser for the Phase 6 world-building
  // graph.  Surfaces politicians, media companies, stadiums, officials, and
  // their relationship web.  Lives between Voting and the auth CTA so it
  // reads as "depth content" rather than a primary match/standings page.
  { label: 'World',   to: '/world'   },
  // Roadmap is admin-only now and reached via /admin's tabbed nav.  It's
  // intentionally absent from this public NAV strip so non-admins don't
  // see an Access Denied surface when they click it.
];

/**
 * Site-wide top navigation strip.
 *
 * Renders a 64 px logo on the far left, the primary nav links and an
 * auth CTA packed into a right-aligned cluster, and a mobile hamburger
 * drawer for narrow viewports.
 */
export default function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user } = useAuth();
  const location = useLocation();

  const isActive = (to: string): boolean => {
    if (to === '/') return location.pathname === '/';
    return location.pathname.startsWith(to);
  };

  return (
    <>
    {/*
     * Skip-to-content link (#384). Rendered before <header> so it's the
     * first focusable element in the page; hidden off-screen until
     * focused (see .isl-skip-link in index.css). Targets the anchor we
     * inject at the bottom of <Header /> so keyboard users land at the
     * start of the page's main content, past the nav.
     */}
    <a className="isl-skip-link" href="#main-content">Skip to content</a>
    <header style={{ background: ABYSS }}>
      <div
        style={{
          maxWidth: 1312,
          margin: '0 auto',
          padding: '16px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <Link to="/" aria-label="ISL home" style={{ display: 'block', flexShrink: 0 }}>
          {/* The ISL badge is portrait (142×189). Render at a fixed height with
              width:auto so it keeps its aspect ratio (the old 56×56 squished it
              into a square) and reads as the prominent brand mark the design
              system calls for. */}
          <img
            src={`${import.meta.env.BASE_URL}isl-logo.svg`}
            alt="Intergalactic Soccer League"
            style={{ height: 72, width: 'auto', display: 'block' }}
          />
        </Link>

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

          <div style={{ flexShrink: 0 }}>
            {user ? <AccountMenu /> : <FlareButton to="/login">Sign Up</FlareButton>}
          </div>
        </div>

        <button
          className="isl-mobile-menu-btn"
          onClick={() => setMobileOpen((p) => !p)}
          aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
          style={{
            background: 'none',
            border: `1px solid ${HAIRLINE}`,
            color: DUST,
            cursor: 'pointer',
            padding: 12,
            minHeight: 44,
            minWidth: 44,
            display: 'none',
            flexShrink: 0,
          }}
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {mobileOpen && (
        <nav
          style={{
            background: ABYSS,
            padding: '12px 16px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
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
              <NavLink to="/profile"  active={false} onClick={() => setMobileOpen(false)}>Profile</NavLink>
              <NavLink to="/wagers"   active={false} onClick={() => setMobileOpen(false)}>Wagers</NavLink>
              <MobileSignOutButton onAfter={() => setMobileOpen(false)} />
            </div>
          )}
        </nav>
      )}

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
    {/* Skip-link target. tabIndex=-1 lets keyboard focus land here when
        the user activates the skip link without trapping the anchor in
        normal tab order. */}
    <span id="main-content" tabIndex={-1} aria-hidden="true" />
    </>
  );
}

interface NavLinkProps {
  to: string;
  active: boolean;
  onClick?: () => void;
  children: ReactNode;
}

/**
 * Single nav link with the canonical Lunar-Dust text glow.
 *
 * Resting links are flat dust; hover lights a subtle glow and the active
 * page burns brighter still (see NAV_GLOW_* constants). Hierarchy comes
 * from glow intensity, never a background chip — matching the design
 * system's Nav.jsx. Hover is tracked in local state so the same treatment
 * works for mouse and keyboard focus.
 *
 * Touch-friendly: 44px+ minimum height for mobile tap target compliance.
 */
function NavLink({ to, active, onClick, children }: NavLinkProps) {
  const [hovered, setHovered] = useState(false);
  // Active always wins; otherwise glow only while hovered/focused.
  const textShadow = active ? NAV_GLOW_ACTIVE : hovered ? NAV_GLOW_HOVER : 'none';
  return (
    <Link
      to={to}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        minHeight: 44,
        fontSize: 13,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        color: DUST,
        textDecoration: 'none',
        padding: '12px 16px',
        textShadow,
        transition: 'text-shadow 0.12s linear',
      }}
    >
      {children}
    </Link>
  );
}

/**
 * AccountMenu — authenticated-user pill in the desktop header.
 * Credit balance + username in a hairline-bordered pill; clicking opens a
 * small dropdown with Profile / Wagers / Sign Out.
 */
function AccountMenu() {
  const { profile, user, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  const credits  = profile?.credits ?? 0;
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
          // White outline — the design system's "logged-in nav outline".
          border: `1px solid ${WHITE}`,
          color: DUST,
          padding: '12px 14px',
          minHeight: 44,
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          cursor: 'pointer',
        }}
      >
        {/* Credit balance in Astro Explorer with a matching warm glow — the
            one lit accent in the otherwise monochrome chip. */}
        <span style={{ color: ASTRO, textShadow: '0 0 6px rgba(255, 102, 55, 0.70)', fontVariantNumeric: 'tabular-nums' }}>
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
          {/* Admin link (#385) — only visible to users with profiles.is_admin
              set. Pre-#385 admins had to remember /admin existed and type
              the URL; the link removes that friction. Non-admins see no
              link, so this isn't a UI surface for non-privileged users. */}
          {profile?.is_admin === true && (
            <MenuLink to="/admin" onClick={() => setOpen(false)}>Admin</MenuLink>
          )}
          <MenuButton onClick={onSignOut}>Sign Out</MenuButton>
        </div>
      )}
    </div>
  );
}

interface MenuLinkProps {
  to: string;
  onClick: () => void;
  children: ReactNode;
}

/** Single dropdown item rendered as a router link. */
function MenuLink({ to, onClick, children }: MenuLinkProps) {
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

/** Single dropdown item rendered as a plain button (for Sign Out). */
function MenuButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
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
 * Mobile-drawer sign-out button.  Flatter styling to sit cleanly inside
 * the drawer's stacked NavLink list.
 */
function MobileSignOutButton({ onAfter }: { onAfter: () => void }) {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const onClick = async () => {
    await signOut();
    onAfter();
    navigate('/', { replace: true });
  };
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-block',
        textAlign: 'left',
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

interface FlareButtonProps {
  to: string;
  onClick?: () => void;
  children: ReactNode;
}

/**
 * Astro-orange auth CTA — the design system's "Active button": orange fill +
 * abyss text + orange border. This is the nav's loud call to action (Sign Up /
 * Log In). Orange (not purple, not flare-red) is the action colour; orange
 * wants dark text for contrast, so the label is abyss rather than dust. Named
 * FlareButton for legacy reasons only.
 * Touch-friendly: 44px+ minimum height for mobile tap target compliance.
 */
function FlareButton({ to, onClick, children }: FlareButtonProps) {
  return (
    <Link
      to={to}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 44,
        fontSize: 13,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        color: ABYSS,
        textDecoration: 'none',
        background: ASTRO,
        border: `1px solid ${ASTRO}`,
        padding: '12px 24px',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Link>
  );
}
