// ── Matches.jsx ───────────────────────────────────────────────────────────────
// Static holding page for the ISL matches section.
//
// The full 2×2 live-simulation grid has been temporarily replaced with a
// holding page to avoid running four MatchSimulator instances on load (each
// of which spins up game-engine state, timers, and optional AI agents).
//
// A single "Mars vs Saturn" button lets testers jump directly into that
// fixture without triggering any of the other simulations.
//
// When the full matches listing is ready, restore the 2×2 grid from git
// history and re-import the FIXTURES array.

import { useState } from 'react';
import MatchSimulator from '../App';

/**
 * Matches — static holding page with a single test fixture link.
 *
 * State:
 *   showMatch {boolean} — when true, renders the Mars vs Saturn MatchSimulator
 *                         below the hero; when false, only the hero is shown.
 *
 * No simulations run on mount.  The MatchSimulator is only instantiated after
 * the user explicitly clicks the "Mars vs Saturn" button, keeping the page
 * completely inert until then.
 *
 * @returns {JSX.Element}
 */
export default function Matches() {
  // ── Expanded match state ──────────────────────────────────────────────────
  // Controls whether the Mars vs Saturn MatchSimulator is mounted.
  // Kept as a simple boolean because only one fixture is available here.
  const [showMatch, setShowMatch] = useState(false);

  return (
    <div style={{ paddingTop: '40px', paddingBottom: '60px' }}>

      {/* ── Page hero ─────────────────────────────────────────────────────── */}
      {/* Mirrors the hero pattern used on all other ISL pages:
          H1 → .divider HR → subtitle.  The paddingTop of 40px on the outer
          wrapper matches the container paddingTop used on Leagues and Teams. */}
      <div className="container">
        <div className="page-hero">
          <h1>Our Electrifying Matches</h1>
          <hr className="divider" style={{ maxWidth: '600px', margin: '0 auto 16px' }} />
          <p className="subtitle">Full match listings coming soon.</p>

          {/* ── Navigation button ───────────────────────────────────────── */}
          {/* When the match is open, show a Back button to dismiss it.
              When closed, show the Mars vs Saturn entry point.
              No other fixtures are exposed here while the page is static. */}
          {showMatch ? (
            <button
              className="btn btn-primary"
              onClick={() => setShowMatch(false)}
              style={{ marginTop: '8px' }}
            >
              ← Back to Matches
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={() => setShowMatch(true)}
              style={{ marginTop: '16px' }}
            >
              Mars vs Saturn
            </button>
          )}
        </div>
      </div>

      {/* ── Full match view ───────────────────────────────────────────────── */}
      {/* Only mounted when showMatch is true — avoids running the game engine
          and any AI agents until the user explicitly requests the fixture.
          The key prop is static ('mars-saturn') so React never accidentally
          remounts the simulator while it is visible. */}
      {showMatch && (
        <MatchSimulator
          key="mars-saturn"
          homeTeamKey="mars"
          awayTeamKey="saturn"
        />
      )}

    </div>
  );
}
