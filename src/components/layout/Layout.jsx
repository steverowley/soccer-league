// ── Layout.jsx ────────────────────────────────────────────────────────────────
// Root page wrapper that composes the starfield background, sticky header,
// scrollable page content, and footer into a single shell.
//
// Every route in the app renders inside this component so that:
//   1. The starfield background is consistent across all pages.
//   2. The Header and Footer are never duplicated in individual page files.
//   3. The main content area grows to fill available vertical space, pushing
//      the footer to the bottom even on short pages (min-height flex column).
//
// Usage:
//   Wrap <Routes> with <Layout> in main.jsx — child routes receive the shell
//   automatically via React Router's <Outlet>.

import { Outlet } from 'react-router-dom';
import Header from './Header';
import Footer from './Footer';

/**
 * Root layout shell for all ISL website pages.
 *
 * Renders the persistent Header and Footer around a <main> region that
 * displays the current route's page component via React Router's <Outlet>.
 * The starfield CSS class is applied to the outermost div so the star-dot
 * background pattern covers the full viewport on every page.
 *
 * @returns {JSX.Element}
 */
export default function Layout() {
  return (
    // ── Outer shell ───────────────────────────────────────────────────────────
    // `starfield` applies the fixed star-dot pseudo-element background defined
    // in index.css.  The flex column with min-height: 100vh ensures the footer
    // stays at the bottom regardless of page content height.
    <div
      className="starfield"
      style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}
    >
      {/* ── Persistent site header ──────────────────────────────────────────── */}
      <Header />

      {/* ── Page content area ───────────────────────────────────────────────── */}
      {/* flex: 1 makes this region grow to fill remaining vertical space,
          which keeps the Footer pinned to the bottom on short pages. */}
      <main style={{ flex: 1 }}>
        <Outlet />
      </main>

      {/* ── Persistent site footer ──────────────────────────────────────────── */}
      <Footer />
    </div>
  );
}
