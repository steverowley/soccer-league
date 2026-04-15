// ── AccountMenu.tsx ──────────────────────────────────────────────────────────
// WHY: A compact header widget that replaces the "Log In" nav link when the
// user is authenticated. Displays the username + credit balance so the user
// always has a sense of their bankroll (crucial for betting/voting decisions).
// Clicking it opens a dropdown with profile actions and sign-out.
//
// DESIGN:
//   - The credit balance is the single most important number in the game
//     (it drives betting stakes and voting power), so it's always visible
//     in the header — not buried on a profile page.
//   - Uses ISL design tokens for consistency with the retro-minimalist theme.
//   - The dropdown is a simple CSS-positioned panel rather than a third-party
//     popover library, keeping the bundle lean.

import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from './AuthProvider';

/**
 * Compact header widget showing the logged-in user's name and credits.
 * Renders a clickable trigger that toggles a dropdown with sign-out.
 *
 * Usage in Header.jsx:
 *   {user ? <AccountMenu /> : <Link to="/login">Log In</Link>}
 */
export function AccountMenu() {
  const { profile, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // ── Close on outside click ──────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  if (!profile) return null;

  return (
    <div ref={menuRef} style={{ position: 'relative', display: 'inline-block' }}>
      {/* ── Trigger button ─────────────────────────────────────────────────── */}
      <button
        onClick={() => setOpen((prev) => !prev)}
        style={{
          background: 'none',
          border: '1px solid rgba(227,224,213,0.2)',
          color: 'var(--color-dust)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--font-size-small)',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: 'var(--letter-spacing-wide)',
          padding: 'var(--space-2) var(--space-4)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
        }}
      >
        <span>{profile.username}</span>
        <span
          style={{
            color: 'var(--color-purple)',
            fontWeight: 700,
          }}
        >
          {profile.credits} IC
        </span>
      </button>

      {/* ── Dropdown panel ─────────────────────────────────────────────────── */}
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 'var(--space-2)',
            backgroundColor: 'var(--color-ash)',
            border: '1px solid rgba(227,224,213,0.2)',
            minWidth: 180,
            zIndex: 100,
          }}
        >
          {/* Credit balance detail row */}
          <div
            style={{
              padding: 'var(--space-3) var(--space-4)',
              borderBottom: '1px solid rgba(227,224,213,0.1)',
              fontSize: 'var(--font-size-micro)',
              fontFamily: 'var(--font-mono)',
              color: 'rgba(227,224,213,0.6)',
              textTransform: 'uppercase',
              letterSpacing: 'var(--letter-spacing-wider)',
            }}
          >
            Intergalactic Credits: {profile.credits}
          </div>

          {/* ── Profile link ───────────────────────────────────────────────── */}
          {/* Primary navigation destination for the logged-in user — account
              summary, preferences editor, and full bet history all live there.
              Placed before Sign Out so the destructive action is at the bottom,
              matching standard UX conventions. */}
          <Link
            to="/profile"
            onClick={() => setOpen(false)}
            style={{
              display: 'block',
              padding: 'var(--space-3) var(--space-4)',
              borderBottom: '1px solid rgba(227,224,213,0.1)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--font-size-small)',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: 'var(--letter-spacing-wider)',
              color: 'var(--color-dust)',
              textDecoration: 'none',
            }}
          >
            Profile
          </Link>

          {/* Sign out */}
          <button
            onClick={async () => {
              setOpen(false);
              await signOut();
            }}
            style={{
              width: '100%',
              textAlign: 'left',
              background: 'none',
              border: 'none',
              padding: 'var(--space-3) var(--space-4)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--font-size-small)',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: 'var(--letter-spacing-wider)',
              color: 'var(--color-red)',
              cursor: 'pointer',
            }}
          >
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}
