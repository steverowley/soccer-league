// ── Layout.jsx ────────────────────────────────────────────────────────────────
// Root page wrapper that composes the sticky header, scrollable page content,
// and footer into a single shell.
//
// REDESIGN 2026-05: dropped the `.starfield` pseudo-element background from
// the outer shell — the new editorial direction puts NASA-style halftone
// space photographs inside hero sections rather than tiling stars across
// every viewport.  The body background is now plain Galactic Abyss so the
// imagery in hero sections has somewhere to read against.
//
// Every route renders inside this component so:
//   1. The Header and Footer are never duplicated in individual page files.
//   2. The main content area grows to fill available vertical space, pushing
//      the footer to the bottom even on short pages (min-height flex column).

import { Outlet } from 'react-router-dom';
import Header from './Header';
import Footer from './Footer';

/**
 * Root layout shell for all ISL website pages.
 *
 * Renders the persistent Header and Footer around a <main> region that
 * displays the current route's page component via React Router's <Outlet>.
 *
 * @returns {JSX.Element}
 */
export default function Layout() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Header />

      {/* flex: 1 makes this region grow to fill remaining vertical space,
          which keeps the Footer pinned to the bottom on short pages. */}
      <main style={{ flex: 1 }}>
        <Outlet />
      </main>

      <Footer />
    </div>
  );
}
