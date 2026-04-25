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
    <div ref={menuRef} className="account-menu">
      {/* ── Trigger button ─────────────────────────────────────────────────── */}
      {/* Shows username + IC balance at a glance — the two numbers fans care
          about most between matches. Toggles the dropdown on click. */}
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="account-menu__trigger"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <span>{profile.username}</span>
        <span className="account-menu__credits">{profile.credits} IC</span>
      </button>

      {/* ── Dropdown panel ─────────────────────────────────────────────────── */}
      {/* Only mounted when open — keeps focus-trap scope narrow and avoids
          rendering hidden interactive elements that confuse screen readers. */}
      {open && (
        <div className="account-menu__dropdown" role="menu">
          {/* Full credit label — trigger shows "200 IC" shorthand; header
              row spells it out so there's no ambiguity about units. */}
          <div className="account-menu__header">
            Intergalactic Credits: {profile.credits}
          </div>

          {/* ── Profile link ───────────────────────────────────────────────── */}
          {/* Primary destination — account summary, preferences, bet history.
              Placed above Sign Out so the destructive action is always last. */}
          <Link
            to="/profile"
            onClick={() => setOpen(false)}
            className="account-menu__link"
            role="menuitem"
          >
            Profile
          </Link>

          {/* ── Sign out ───────────────────────────────────────────────────── */}
          {/* Destructive action — red label signals intent without a modal.
              setOpen first so the dropdown unmounts before the session clears,
              preventing a brief flash of the logged-in state. */}
          <button
            onClick={async () => {
              setOpen(false);
              await signOut();
            }}
            className="account-menu__signout"
            role="menuitem"
          >
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}
