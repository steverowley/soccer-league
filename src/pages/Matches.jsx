// ── Matches.jsx ───────────────────────────────────────────────────────────────
// Parent matches page — renders the ISL page hero and a 2×2 grid of live
// compact match cards.  Each card runs its own MatchSimulator instance in
// compact mode, auto-starting with a staggered delay so all four fixtures
// kick off a few seconds apart rather than simultaneously.
//
// Fixtures:
//   Mars vs Saturn  |  Earth vs Jupiter
//   Venus vs Neptune  |  Mercury vs Titan
//
// Clicking "View Full Match" on any card expands that fixture to the full
// single-match view (full MatchSimulator render) inline, replacing the grid.

import { useState } from 'react';
import MatchSimulator from '../App';

// ── Fixture definitions ────────────────────────────────────────────────────────
// Each entry maps to a compact MatchSimulator card in the 2×2 grid.
// startDelay (ms) staggers the auto kick-offs so they don't all fire at once.
const FIXTURES = [
  { id: 'mars-saturn',    homeTeamKey: 'mars',    awayTeamKey: 'saturn',  startDelay: 500  },
  { id: 'earth-jupiter',  homeTeamKey: 'earth',   awayTeamKey: 'jupiter', startDelay: 1500 },
  { id: 'venus-neptune',  homeTeamKey: 'venus',   awayTeamKey: 'neptune', startDelay: 2500 },
  { id: 'mercury-titan',  homeTeamKey: 'mercury', awayTeamKey: 'titan',   startDelay: 3500 },
];

/**
 * Matches page — ISL page hero + 2×2 grid of live compact match cards.
 *
 * State:
 *   expandedId — the fixture id currently shown in full view, or null for grid.
 *
 * @returns {JSX.Element}
 */
export default function Matches() {
  // ── Expanded match state ────────────────────────────────────────────────────
  // When set to a fixture id the full MatchSimulator view replaces the grid.
  // Null means show the 2×2 compact card grid.
  const [expandedId, setExpandedId] = useState(null);

  const expandedFixture = expandedId
    ? FIXTURES.find(f => f.id === expandedId)
    : null;

  return (
    <div style={{ paddingTop: '40px', paddingBottom: '60px' }}>

      {/* ── Page hero ───────────────────────────────────────────────────────── */}
      {/* Mirrors the hero pattern used on all other ISL pages:
          H1 → .divider HR → subtitle.  The paddingTop of 40px on the outer
          wrapper matches the container paddingTop used on Leagues and Teams so
          the hero sits at the same distance from the header divider. */}
      <div className="container">
        <div className="page-hero">
          <h1>Our Electrifying Matches</h1>
          <hr className="divider" style={{ maxWidth: '600px', margin: '0 auto 16px' }} />
          <p className="subtitle">Four simultaneous fixtures — live across the galaxy</p>
          {expandedFixture && (
            <button
              className="btn btn-primary"
              onClick={() => setExpandedId(null)}
              style={{ marginTop: '8px' }}
            >
              ← Back to All Matches
            </button>
          )}
        </div>
      </div>

      {/* ── Full match view (expanded) ─────────────────────────────────────── */}
      {expandedFixture && (
        <MatchSimulator
          key={expandedFixture.id}
          homeTeamKey={expandedFixture.homeTeamKey}
          awayTeamKey={expandedFixture.awayTeamKey}
        />
      )}

      {/* ── 2×2 compact card grid ──────────────────────────────────────────── */}
      {!expandedFixture && (
        <div className="container">
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '24px',
          }}>
            {FIXTURES.map(fixture => (
              <MatchSimulator
                key={fixture.id}
                homeTeamKey={fixture.homeTeamKey}
                awayTeamKey={fixture.awayTeamKey}
                compact={true}
                autoStart={true}
                startDelay={fixture.startDelay}
                onExpand={() => setExpandedId(fixture.id)}
              />
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
