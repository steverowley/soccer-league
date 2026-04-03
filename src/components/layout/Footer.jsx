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
 * The year is derived at render time so it stays current without manual updates.
 *
 * @returns {JSX.Element}
 */
export default function Footer() {
  return (
    <footer className="footer">
      {/* Copyright line — year is dynamic so it never needs a manual bump. */}
      <span>© {new Date().getFullYear()} Intergalactic Soccer League</span>
    </footer>
  );
}
