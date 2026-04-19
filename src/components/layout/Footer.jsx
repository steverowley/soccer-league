// ── Footer.jsx ────────────────────────────────────────────────────────────────
// Site-wide footer matching the ISL design system spec.
//
// Layout (two-column flex row):
//   LEFT  — ISL shield logo + "Intergalactic Soccer League — EST. Solar Cycle 2401"
//   RIGHT — secondary nav links (Leagues, Teams, Players, Matches)
//
// Sits below a 1px Lunar Dust @ 15% alpha top-border.  All text is 11px Space
// Mono uppercase at 40% alpha — intentionally de-emphasised so it never
// competes with page content above.

import { Link } from 'react-router-dom';

// ── Secondary nav links shown in the footer ────────────────────────────────────
// Subset of the main nav — profile, voting, and training are omitted because
// they are auth-gated and less discoverable from the footer.
const FOOTER_LINKS = [
  { label: 'Leagues',  to: '/leagues' },
  { label: 'Teams',    to: '/teams' },
  { label: 'Players',  to: '/players' },
  { label: 'Matches',  to: '/matches' },
];

/**
 * Site-wide footer component.
 *
 * Renders a two-column row: the ISL logo and establishment text on the left;
 * secondary navigation links on the right.  Uses the same Lunar Dust 40%-alpha
 * muted text as specified in the ISL design system footer spec.
 *
 * @returns {JSX.Element}
 */
export default function Footer() {
  return (
    <footer
      style={{
        borderTop: '1px solid rgba(227,224,213,0.15)',
        padding: '20px var(--space-8)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontFamily: 'var(--font-mono)',
      }}
    >
      {/* ── Left: logo + establishment text ──────────────────────────────────── */}
      {/* The logo uses the same SVG file as the header but at 28px — small
          enough for a footer mark without competing with the header's larger
          version.  Text is 11px / 0.06em tracking to match the retro ticket-tape
          aesthetic specified for footer copy. */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <img
          src={`${import.meta.env.BASE_URL}isl-logo.svg`}
          alt="ISL"
          style={{ width: 28, height: 'auto', display: 'block' }}
        />
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'rgba(227,224,213,0.4)',
          }}
        >
          Intergalactic Soccer League — Est. Solar Cycle 2401
        </span>
      </div>

      {/* ── Right: secondary nav links ────────────────────────────────────────── */}
      {/* Plain text links — no active state needed in the footer.  Gap of 20px
          matches --space-5 on the spacing scale (nearest 4-multiple). */}
      <nav style={{ display: 'flex', gap: 20 }}>
        {FOOTER_LINKS.map(({ label, to }) => (
          <Link
            key={to}
            to={to}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'rgba(227,224,213,0.4)',
              textDecoration: 'none',
              transition: 'color var(--transition-fast)',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'rgba(227,224,213,0.7)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'rgba(227,224,213,0.4)'; }}
          >
            {label}
          </Link>
        ))}
      </nav>
    </footer>
  );
}
