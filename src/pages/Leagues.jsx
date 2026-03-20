// ── Leagues.jsx ───────────────────────────────────────────────────────────────
// The Intergalactic Leagues listing page.  Implements the mockup layout:
//
//   H1: INTERGALACTIC LEAGUES
//   ─────────────────────────────
//   Tagline subtitle
//
//   ┌───────────────────┐  ┌───────────────────┐
//   │ ROCKY INNER LEAGUE│  │ GAS/ICE GIANTS    │
//   │ Description...    │  │ Description...    │
//   │ [VIEW LEAGUE]     │  │ [VIEW LEAGUE]     │
//   └───────────────────┘  └───────────────────┘
//   ┌───────────────────┐  ┌───────────────────┐
//   │ OUTER REACHES     │  │ INTERSTELLAR      │
//   │ Description...    │  │ Description...    │
//   │ [VIEW LEAGUE]     │  │ [VIEW LEAGUE]     │
//   └───────────────────┘  └───────────────────┘
//
// The 2-column desktop grid collapses to 1 column on mobile.
// Each card links to /leagues/:leagueId for the League Detail page.

import { Link } from 'react-router-dom';
import Button from '../components/ui/Button';
import { LEAGUES } from '../data/leagueData';

/**
 * Intergalactic Leagues listing page.
 *
 * Renders all four ISL leagues as equal-height cards in a 2-column desktop
 * grid.  Each card displays the league name, description prose, and a
 * "VIEW LEAGUE" primary button that navigates to the league detail page.
 *
 * @returns {JSX.Element}
 */
export default function Leagues() {
  return (
    <div className="container" style={{ paddingTop: '40px', paddingBottom: '40px' }}>

      {/* ── Page hero ───────────────────────────────────────────────────────── */}
      <div className="page-hero" style={{ textAlign: 'center', marginBottom: '40px' }}>
        <h1>Intergalactic Leagues</h1>
        <hr className="divider" style={{ maxWidth: '600px', margin: '16px auto 16px' }} />
        <p className="subtitle">The most exciting soccer simulation game in the solar system!</p>
      </div>

      {/* ── League cards grid ───────────────────────────────────────────────── */}
      {/* 2-column desktop grid; each card stretches to the same height via
          `align-items: stretch` on the grid container so that pairs of cards
          always share the same bottom edge — matching the mockup. */}
      <div
        className="leagues-grid"
        style={{
          display: 'grid',
          // Two equal columns on desktop; single column on narrow viewports
          // via the .leagues-grid responsive rule in index.css.
          gridTemplateColumns: '1fr 1fr',
          gap: '24px',
        }}
      >
        {LEAGUES.map(league => (
          // ── Individual league card ─────────────────────────────────────────
          // flex column layout pushes the button to the bottom of the card
          // regardless of description length, keeping all rows visually aligned.
          <div
            key={league.id}
            className="card"
            style={{ display: 'flex', flexDirection: 'column' }}
          >
            {/* League name — H3 weight but sized to match the card heading
                level in the mockup (between H2 and body text). */}
            <h3 style={{ fontSize: '22px', marginBottom: '16px' }}>{league.name}</h3>

            {/* Description prose — grows to fill available card space so the
                button stays at the bottom even on cards with short text. */}
            <p style={{ fontSize: '14px', lineHeight: 1.7, opacity: 0.85, flex: 1, marginBottom: '24px' }}>
              {league.description}
            </p>

            {/* VIEW LEAGUE button — primary variant per the design spec.
                Wrapped in Link rather than using a button onClick so the
                navigation is accessible and crawlable. */}
            <div>
              <Link to={`/leagues/${league.id}`}>
                <Button variant="primary">View League</Button>
              </Link>
            </div>
          </div>
        ))}
      </div>

    </div>
  );
}
