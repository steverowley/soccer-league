// ── Header.tsx ────────────────────────────────────────────────────────────
// Top navigation strip: the ISL badge on the left, the nav and the account
// control pushed to the right, and a drawer on phones.
//
// On the design language since group 5a (docs/design-language.md), with no
// raw style values (scripts/designTokens.test.ts):
//   - The strip shares the page container (`layout.container` and
//     `layout.gutter`), so the badge lines up with every page title.
//   - Nav labels use the `label` token. Inactive items are the secondary
//     tone; the active page is the full text tone plus a 1 px underline
//     (aria-current="page"). Hover and keyboard focus light the text glow,
//     the only elevation the system allows. No purple: purple is the focus
//     ring (index.css) and the Architect, nothing else.
//   - Signed out, the account control is a SECONDARY Button ("Sign up"). The
//     spec allows one orange primary per view, and that belongs to the
//     page's own call to action (Home's hero, the Log in submit), so the
//     header never competes with it.
//   - Signed in, the account control is a hairline button with the credit
//     balance (tabular, default tone) and the username; it opens a menu on
//     the raised surface (Profile, Wagers, Admin for admins, Sign out).
//   - Below 768 px the cluster collapses into a drawer whose rows keep the
//     44 px touch target.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { useAuth } from '../features/auth';
import { color, glow, glyph, hairline, layout, numeric, space, tone, type } from '../shared/design';
import { Button } from '../shared/ui/Button';

const NAV_LINKS = [
  { label: 'Home',    to: '/'        },
  { label: 'Leagues', to: '/leagues' },
  { label: 'Teams',   to: '/teams'   },
  { label: 'Matches', to: '/matches' },
  { label: 'News',    to: '/news'    },
  { label: 'Idols',   to: '/idols'   },
  // Boards live alongside Idols (devotion): the same "who's winning" lens,
  // seen through the betting and idol-score views combined on one page.
  { label: 'Boards',  to: '/leaderboards' },
  { label: 'Voting',  to: '/voting'  },
  // World (Galaxy Atlas): the entity browser for the world-building graph.
  // Sits after Voting so it reads as depth content, not a primary page.
  { label: 'World',   to: '/world'   },
  // Roadmap is admin-only and reached via /admin's tabbed nav, so it is
  // absent here: non-admins would only meet an Access Denied surface.
];

/**
 * Site-wide top navigation strip.
 *
 * @returns The skip link, the header and the skip-link target.
 */
export default function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user } = useAuth();
  const location = useLocation();

  const isActive = (to: string): boolean => {
    if (to === '/') return location.pathname === '/';
    return location.pathname.startsWith(to);
  };
  const close = () => setMobileOpen(false);

  return (
    <>
    {/*
     * Skip-to-content link (#384). Rendered before <header> so it is the
     * first focusable element on the page; hidden off-screen until focused
     * (see .isl-skip-link in index.css). Targets the anchor at the bottom
     * of this component, so keyboard users land past the nav.
     */}
    <a className="isl-skip-link" href="#main-content">Skip to content</a>
    <header style={{ background: color.bg }}>
      <div
        style={{
          maxWidth: layout.container,
          margin: '0 auto',
          paddingTop: space[16],
          paddingBottom: space[16],
          paddingLeft: layout.gutter,
          paddingRight: layout.gutter,
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          gap: space[12],
        }}
      >
        <Link to="/" aria-label="ISL home" style={{ display: 'block', flexShrink: 0 }}>
          {/* The ISL badge is portrait (142 x 189): a fixed height with
              width auto keeps its aspect ratio. */}
          <img
            src={`${import.meta.env.BASE_URL}isl-logo.svg`}
            alt="Intergalactic Soccer League"
            style={{ height: 72, width: 'auto', display: 'block' }}
          />
        </Link>

        <div
          className="isl-desktop-cluster"
          style={{ display: 'flex', alignItems: 'center', gap: space[16], marginLeft: 'auto', minWidth: 0 }}
        >
          <nav aria-label="Main" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center' }}>
            {NAV_LINKS.map(({ label, to }) => (
              <NavLink key={to} to={to} active={isActive(to)}>{label}</NavLink>
            ))}
          </nav>

          <div style={{ flexShrink: 0 }}>
            {user ? <AccountMenu /> : <Button variant="secondary" to="/login">Sign up</Button>}
          </div>
        </div>

        <button
          type="button"
          className="isl-mobile-menu-btn"
          onClick={() => setMobileOpen((p) => !p)}
          aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={mobileOpen}
          aria-controls="isl-mobile-nav"
          style={{
            background: 'transparent',
            ...hairline(color.line),
            color: color.text,
            cursor: 'pointer',
            padding: space[12],
            minHeight: 44,
            minWidth: 44,
            marginLeft: 'auto',
            display: 'none',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {mobileOpen && (
        <nav
          id="isl-mobile-nav"
          aria-label="Main"
          style={{
            background: color.bg,
            paddingTop: space[8],
            paddingBottom: space[16],
            paddingLeft: layout.gutter,
            paddingRight: layout.gutter,
            display: 'flex',
            flexDirection: 'column',
            borderTop: `1px solid ${color.line}`,
          }}
        >
          {NAV_LINKS.map(({ label, to }) => (
            <NavLink key={to} to={to} active={isActive(to)} onClick={close} block>
              {label}
            </NavLink>
          ))}
          <div style={{ marginTop: space[8], paddingTop: space[8], borderTop: `1px solid ${color.lineFaint}`, display: 'flex', flexDirection: 'column' }}>
            {!user ? (
              <div style={{ paddingTop: space[8] }}>
                <Button variant="secondary" to="/login">Sign up</Button>
              </div>
            ) : (
              <>
                <NavLink to="/profile" active={isActive('/profile')} onClick={close} block>Profile</NavLink>
                <NavLink to="/wagers" active={isActive('/wagers')} onClick={close} block>Wagers</NavLink>
                <MobileSignOutButton onAfter={close} />
              </>
            )}
          </div>
        </nav>
      )}

      <style>{`
        @media (max-width: 767px) {
          .isl-desktop-cluster { display: none !important; }
          .isl-mobile-menu-btn { display: inline-flex !important; }
        }
        @media (min-width: 768px) {
          .isl-mobile-menu-btn { display: none !important; }
        }
      `}</style>
    </header>
    {/* Skip-link target. tabIndex=-1 lets keyboard focus land here when the
        skip link is activated without adding it to the tab order. */}
    <span id="main-content" tabIndex={-1} aria-hidden="true" />
    </>
  );
}

/** Shared look of every nav row and menu item: label type, 44 px target. */
const NAV_ITEM: CSSProperties = {
  ...type.label,
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 44,
  paddingTop: 0,
  paddingBottom: 0,
  paddingLeft: space[8],
  paddingRight: space[8],
  textDecoration: 'none',
  transition: 'text-shadow 0.12s linear',
};

interface NavLinkProps {
  to: string;
  active: boolean;
  onClick?: () => void;
  /** Full-width row (the phone drawer). */
  block?: boolean;
  children: ReactNode;
}

/**
 * One nav item. Inactive: secondary tone. Active: default tone with a 1 px
 * underline and aria-current="page". Hover and focus light the text glow.
 *
 * @returns A router link at least 44 px tall.
 */
function NavLink({ to, active, onClick, block = false, children }: NavLinkProps) {
  const [lit, setLit] = useState(false);
  return (
    <Link
      to={to}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      onMouseEnter={() => setLit(true)}
      onMouseLeave={() => setLit(false)}
      onFocus={() => setLit(true)}
      onBlur={() => setLit(false)}
      style={{
        ...NAV_ITEM,
        ...(block ? { display: 'flex', paddingLeft: 0, paddingRight: 0 } : null),
        color: active || lit ? color.text : color.textSecondary,
        textDecorationLine: active ? 'underline' : 'none',
        textDecorationThickness: 1,
        textUnderlineOffset: 6,
        textShadow: lit ? glow.text : 'none',
      }}
    >
      {children}
    </Link>
  );
}

/**
 * Signed-in account control on desktop: credit balance and username on a
 * hairline button; opens a menu with Profile, Wagers, Admin (admins only)
 * and Sign out.
 *
 * @returns The trigger and, when open, its menu.
 */
function AccountMenu() {
  const { profile, user, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [lit, setLit] = useState(false);
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
        onMouseEnter={() => setLit(true)}
        onMouseLeave={() => setLit(false)}
        onFocus={() => setLit(true)}
        onBlur={() => setLit(false)}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          ...type.label,
          display: 'inline-flex',
          alignItems: 'center',
          gap: space[8],
          background: 'transparent',
          ...hairline(color.text),
          color: color.text,
          paddingTop: 0,
          paddingBottom: 0,
          paddingLeft: space[16],
          paddingRight: space[16],
          minHeight: 44,
          fontFamily: 'inherit',
          cursor: 'pointer',
          boxShadow: lit || open ? glow.outline : 'none',
          transition: 'box-shadow 0.15s ease',
        }}
      >
        <span style={numeric} aria-label={`${credits.toLocaleString()} credits`}>
          {credits.toLocaleString()}
        </span>
        <span aria-hidden="true" style={tone.tertiary}>{glyph.middot}</span>
        <span>{username}</span>
        <span aria-hidden="true" style={tone.secondary}>
          {open ? '\u25B4' : '\u25BE'}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: `calc(100% + ${space[4]}px)`,
            right: 0,
            minWidth: 200,
            background: color.surfaceRaised,
            ...hairline(color.line),
            display: 'flex',
            flexDirection: 'column',
            zIndex: 10,
          }}
        >
          <MenuLink to="/profile" onClick={() => setOpen(false)}>Profile</MenuLink>
          <MenuLink to="/wagers"  onClick={() => setOpen(false)}>Wagers</MenuLink>
          {/* Admin link (#385): only for users with profiles.is_admin set.
              Non-admins never see it. */}
          {profile?.is_admin === true && (
            <MenuLink to="/admin" onClick={() => setOpen(false)}>Admin</MenuLink>
          )}
          <MenuButton onClick={onSignOut}>Sign out</MenuButton>
        </div>
      )}
    </div>
  );
}

/** Look of one menu row on the raised surface. */
const MENU_ITEM: CSSProperties = {
  ...NAV_ITEM,
  display: 'flex',
  width: '100%',
  boxSizing: 'border-box',
  paddingLeft: space[16],
  paddingRight: space[16],
  color: color.text,
  background: 'transparent',
  borderWidth: 0,
  borderBottom: `1px solid ${color.lineFaint}`,
  fontFamily: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
};

/** One dropdown item rendered as a router link. */
function MenuLink({ to, onClick, children }: { to: string; onClick: () => void; children: ReactNode }) {
  return (
    <Link to={to} onClick={onClick} role="menuitem" style={MENU_ITEM}>
      {children}
    </Link>
  );
}

/** One dropdown item rendered as a button (Sign out). */
function MenuButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} role="menuitem" style={{ ...MENU_ITEM, borderBottomWidth: 0 }}>
      {children}
    </button>
  );
}

/**
 * Sign out row in the phone drawer: the same look as the nav rows above it.
 *
 * @param onAfter  Closes the drawer once signed out.
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
        ...NAV_ITEM,
        display: 'flex',
        paddingLeft: 0,
        paddingRight: 0,
        ...tone.secondary,
        background: 'transparent',
        borderWidth: 0,
        fontFamily: 'inherit',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      Sign out
    </button>
  );
}
