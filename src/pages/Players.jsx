// ── Players.jsx ───────────────────────────────────────────────────────────────
// Full player roster browser for the ISL.
//
// LAYOUT
// ──────
//   H1: PLAYERS
//   ────────────────────────────────────────
//   Filter tabs: [All] [Rocky Inner] [Gas/Ice Giants] [Outer Reaches] [Kuiper Belt]
//
//   Rocky Inner League  ← section heading (links to /leagues/rocky-inner)
//     Mercury Runners FC  ·  Location: Mercury  ·  [View Team →]
//       Roster pending —  (placeholder row — no detailed data yet)
//     …
//     Saturn Rings FC  ·  Location: Saturn Rings  ·  [View Team →]
//       Eon Vasquez   GK  ★ Starter  DEF 84
//       Nora Blaze    DF  ★ Starter  DEF 86
//       …
//
// DATA SOURCES
// ────────────
//   - LEAGUES / TEAMS_BY_LEAGUE from leagueData.js  — all 28 ISL clubs
//   - TEAMS from teams.js                           — full rosters for Mars United
//                                                     and Saturn Rings FC only
//
// ROSTER MATCHING
// ───────────────
// teams.js keys ('mars', 'saturn') are matched to leagueData team ids via the
// ROSTER_MAP constant below.  'saturn-rings' matches by name; 'mars' has no
// direct leagueData counterpart (the simulator team "Mars United" predates the
// final leagueData naming) so it is currently unmapped and shows the pending row.
//
// QUERY PARAM FILTER
// ──────────────────
// /players?league=gas-giants  → pre-selects the Gas/Ice Giants filter tab.
// This lets league/team pages deep-link into the Players page already filtered
// to the relevant division.

import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Button from '../components/ui/Button';
import { LEAGUES, TEAMS_BY_LEAGUE } from '../data/leagueData';
import TEAMS from '../teams';

// ── Roster map ────────────────────────────────────────────────────────────────
// Maps leagueData team ids to teams.js keys where a full player roster exists.
// When a leagueData id appears here, its team section expands to show individual
// player rows; all other teams display a "roster pending" placeholder instead.
//
// Only 'saturn-rings' is mapped for now — its name "Saturn Rings FC" and colour
// match teams.js 'saturn' exactly.  The simulator's "Mars United" has no direct
// leagueData counterpart yet, so Mars league teams remain pending.
const ROSTER_MAP = {
  'saturn-rings': 'saturn',
};

// ── Position primary-stat key ─────────────────────────────────────────────────
// For each position, we surface the most meaningful attribute in the compact
// player row so the roster browser gives an at-a-glance skill read without
// needing to show all five attributes.
//   GK → defending  (shot-stopping is the critical keeper stat)
//   DF → defending  (tackling / blocking)
//   MF → technical  (passing / dribbling — midfield's core output)
//   FW → attacking  (finishing — the forward's primary contribution)
const POSITION_STAT = {
  GK: { key: 'defending', label: 'DEF' },
  DF: { key: 'defending', label: 'DEF' },
  MF: { key: 'technical',  label: 'TEC' },
  FW: { key: 'attacking',  label: 'ATK' },
};

// ── Filter tab id for "show all leagues" ──────────────────────────────────────
// Using a dedicated sentinel value (rather than null or '') makes comparisons
// explicit and avoids falsy-check bugs when the league id could be any string.
const ALL_LEAGUES = 'all';

/**
 * Players listing page.
 *
 * Renders a browsable roster across all ISL clubs, grouped by league.
 * A filter tab row lets users narrow the view to a single division.
 * Teams with full roster data (currently Saturn Rings FC only) expand to show
 * individual player rows; all others display a "roster pending" placeholder.
 *
 * Reads an optional `?league=<leagueId>` query param on mount to pre-select
 * the corresponding filter tab — allows deep-linking from league and team pages.
 *
 * @returns {JSX.Element}
 */
export default function Players() {
  // ── Query-param pre-selection ──────────────────────────────────────────────
  // If the user arrives via /players?league=gas-giants (e.g. from a team page's
  // "View Players" button), initialise the filter to that league so they land
  // directly in the relevant division rather than having to find it manually.
  const [searchParams] = useSearchParams();
  const initialLeague = searchParams.get('league') ?? ALL_LEAGUES;

  // ── Filter state ───────────────────────────────────────────────────────────
  // Tracks which league tab is active.  ALL_LEAGUES shows every division;
  // any other value hides all other league sections.
  const [activeLeague, setActiveLeague] = useState(initialLeague);

  // ── Filtered league list ───────────────────────────────────────────────────
  // When a specific league is selected we still pass the full LEAGUES array to
  // the renderer but let it skip non-matching sections, so the section heading
  // structure is preserved even in filtered view.
  const visibleLeagues = activeLeague === ALL_LEAGUES
    ? LEAGUES
    : LEAGUES.filter(l => l.id === activeLeague);

  return (
    <div className="container" style={{ paddingTop: '40px', paddingBottom: '60px' }}>

      {/* ── Page hero ─────────────────────────────────────────────────────────── */}
      <div style={{ textAlign: 'center', marginBottom: '32px' }}>
        <h1>Players</h1>
        <hr className="divider" style={{ maxWidth: '500px', margin: '16px auto 16px' }} />
        <p style={{ fontSize: '14px', opacity: 0.7 }}>
          Browse all ISL squads across every division.
        </p>
      </div>

      {/* ── League filter tabs ────────────────────────────────────────────────── */}
      {/* Inline tab strip — each button toggles the activeLeague state.  The
          active tab uses the primary variant for visual contrast; inactive tabs
          use the tertiary (flat) variant to stay recessed.
          "All" resets to ALL_LEAGUES sentinel so every section is visible. */}
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
        {LEAGUES.map(league => (
          <button
            key={league.id}
            className={`btn ${activeLeague === league.id ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveLeague(league.id)}
          >
            {league.shortName}
          </button>
        ))}
      </div>

      {/* ── League sections ───────────────────────────────────────────────────── */}
      {visibleLeagues.map(league => {
        const teams = TEAMS_BY_LEAGUE[league.id];
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
// either the full player list (if roster data exists) or a pending placeholder.
// Not exported — only meaningful within this page.

/**
 * Single team roster card within the Players page.
 *
 * Checks ROSTER_MAP to determine whether a full player list is available
 * for this team.  If yes, renders a compact player row for each squad member.
 * If no, renders a single "Full roster details coming soon" placeholder row.
 *
 * @param {{ id: string, name: string, location: string, color: string }} team
 *   Team record from TEAMS_BY_LEAGUE.
 * @returns {JSX.Element}
 */
function TeamRosterCard({ team }) {
  // ── Roster resolution ─────────────────────────────────────────────────────
  // Look up whether this leagueData team id has a matching teams.js key.
  // If so, pull the full player array; otherwise leave players as null so the
  // pending placeholder renders instead.
  const teamsJsKey = ROSTER_MAP[team.id];
  const rosterData = teamsJsKey ? TEAMS[teamsJsKey] : null;
  const players    = rosterData?.players ?? null;

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
        // Starters are listed before bench players (teams.js defines them in
        // that order).  A subtle divider separates the two groups.
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
            <span style={{ textAlign: 'right' }}>Stat</span>
          </div>

          {/* Player rows — starters first, then bench (natural array order) */}
          {players.map((player, idx) => (
            <PlayerRow key={idx} player={player} />
          ))}
        </div>
      ) : (
        // ── Pending placeholder ────────────────────────────────────────────
        // Shown for all teams without a teams.js roster entry.  The message
        // is honest about state without blocking page utility.
        <p style={{ fontSize: '12px', opacity: 0.45, fontStyle: 'italic', marginTop: '8px' }}>
          Full roster details coming soon.
        </p>
      )}

    </div>
  );
}

// ── PlayerRow ─────────────────────────────────────────────────────────────────
// Compact single-player display row used inside TeamRosterCard.
// Shows name, position badge, starter/bench role, and the position's primary
// stat value.  A subtle separator line runs between starters and bench players.

/**
 * Single player row within a team's roster card.
 *
 * Displays: player name · position badge · starter/bench label · primary stat.
 * The primary stat is position-dependent (GK/DF → DEF, MF → TEC, FW → ATK)
 * as defined by POSITION_STAT.
 *
 * A slightly stronger divider is drawn above the first bench player (index 11,
 * since starters are always indices 0-10 in teams.js) to visually separate the
 * first-eleven from the substitutes without needing a separate section heading.
 *
 * @param {{ name: string, position: string, starter: boolean,
 *            attacking: number, defending: number, mental: number,
 *            athletic: number, technical: number }} player
 *   Player object from teams.js players array.
 * @param {number} idx  — Array index used to detect the bench boundary (index 11).
 * @returns {JSX.Element}
 */
function PlayerRow({ player }) {
  const statDef  = POSITION_STAT[player.position] ?? { key: 'attacking', label: 'ATK' };
  const statVal  = player[statDef.key];

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
        // Bench players are rendered at reduced opacity (0.65 vs 1.0 for
        // starters) to reflect their substitute status without hiding them.
        opacity: player.starter ? 1 : 0.65,
      }}
    >
      {/* Player name */}
      <span>{player.name}</span>

      {/* Position badge */}
      <span
        style={{
          fontSize: '10px',
          fontWeight: 'bold',
          letterSpacing: '0.06em',
          opacity: 0.7,
        }}
      >
        {player.position}
      </span>

      {/* Starter / Bench label */}
      <span style={{ fontSize: '10px', opacity: 0.5 }}>
        {player.starter ? '★ Starter' : 'Bench'}
      </span>

      {/* Primary stat value — right-aligned to match table conventions */}
      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        <span style={{ fontSize: '10px', opacity: 0.5 }}>{statDef.label} </span>
        {statVal}
      </span>
    </div>
  );
}
