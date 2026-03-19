// ── Matches.jsx ───────────────────────────────────────────────────────────────
// Matches page — hosts the existing MatchSimulator component inside the
// standard ISL page shell (Header + Footer + starfield background).
//
// The simulator was the original single-page app (App.jsx / MatchSimulator).
// By importing and rendering it here we preserve all existing match logic
// untouched while integrating it into the new multi-page routing structure.
//
// The simulator manages its own internal state completely; this page component
// is intentionally thin — it is purely a routing mount point.
//
// Future work: this page could accept query params (?home=mars&away=saturn)
// to pre-select teams, or could show an upcoming fixtures list and let the
// user click a fixture to launch the simulator for that match.

import MatchSimulator from '../App';

/**
 * Matches page — renders the ISL match simulator.
 *
 * Acts as a thin routing mount point for the MatchSimulator component that
 * was the original standalone app.  All simulator state and logic remain in
 * App.jsx / gameEngine.js unchanged.
 *
 * @returns {JSX.Element}
 */
export default function Matches() {
  return (
    // ── Simulator container ───────────────────────────────────────────────────
    // The simulator renders its own full-width layout internally, so we give
    // it a clean wrapper with no additional padding or constraints.
    // A top padding of 24px provides breathing room below the site header.
    <div style={{ paddingTop: '24px' }}>
      <MatchSimulator />
    </div>
  );
}
