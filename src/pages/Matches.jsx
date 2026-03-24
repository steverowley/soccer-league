// ── Matches.jsx ───────────────────────────────────────────────────────────────
// ISL Matches page — league-organised fixture selector.
//
// LAYOUT
// ──────
//   H1: OUR ELECTRIFYING MATCHES
//   ─────────────────────────────
//   [Rocky Inner] [Gas/Ice Giants] [Outer Reaches] [Kuiper Belt]  ← league tabs
//
//   ┌──────────────────────────────────────────────────────────────┐
//   │ Rocky Inner League                                           │
//   │                                                              │
//   │  Home Team   [dropdown ▾]   Away Team   [dropdown ▾]        │
//   │                                                              │
//   │  [SIMULATE MATCH]   ← active only when both teams are picked │
//   │                       AND the pairing has roster data        │
//   │                                                              │
//   │  ── Featured Fixture ──────────────────────────────────────  │
//   │  [Mars United vs Saturn Rings FC]  ← always available        │
//   └──────────────────────────────────────────────────────────────┘
//
// SIMULATION AVAILABILITY
// ───────────────────────
// The full MatchSimulator requires a complete player roster (5 attributes per
// player, 15-player squads) that currently only exists for two clubs:
//   mars    → "Mars United"    (teams.js key)
//   saturn  → "Saturn Rings FC" / leagueData id 'saturn-rings'
//
// SIMULATABLE_PAIRS defines all team-key combinations that can run a live
// simulation.  When the user picks a pairing not in this list, the Simulate
// button shows a "coming soon" message instead of launching the engine.
//
// FEATURED FIXTURE
// ────────────────
// The "Mars United vs Saturn Rings FC" card is always visible in the Rocky
// Inner League tab regardless of the dropdown selection, so the main demo
// fixture remains accessible while users explore other matchups.
//
// BACK NAVIGATION
// ───────────────
// When a simulation is running, the league-selector header collapses and a
// ← Back button appears so the user can return to fixture selection without
// a full page reload.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '../components/ui/Button';
import MatchSimulator from '../App';
import { LEAGUES, TEAMS_BY_LEAGUE } from '../data/leagueData';

// ── Simulatable pairings ──────────────────────────────────────────────────────
// Set of leagueData team-id pairs that have full roster data in teams.js and
// can therefore run the live match simulator.  Stored as a Set of canonical
// "homeKey:awayKey" strings using the teams.js keys (not leagueData ids).
//
// To add a new simulatable team, add its leagueData id → teams.js key mapping
// to LEAGUE_ID_TO_TEAMS_KEY below, then the engine will automatically recognise
// any pairing involving it.
const LEAGUE_ID_TO_TEAMS_KEY = {
  // Currently only saturn-rings maps to a teams.js key ('saturn').
  // 'mars-athletic', 'olympus-mons', 'valles-mariners' are unmapped because
  // the simulator's "Mars United" (key: 'mars') predates the leagueData naming
  // and has no direct id counterpart yet.
  'saturn-rings': 'saturn',
};

/**
 * Returns the teams.js simulator key for a given leagueData team id, or null
 * if no full roster data exists for that club.
 *
 * @param {string} teamId - leagueData team id (e.g. 'saturn-rings')
 * @returns {string|null} teams.js key (e.g. 'saturn') or null
 */
function teamsKey(teamId) {
  return LEAGUE_ID_TO_TEAMS_KEY[teamId] ?? null;
}

// ── Featured fixture ──────────────────────────────────────────────────────────
// The canonical demo match always available in the Rocky Inner League section.
// Defined as a constant so it can be referenced in both the featured card and
// the "simulate" button logic without duplicating the key strings.
const FEATURED = { home: 'mars', away: 'saturn' };

// ── League id that hosts the featured fixture ─────────────────────────────────
// The featured Mars vs Saturn card only appears in the Rocky Inner League tab
// (where the saturn-rings club is located — Gas/Ice Giants).  Actually Saturn
// Rings is in gas-giants, so we show the featured fixture in BOTH league tabs
// since Mars teams are rocky-inner and Saturn is gas-giants.  We use a Set for
// O(1) membership checks.
const FEATURED_LEAGUES = new Set(['rocky-inner', 'gas-giants']);

/**
 * Matches page — league-organised fixture selector with live simulation.
 *
 * State:
 *   activeLeague {string}      — currently displayed league tab id
 *   homeId       {string|null} — selected home team's leagueData id
 *   awayId       {string|null} — selected away team's leagueData id
 *   simKeys      {object|null} — { home, away } teams.js keys when a sim is
 *                                running; null when the selector is shown
 *
 * @returns {JSX.Element}
 */
export default function Matches() {
  // ── League tab state ───────────────────────────────────────────────────────
  const [activeLeague, setActiveLeague] = useState(LEAGUES[0].id);

  // ── Team selection state ───────────────────────────────────────────────────
  // homeId / awayId track the leagueData team ids chosen from the dropdowns.
  // Reset whenever the active league changes so stale selections don't persist.
  const [homeId, setHomeId] = useState('');
  const [awayId, setAwayId] = useState('');

  // ── Active simulation state ────────────────────────────────────────────────
  // When non-null, the fixture selector is hidden and MatchSimulator is shown.
  // Stores { home, away } as teams.js keys (not leagueData ids).
  const [simKeys, setSimKeys] = useState(null);

  // ── League change handler ─────────────────────────────────────────────────
  // Resets team dropdowns when switching leagues so the previous selections
  // (which belong to a different league's team list) are cleared.
  function handleLeagueChange(leagueId) {
    setActiveLeague(leagueId);
    setHomeId('');
    setAwayId('');
  }

  // ── Simulation readiness check ─────────────────────────────────────────────
  // The Simulate button is active only when:
  //   1. Both dropdowns have a selection, AND
  //   2. Both selected teams have a teams.js roster key (i.e. full data exists)
  // If condition 1 is met but condition 2 is not, the button shows a "coming
  // soon" message rather than launching the engine with missing data.
  const homeKey = teamsKey(homeId);
  const awayKey = teamsKey(awayId);
  const bothSelected  = Boolean(homeId && awayId);
  const bothSimulatable = Boolean(homeKey && awayKey);

  // ── Launch handler ─────────────────────────────────────────────────────────
  function launchSim(home, away) {
    setSimKeys({ home, away });
  }

  // ── Back handler ──────────────────────────────────────────────────────────
  // Clears the running simulation and returns to the selector UI.
  function handleBack() {
    setSimKeys(null);
  }

  // ── Teams for the active league ────────────────────────────────────────────
  const leagueTeams = TEAMS_BY_LEAGUE[activeLeague] ?? [];

  // ── Currently active league record ────────────────────────────────────────
  const currentLeague = LEAGUES.find(l => l.id === activeLeague);

  // ── Simulation view ────────────────────────────────────────────────────────
  // When a match is running, replace the entire page content with the simulator
  // plus a back button.  Using a key derived from the team pairing ensures React
  // fully unmounts the old simulator if the user goes back and picks a new match.
  if (simKeys) {
    return (
      <div style={{ paddingTop: '24px', paddingBottom: '60px' }}>
        <div className="container">
          <button
            className="btn btn-primary"
            onClick={handleBack}
            style={{ marginBottom: '16px' }}
          >
            ← Back to Matches
          </button>
        </div>
        <MatchSimulator
          key={`${simKeys.home}-${simKeys.away}`}
          homeTeamKey={simKeys.home}
          awayTeamKey={simKeys.away}
        />
      </div>
    );
  }

  return (
    <div style={{ paddingTop: '40px', paddingBottom: '60px' }}>
      <div className="container">

        {/* ── Page hero ─────────────────────────────────────────────────────── */}
        <div className="page-hero" style={{ marginBottom: '32px' }}>
          <h1>Our Electrifying Matches</h1>
          <hr className="divider" style={{ maxWidth: '600px', margin: '0 auto 16px' }} />
          <p className="subtitle">
            Pick a league, choose your teams, and simulate a live ISL fixture.
          </p>
        </div>

        {/* ── League tabs ────────────────────────────────────────────────────── */}
        {/* Each tab switches the team pool for the fixture selector below.
            The active tab uses btn-primary; inactive tabs use btn-secondary
            so the selected league is clearly highlighted. */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '28px', justifyContent: 'center' }}>
          {LEAGUES.map(league => (
            <button
              key={league.id}
              className={`btn ${activeLeague === league.id ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => handleLeagueChange(league.id)}
            >
              {league.shortName}
            </button>
          ))}
        </div>

        {/* ── Fixture selector card ─────────────────────────────────────────── */}
        <div className="card" style={{ maxWidth: '640px', margin: '0 auto' }}>

          {/* ── League context header ───────────────────────────────────────── */}
          {/* Links back to the league's detail page so users can check
              standings before picking a fixture. */}
          <h2 style={{ fontSize: '16px', marginBottom: '20px' }}>
            <Link
              to={`/leagues/${activeLeague}`}
              style={{ color: 'inherit', textDecoration: 'none' }}
            >
              {currentLeague?.name} ›
            </Link>
          </h2>

          {/* ── Team selection dropdowns ─────────────────────────────────────── */}
          {/* Two selects side-by-side (stacked on narrow viewports via flex-wrap).
              Teams from the active league populate both lists.  The other
              dropdown's current selection is excluded to prevent home = away. */}
          <div
            style={{
              display: 'flex', gap: '16px', flexWrap: 'wrap',
              alignItems: 'flex-end', marginBottom: '20px',
            }}
          >
            {/* Home team */}
            <div style={{ flex: '1', minWidth: '180px' }}>
              <label style={{ fontSize: '11px', opacity: 0.6, display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Home Team
              </label>
              <select
                value={homeId}
                onChange={e => setHomeId(e.target.value)}
                style={selectStyle}
              >
                <option value="">Select team…</option>
                {leagueTeams
                  .filter(t => t.id !== awayId)
                  .map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
              </select>
            </div>

            {/* VS divider */}
            <div style={{ fontSize: '18px', opacity: 0.4, paddingBottom: '6px', flexShrink: 0 }}>vs</div>

            {/* Away team */}
            <div style={{ flex: '1', minWidth: '180px' }}>
              <label style={{ fontSize: '11px', opacity: 0.6, display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Away Team
              </label>
              <select
                value={awayId}
                onChange={e => setAwayId(e.target.value)}
                style={selectStyle}
              >
                <option value="">Select team…</option>
                {leagueTeams
                  .filter(t => t.id !== homeId)
                  .map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
              </select>
            </div>
          </div>

          {/* ── Team profile quick-links ─────────────────────────────────────── */}
          {/* When teams are selected, surface View Team links so users can
              check squad details before committing to the simulation. */}
          {(homeId || awayId) && (
            <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
              {homeId && (
                <Link to={`/teams/${homeId}`} style={{ fontSize: '12px', opacity: 0.7, textDecoration: 'underline' }}>
                  View {leagueTeams.find(t => t.id === homeId)?.name} →
                </Link>
              )}
              {awayId && (
                <Link to={`/teams/${awayId}`} style={{ fontSize: '12px', opacity: 0.7, textDecoration: 'underline' }}>
                  View {leagueTeams.find(t => t.id === awayId)?.name} →
                </Link>
              )}
            </div>
          )}

          {/* ── Simulate button / coming-soon message ───────────────────────── */}
          {/* Three states:
              1. Neither team selected   → disabled button (grey prompt)
              2. Both selected, simulatable  → active SIMULATE MATCH button
              3. Both selected, not simulatable → message + disabled button  */}
          {bothSelected && !bothSimulatable && (
            // ── Coming-soon notice ─────────────────────────────────────────
            // Shown when the user picks a valid pairing that doesn't yet have
            // full roster data.  Honest messaging prevents confusion.
            <p style={{ fontSize: '12px', opacity: 0.55, fontStyle: 'italic', marginBottom: '12px' }}>
              Full simulation for this fixture is coming soon — roster data for these clubs is still being finalised.
            </p>
          )}

          <button
            className="btn btn-tertiary"
            disabled={!bothSelected || !bothSimulatable}
            onClick={() => launchSim(homeKey, awayKey)}
            style={{ opacity: bothSelected && bothSimulatable ? 1 : 0.4, cursor: bothSelected && bothSimulatable ? 'pointer' : 'not-allowed' }}
          >
            Simulate Match
          </button>

          {/* ── Featured fixture divider ─────────────────────────────────────── */}
          {/* The canonical Mars vs Saturn demo is surfaced in both leagues that
              contain those clubs (Rocky Inner and Gas/Ice Giants) so it remains
              accessible regardless of which tab the user is on. */}
          {FEATURED_LEAGUES.has(activeLeague) && (
            <div style={{ marginTop: '24px' }}>
              <p style={{ fontSize: '11px', opacity: 0.4, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '12px' }}>
                — Featured Fixture —
              </p>

              <div
                className="card"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  display: 'flex', alignItems: 'center',
                  justifyContent: 'space-between', flexWrap: 'wrap',
                  gap: '12px', padding: '12px 16px',
                }}
              >
                <div>
                  {/* Team name pairing with brand-colour dots */}
                  <p style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '4px' }}>
                    <span style={{ color: '#FF4500' }}>●</span>
                    {' '}Mars United{' '}
                    <span style={{ opacity: 0.4 }}>vs</span>
                    {' '}Saturn Rings FC{' '}
                    <span style={{ color: '#9A5CF4' }}>●</span>
                  </p>
                  {/* Cross-links to each team's detail page */}
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <Link to="/teams/mars-athletic" style={{ fontSize: '11px', opacity: 0.6, textDecoration: 'underline' }}>
                      Mars Athletic ›
                    </Link>
                    <Link to="/teams/saturn-rings" style={{ fontSize: '11px', opacity: 0.6, textDecoration: 'underline' }}>
                      Saturn Rings FC ›
                    </Link>
                  </div>
                </div>

                <button
                  className="btn btn-primary"
                  onClick={() => launchSim(FEATURED.home, FEATURED.away)}
                >
                  Launch →
                </button>
              </div>
            </div>
          )}

        </div>

        {/* ── Browse teams prompt ──────────────────────────────────────────────── */}
        {/* Secondary navigation row gives users who arrived here without a
            specific match in mind an easy path to browse teams or leagues
            before picking a fixture. */}
        <div
          style={{
            display: 'flex', gap: '8px', justifyContent: 'center',
            flexWrap: 'wrap', marginTop: '32px',
          }}
        >
          <Link to="/teams">
            <Button variant="primary">Browse Teams</Button>
          </Link>
          <Link to="/leagues">
            <Button variant="primary">View Leagues</Button>
          </Link>
          <Link to="/players">
            <Button variant="primary">View Players</Button>
          </Link>
        </div>

      </div>
    </div>
  );
}

// ── selectStyle ───────────────────────────────────────────────────────────────
// Inline style object for the team-selection <select> elements.
// Defined outside the component to avoid a new object reference on every render.
// Uses CSS custom properties from index.css to stay consistent with the ISL
// dark theme without needing a dedicated Select component.
const selectStyle = {
  width: '100%',
  background: 'var(--color-surface, #1a1a1a)',
  color: 'var(--color-dust, #E3E0D5)',
  border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: '4px',
  padding: '8px 10px',
  fontSize: '13px',
  cursor: 'pointer',
};
