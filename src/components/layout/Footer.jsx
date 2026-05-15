// ── Footer.jsx ────────────────────────────────────────────────────────────────
// Site-wide footer — Redesign 2026-05.
//
// Replaces the previous two-column layout (logo+text left, nav links right)
// with a single centred metadata strip matching the new Figma footer:
//
//   ◆  © 2026 INTERGALACTIC SOCCER LEAGUE   •   v 0.7.0   •   EST. SOLAR CYCLE 2401   •   EPOCH MMXXXVII
//
// Footer is now metadata only — no nav links.  The redesign trusts the
// header masthead and in-page links for navigation; the footer's job is
// to ground the page in the publication's voice (ISL credit, build
// version, established year, current epoch).
//
// All text inherits the .footer class (defined in index.css) which sets
// the small-caps + low opacity treatment.

import { Link } from 'react-router-dom';

// ── Build metadata ────────────────────────────────────────────────────────────
// Surfaced in the footer alongside the establishment year and epoch.  Bumping
// any of these is part of the design — the publication shows what cycle the
// reader is in.  Hard-coded for now; a future task will derive from Vite
// build env (`__APP_VERSION__`) and the active season row.
const BUILD_VERSION = 'v 0.7.0';
const ESTABLISHED   = 'EST. SOLAR CYCLE 2401';
const EPOCH         = 'EPOCH MMXXXVII';

/**
 * Site-wide footer.  Centred metadata strip with a hairline top border.
 *
 * The four bullet-separated tokens render in small-caps lunar-dust at low
 * opacity so the footer reads as publication chrome rather than navigation.
 * The leftmost ISL crest (Link to home) keeps the brand mark accessible
 * from every page.
 *
 * @returns {JSX.Element}
 */
export default function Footer() {
  return (
    <footer className="footer">
      <div
        className="container"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--space-3)',
          flexWrap: 'wrap',
        }}
      >
        {/* Crest — also a Link home so the footer always offers a brand-back
            escape from any page.  20 px keeps it small enough to read as a
            mark rather than competing with the metadata text. */}
        <Link
          to="/"
          aria-label="ISL home"
          style={{ display: 'inline-flex', alignItems: 'center', opacity: 0.6 }}
        >
          <img
            src={`${import.meta.env.BASE_URL}isl-logo.svg`}
            alt=""
            style={{ width: 20, height: 20, display: 'block' }}
          />
        </Link>

        {/* Metadata tokens with bullet separators.  Each token renders inline
            so the strip flows responsively — bullets disappear at the wrap
            points without leaving orphan separators. */}
        <span>© 2026 Intergalactic Soccer League</span>
        <FooterDot />
        <span>{BUILD_VERSION}</span>
        <FooterDot />
        <span>{ESTABLISHED}</span>
        <FooterDot />
        <span>{EPOCH}</span>
      </div>
    </footer>
  );
}

/**
 * Tiny middle-aligned bullet used between metadata tokens.  Extracted so
 * spacing/opacity can be tuned in one place rather than at every join.
 */
function FooterDot() {
  return <span aria-hidden="true" style={{ opacity: 0.4 }}>•</span>;
}
