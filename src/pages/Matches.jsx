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
//   │  [SIMULATE MATCH]   ← active when both teams are selected    │
//   │                                                              │
//   │  ── Featured Fixture ──────────────────────────────────────  │
//   │  [Mars Athletic vs Saturn Rings United]  ← always available  │
//   └──────────────────────────────────────────────────────────────┘
//
// SIMULATION FLOW
// ───────────────
// All 32 seeded teams can now be simulated.  When the user clicks "Simulate
// Match", launchSim() fetches both teams from Supabase via getTeamForEngine()
// (which returns players with full individual stats + manager name/style) and
// passes those objects directly to MatchSimulator as homeTeam / awayTeam props.
// The engine therefore uses live DB data: real manager names, real player
// rosters, and position-derived individual stats.
//
// FEATURED FIXTURE
// ────────────────
// "Mars Athletic vs Saturn Rings United" is surfaced in both the Rocky Inner
// and Gas/Ice Giants league tabs (the home leagues of each club) so the main
// demo fixture is always one click away regardless of which tab is active.
//
// BACK NAVIGATION
// ───────────────
// When a simulation is running the league-selector collapses and a ← Back
// button appears so the user can return to fixture selection without a reload.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '../components/ui/Button';
import MatchSimulator from '../App';
import { LEAGUES, TEAMS_BY_LEAGUE } from '../data/leagueData';
import { getTeamForEngine } from '../lib/supabase';

// ── Featured fixture ──────────────────────────────────────────────────────────
// The canonical demo pairing — Mars Athletic (rocky-inner) vs Saturn Rings
// United (gas-giants).  Both clubs have full seeded rosters and managers in the
// DB, so the featured button is always active and serves as the primary entry
// point for first-time visitors.
//
// IDs must match Supabase team slugs (teams.id column), which are identical to
// the leagueData.js team ids used for routing.
const FEATURED = { home: 'mars-athletic', away: 'saturn-rings' };

// ── League ids that host the featured fixture ─────────────────────────────────
// Show the featured card in both leagues that contain the featured clubs so
// visitors on either tab can reach it without switching.  Set for O(1) checks.
const FEATURED_LEAGUES = new Set(['rocky-inner', 'gas-giants']);

// ── selectStyle ───────────────────────────────────────────────────────────────
// Inline style object for the team-selection <select> elements.
// Defined at module scope to avoid a new object reference on every render.
// Uses CSS custom properties from index.css to stay consistent with the ISL
// dark theme without needing a dedicated Select component.
const selectStyle = {
  width: '100%',
  background: 'var(--color-ash)',
  color: 'var(--color-dust)',
  border: '1px solid rgba(227,224,213,0.2)',
  borderRadius: '4px',
  padding: '8px 10px',
  fontSize: '13px',
  cursor: 'pointer',
};

/**
 * Matches page — league-organised fixture selector with live simulation.
 *
 * STATE
 * ─────
 *   activeLeague  {string}      — currently displayed league tab id
 *   homeId        {string}      — selected home team's leagueData / Supabase id
 *   awayId        {string}      — selected away team's leagueData / Supabase id
 *   simTeams      {object|null} — { home, away } engine-format team objects when
 *                                 a sim is running; null when selector is shown
 *   fetchingTeams {boolean}     — true while getTeamForEngine() calls are in
 *                                 flight; disables the Simulate button to prevent
 *                                 double-clicks
 *   fetchError    {string|null} — set if the DB fetch fails so the user sees a
 *                                 message rather than a silent broken sim
 *
 * @returns {JSX.Element}
 */
export default function Matches() {
  // ── League tab state ───────────────────────────────────────────────────────
  const [activeLeague, setActiveLeague] = useState(LEAGUES[0].id);

  // ── Team selection state ───────────────────────────────────────────────────
  // homeId / awayId hold leagueData team ids (e.g. 'saturn-rings'), which are
  // identical to the Supabase team slug primary keys.  Reset on league change
  // so stale cross-league selections don't linger.
  const [homeId, setHomeId] = useState('');
  const [awayId, setAwayId] = useState('');

  // ── Active simulation state ────────────────────────────────────────────────
  // simTeams is non-null while a match is running.  It holds the two engine-
  // format team objects returned by getTeamForEngine() so MatchSimulator
  // receives live DB data (manager names, player rosters, individual stats).
  const [simTeams, setSimTeams]       = useState(null);
  const [fetchingTeams, setFetching]  = useState(false);
  const [fetchError, setFetchError]   = useState(null);

  // ── League change handler ─────────────────────────────────────────────────
  // Clear team dropdowns when switching leagues so the previous league's
  // selections (invalid for the new team pool) don't persist.
  function handleLeagueChange(leagueId) {
    setActiveLeague(leagueId);
    setHomeId('');
    setAwayId('');
  }

  // ── Readiness check ───────────────────────────────────────────────────────
  // The Simulate button is active only when both dropdowns have a selection.
  // Unlike the previous implementation there is no "coming soon" gate — every
  // team in the DB has a seeded roster with individual stats, so any pairing
  // can run a simulation.
  const bothSelected = Boolean(homeId && awayId);

  // ── Launch handler ────────────────────────────────────────────────────────
  // Fetches both teams from Supabase in parallel before starting the sim so
  // the engine receives the real manager name, real player list, and real
  // individual stats rather than falling back to the hardcoded teams.js stub.
  //
  // Error handling: if either fetch fails we surface a message and keep the
  // selector visible so the user can try again rather than silently entering a
  // broken sim with undefined team data.
  async function launchSim(homeTeamId, awayTeamId) {
    setFetching(true);
    setFetchError(null);
    try {
      const [home, away] = await Promise.all([
        getTeamForEngine(homeTeamId),
        getTeamForEngine(awayTeamId),
      ]);
      // ── Carry the Supabase team slugs alongside the engine-format objects ──
      // getTeamForEngine() strips the raw DB fields (id, created_at, etc.) to
      // keep the engine lean, so the slugs would otherwise be unreachable by
      // downstream consumers.  MatchSimulator needs them at kickoff to count
      // present fans (profiles.favourite_team_id = slug) for the Phase 3 fan
      // support boost and, when a fixture row exists, to key the
      // match_attendance insert.
      setSimTeams({ home, away, homeSlug: homeTeamId, awaySlug: awayTeamId });
    } catch (err) {
      setFetchError('Could not load team data — please try again.');
      console.error('launchSim fetch error:', err);
    } finally {
      setFetching(false);
    }
  }

  // ── Back handler ──────────────────────────────────────────────────────────
  // Clears the running simulation and returns to the selector UI.
  function handleBack() {
    setSimTeams(null);
  }

  // ── Teams for the active league ────────────────────────────────────────────
  const leagueTeams = TEAMS_BY_LEAGUE[activeLeague] ?? [];

  // ── Currently active league record ────────────────────────────────────────
  const currentLeague = LEAGUES.find(l => l.id === activeLeague);

  // ── Simulation view ────────────────────────────────────────────────────────
  // When a match is running, replace the entire page content with the simulator
  // and a ← Back button.  The key is derived from team names so React fully
  // unmounts the old simulator if the user returns and picks a different match.
  if (simTeams) {
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
          key={`${simTeams.home.name}-${simTeams.away.name}`}
          homeTeam={simTeams.home}
          awayTeam={simTeams.away}
          /*
           * Supabase team slugs — required for the Phase 3 fan support boost.
           * Without these the simulator falls back to zero-boost mode (no fan
           * count query, no attendance DB write).  matchId / seasonId are
           * intentionally omitted until fixture-scheduling integration lands
           * in a later phase; the simulator gracefully skips the attendance
           * write when either is absent.
           */
          homeTeamId={simTeams.homeSlug}
          awayTeamId={simTeams.awaySlug}
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
            Active tab uses btn-primary; inactive tabs use btn-secondary. */}
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
              Each list excludes the other dropdown's current selection to prevent
              a team playing itself. */}
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

          {/* ── Fetch error notice ───────────────────────────────────────────── */}
          {/* Shown if getTeamForEngine() throws (e.g. network issue or team not
              yet seeded).  Kept inline so the selector remains usable. */}
          {fetchError && (
            <p style={{ fontSize: '12px', color: 'var(--color-red)', marginBottom: '12px' }}>
              {fetchError}
            </p>
          )}

          {/* ── Simulate button ──────────────────────────────────────────────── */}
          {/* Disabled until both teams are selected or while the DB fetch is
              in flight (fetchingTeams).  All 32 seeded teams are simulatable
              so there is no longer a "coming soon" state. */}
          <button
            className="btn btn-tertiary"
            disabled={!bothSelected || fetchingTeams}
            onClick={() => launchSim(homeId, awayId)}
            style={{
              opacity: bothSelected && !fetchingTeams ? 1 : 0.4,
              cursor: bothSelected && !fetchingTeams ? 'pointer' : 'not-allowed',
            }}
          >
            {fetchingTeams ? 'Loading…' : 'Simulate Match'}
          </button>

          {/* ── Featured fixture divider ─────────────────────────────────────── */}
          {/* Surfaced in both Rocky Inner and Gas/Ice Giants tabs because the
              two clubs are in different leagues — this way the card is reachable
              regardless of which tab the user lands on. */}
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
                    {' '}Mars Athletic{' '}
                    <span style={{ opacity: 0.4 }}>vs</span>
                    {' '}Saturn Rings United{' '}
                    <span style={{ color: '#9A5CF4' }}>●</span>
                  </p>
                  {/* Cross-links to each team's detail page */}
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <Link to="/teams/mars-athletic" style={{ fontSize: '11px', opacity: 0.6, textDecoration: 'underline' }}>
                      Mars Athletic ›
                    </Link>
                    <Link to="/teams/saturn-rings" style={{ fontSize: '11px', opacity: 0.6, textDecoration: 'underline' }}>
                      Saturn Rings United ›
                    </Link>
                  </div>
                </div>

                <button
                  className="btn btn-primary"
                  disabled={fetchingTeams}
                  onClick={() => launchSim(FEATURED.home, FEATURED.away)}
                >
                  {fetchingTeams ? 'Loading…' : 'Launch →'}
                </button>
              </div>
            </div>
          )}

        </div>

        {/* ── Browse teams prompt ──────────────────────────────────────────────── */}
        {/* Secondary navigation row gives users an easy path to browse teams or
            leagues before picking a fixture. */}
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
