// ── Players.jsx ───────────────────────────────────────────────────────────────
// Full player roster browser for the ISL.
//
// LAYOUT
// ──────
//   H1: PLAYERS
//   ────────────────────────────────────────
//   Filter tabs: [All] [RIL] [GGL] [ORL] [KBL]
//
//   Rocky Inner League  ← section heading (links to /leagues/rocky-inner)
//     Mercury Runners FC  ·  Location: Mercury  ·  [View Team →]
//       Eon Vasquez   GK  ★ Starter  OVR 84
//       Nora Blaze    DF  ★ Starter  OVR 86
//       …
//
// DATA SOURCES
// ────────────
//   - Leagues + teams + players → Supabase (all fetched on mount via
//     getTeams(null, true) which returns nested players arrays per team)
//
// STAT DISPLAY
// ────────────
// The DB players table stores a single overall_rating (integer 65–90) rather
// than the five per-position simulator stats in teams.js.  All player rows
// therefore display "OVR <rating>" regardless of position — a deliberate
// simplification until per-attribute data is stored in the DB.
//
// QUERY PARAM FILTER
// ──────────────────
// /players?league=gas-giants  → pre-selects the Gas/Ice Giants filter tab.
// This lets league/team pages deep-link into the Players page already filtered
// to the relevant division.

import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Button from '../components/ui/Button';
import { getLeagues, getTeams, normalizeTeam, normalizeLeague } from '../lib/supabase';

// ── Filter tab sentinel value ─────────────────────────────────────────────────
// Using a dedicated constant (rather than null or '') makes comparisons
// explicit and avoids falsy-check bugs when the league id could be any string.
const ALL_LEAGUES = 'all';

/**
 * Players listing page.
 *
 * Fetches all leagues and teams from Supabase on mount, then renders a
 * browsable roster across all ISL clubs grouped by league.  A filter tab row
 * lets users narrow the view to a single division.
 *
 * Teams with full roster data in teams.js (currently Saturn Rings FC only)
 * expand to show individual player rows; all others display a "roster pending"
 * placeholder until the DB players table is populated.
 *
 * Reads an optional `?league=<leagueId>` query param on mount to pre-select
 * the corresponding filter tab — allows deep-linking from league and team pages.
 *
 * @returns {JSX.Element}
 */
export default function Players() {
  // ── Query-param pre-selection ──────────────────────────────────────────────
  // If the user arrives via /players?league=gas-giants (e.g. from a team
  // page's "View Players" button), initialise the filter to that league so
  // they land directly in the relevant division.
  const [searchParams] = useSearchParams();
  const initialLeague  = searchParams.get('league') ?? ALL_LEAGUES;

  // ── Filter state ───────────────────────────────────────────────────────────
  const [activeLeague, setActiveLeague] = useState(initialLeague);

  // ── Data fetch ────────────────────────────────────────────────────────────
  // Fetch leagues (for filter tabs and section headings) and all teams in one
  // Promise.all to minimise round-trips.  normalizeLeague() adds the shortName
  // alias used by the filter tab labels; normalizeTeam() adds homeGround /
  // leagueId aliases used by TeamRosterCard.
  const [leagues,       setLeagues]       = useState([]);
  const [teamsByLeague, setTeamsByLeague] = useState({});
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState(false);

  useEffect(() => {
    // ── Parallel fetch: leagues + teams with nested players ────────────────
    // withPlayers=true causes getTeams() to JOIN the players table so each
    // team object arrives with a team.players[] array pre-attached, avoiding
    // a subsequent per-team round-trip.  League rows are fetched in the same
    // Promise.all to minimise total latency.
    Promise.all([getLeagues(), getTeams(null, true)])
      .then(([leagueRows, teamRows]) => {
        // ── Group normalised teams by league_id ────────────────────────────
        // Build leagueId → team[] map so the render loop can look up each
        // league's clubs in O(1).
        const grouped = {};
        teamRows.forEach(t => {
          const lid = t.league_id;
          if (!grouped[lid]) grouped[lid] = [];
          grouped[lid].push(normalizeTeam(t));
        });
        setLeagues(leagueRows.map(normalizeLeague));
        setTeamsByLeague(grouped);
        setLoading(false);
      })
      .catch((err) => {
        console.error('[ISL] Players fetch failed:', err);
        setError(true);
        setLoading(false);
      });
  }, []); // empty deps: run once on mount

  // ── Filtered league list ───────────────────────────────────────────────────
  // When a specific league tab is active we filter to just that league.
  // The full leagues array drives the tab strip regardless of the active tab.
  const visibleLeagues = activeLeague === ALL_LEAGUES
    ? leagues
    : leagues.filter(l => l.id === activeLeague);

  return (
    <div className="container" style={{ paddingTop: '40px', paddingBottom: '60px' }}>

      {/* ── Page hero ─────────────────────────────────────────────────────────── */}
      <div className="page-hero">
        <h1>Players</h1>
        <hr className="divider" style={{ maxWidth: '500px', margin: '16px auto 16px' }} />
        <p className="subtitle">Browse all ISL squads across every division.</p>
      </div>

      {/* ── Loading / error states ──────────────────────────────────────────── */}
      {loading && (
        <p style={{ textAlign: 'center', opacity: 0.5, fontSize: '14px', marginBottom: '32px' }}>
          Loading players…
        </p>
      )}
      {error && (
        <p style={{ textAlign: 'center', opacity: 0.5, fontSize: '14px', marginBottom: '32px' }}>
          Could not load data. Please try again later.
        </p>
      )}

      {/* ── League filter tabs ────────────────────────────────────────────────── */}
      {/* Rendered once leagues have loaded so the shortName labels are correct.
          The active tab uses the primary variant for visual contrast; inactive
          tabs use the secondary (outlined) variant to stay recessed.
          "All" resets to ALL_LEAGUES sentinel so every section is visible. */}
      {!loading && !error && (
        <div
          style={{
            display: 'flex', gap: '8px', flexWrap: 'wrap',
            marginBottom: '32px', justifyContent: 'center',
          }}
        >
          <button
            className={`btn ${activeLeague === ALL_LEAGUES ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveLeague(ALL_LEAGUES)}
          >
            All
          </button>
          {leagues.map(league => (
            <button
              key={league.id}
              className={`btn ${activeLeague === league.id ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveLeague(league.id)}
            >
              {league.shortName}
            </button>
          ))}
        </div>
      )}

      {/* ── League sections ───────────────────────────────────────────────────── */}
      {!loading && !error && visibleLeagues.map(league => {
        const teams = teamsByLeague[league.id];
        if (!teams || teams.length === 0) return null;

        return (
          <section key={league.id} className="section">

            {/* ── League heading — links to /leagues/:id ────────────────────── */}
            {/* Linking the heading makes every section header a direct entry
                point to that league's full standings + player-stat tables. */}
            <h2 className="section-title" style={{ marginBottom: '16px' }}>
              <Link
                to={`/leagues/${league.id}`}
                style={{ color: 'inherit', textDecoration: 'none' }}
              >
                {league.name} ›
              </Link>
            </h2>

            {/* ── Team cards ───────────────────────────────────────────────── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {teams.map(team => (
                <TeamRosterCard key={team.id} team={team} />
              ))}
            </div>

          </section>
        );
      })}

    </div>
  );
}

// ── TeamRosterCard ─────────────────────────────────────────────────────────────
// Internal sub-component for a single team's roster block.
// Shows the team header row (name, location, View Team button) followed by
// the full player list fetched from Supabase (starters first, then bench,
// sorted by overall_rating descending within each group).
// Not exported — only meaningful within this page.

/**
 * Single team roster card within the Players page.
 *
 * Renders the team's header (name, location, View Team button) and the full
 * 16-player squad sourced directly from `team.players` (populated by
 * getTeams(null, true)).  Players are sorted starters-first, then by
 * overall_rating descending so the best players appear at the top of each
 * group.  Falls back to a "roster pending" placeholder if the players array
 * is empty or absent (e.g. if a team was added to the DB but not yet seeded).
 *
 * @param {{ id: string, name: string, location: string, color: string,
 *            players: Array }} team
 *   Normalised team record from Supabase including nested players[].
 * @returns {JSX.Element}
 */
function TeamRosterCard({ team }) {
  // ── Roster resolution ─────────────────────────────────────────────────────
  // Sort starters before bench (true > false numerically), then by
  // overall_rating descending within each group so the strongest players
  // appear first.  We spread to avoid mutating the original array from state.
  const players = team.players?.length > 0
    ? [...team.players].sort((a, b) =>
        b.starter - a.starter || b.overall_rating - a.overall_rating
      )
    : null;

  return (
    <div className="card" style={{ padding: '16px' }}>

      {/* ── Team header row ─────────────────────────────────────────────────── */}
      {/* Flexbox row: team name + location on the left, View Team button right.
          The left-side accent bar uses the team's brand colour for instant
          visual identification without requiring logo assets. */}
      <div
        style={{
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px',
          marginBottom: players ? '12px' : '0',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Brand-colour accent bar — 4px wide × 28px tall */}
          <div
            style={{
              width: '4px', height: '28px', borderRadius: '2px',
              background: team.color ?? 'var(--color-dust)',
              flexShrink: 0,
            }}
          />
          <div>
            <h3 style={{ fontSize: '14px', marginBottom: '2px' }}>{team.name}</h3>
            <p style={{ fontSize: '11px', opacity: 0.6 }}>{team.location}</p>
          </div>
        </div>

        <Link to={`/teams/${team.id}`}>
          <Button variant="primary">View Team →</Button>
        </Link>
      </div>

      {/* ── Player list or pending placeholder ─────────────────────────────── */}
      {players ? (
        // ── Full roster ───────────────────────────────────────────────────
        // Starters appear first (sorted by the TeamRosterCard resolver above),
        // then bench players at reduced opacity.  A column header row labels
        // each field.
        <div>
          {/* Column header row */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 40px 60px 40px',
              gap: '8px', padding: '4px 0',
              borderBottom: '1px solid rgba(255,255,255,0.12)',
              fontSize: '10px', opacity: 0.5,
              textTransform: 'uppercase', letterSpacing: '0.08em',
            }}
          >
            <span>Name</span>
            <span>Pos</span>
            <span>Role</span>
            <span style={{ textAlign: 'right' }}>OVR</span>
          </div>

          {/* Player rows — starters first (sorted above), then bench.
              Key on player.id (DB UUID) rather than array index so React
              correctly reconciles rows if the roster order changes. */}
          {players.map((player) => (
            <PlayerRow key={player.id} player={player} />
          ))}
        </div>
      ) : (
        // ── Pending placeholder ────────────────────────────────────────────
        // Shown when a team has no players seeded in the DB yet.
        <p style={{ fontSize: '12px', opacity: 0.45, fontStyle: 'italic', marginTop: '8px' }}>
          Full roster details coming soon.
        </p>
      )}

    </div>
  );
}

// ── PlayerRow ─────────────────────────────────────────────────────────────────
// Compact single-player display row used inside TeamRosterCard.
// Shows name, position badge, starter/bench role, and the player's overall
// rating.  Bench players are dimmed to visually separate them from starters.
//
// The DB stores a single overall_rating (65–90) rather than per-attribute
// simulator stats, so we display "OVR" for all positions.  When individual
// attribute data is added to the DB this component can be updated to surface
// the position-specific primary stat (DEF/TEC/ATK) as before.

/**
 * Single player row within a team's roster card.
 *
 * Displays: player name · position badge · starter/bench label · OVR rating.
 * Uses `player.overall_rating` from the DB (integer 65–90) for the stat
 * column since the DB does not yet store per-attribute values.
 *
 * Bench players render at reduced opacity (0.65) to reflect substitute status
 * without hiding them from view.
 *
 * @param {{ name: string, position: string, starter: boolean,
 *            overall_rating: number }} player
 *   Player object from the Supabase players table.
 * @returns {JSX.Element}
 */
function PlayerRow({ player }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 40px 60px 40px',
        gap: '8px',
        padding: '6px 0',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        fontSize: '12px',
        // ── Bench dimming ───────────────────────────────────────────────────
        // 0.65 opacity for bench; 1.0 for starters — subtle enough to not
        // hide the player while clearly signalling their squad role.
        opacity: player.starter ? 1 : 0.65,
      }}
    >
      {/* Name links to the player's individual profile page (/players/:id) */}
      <Link
        to={`/players/${player.id}`}
        style={{
          color: 'inherit',
          textDecoration: 'underline',
          textDecorationColor: 'rgba(255,255,255,0.3)',
        }}
      >
        {player.name}
      </Link>

      <span style={{ fontSize: '10px', fontWeight: 'bold', letterSpacing: '0.06em', opacity: 0.7 }}>
        {player.position}
      </span>

      <span style={{ fontSize: '10px', opacity: 0.5 }}>
        {player.starter ? '★ Starter' : 'Bench'}
      </span>

      {/* Overall rating — right-aligned to match table conventions.
          OVR is the single composite skill value stored in the DB (65–90). */}
      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        <span style={{ fontSize: '10px', opacity: 0.5 }}>OVR </span>
        {player.overall_rating}
      </span>
    </div>
  );
}
