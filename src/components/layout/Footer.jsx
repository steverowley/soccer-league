// ── Footer.jsx ────────────────────────────────────────────────────────────────
// Site-wide footer matching the ISL design system spec.
//
// The mockup shows a minimal single-line footer:
//   © 2025 INTERGALACTIC SOCCER LEAGUE
//
// It sits below a top border rule and is separated from page content by
// a generous margin defined in index.css via the `.footer` class.

/**
 * Site-wide footer component.
 *
 * Renders the ISL copyright line in small uppercase monospace text,
 * consistent with the design system's footer specification.
 * The year is hard-coded to 2025 to match the brand guidelines document.
 *
 * @returns {JSX.Element}
 */
export default function Footer() {
  return (
    <footer className="footer">
      {/* Copyright line — matches "© 2025 INTERGALACTIC SOCCER LEAGUE" in mockup */}
      <span>© 2025 Intergalactic Soccer League</span>
    </footer>
  );
}
