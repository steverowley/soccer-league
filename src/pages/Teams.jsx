// ── Teams.jsx ─────────────────────────────────────────────────────────────────
// The "Our Heroic Teams" listing page.  Implements the mockup layout:
//
//   H1: OUR HEROIC TEAMS
//   ─────────────────────────────
//   Subtitle
//
//   ROCKY INNER LEAGUE          ← league group heading
//   ┌──────────────┐  ┌──────────────┐
//   │ MERCURY …    │  │ EARTH …      │   ← 2-column team cards
//   │ LOCATION: …  │  │ LOCATION: …  │
//   │ HOME GROUND:…│  │ HOME GROUND:…│
//   │ CAPACITY: …  │  │ CAPACITY: …  │
//   │ Tagline text │  │ Tagline text │
//   │ [VIEW TEAM]  │  │ [VIEW TEAM]  │
//   └──────────────┘  └──────────────┘
//   … (more pairs)
//
//   GAS/ICE GIANT LEAGUE        ← next group heading
//   … (more cards)
//
// Teams are grouped by league section.  The league group headings use the
// same section-title style as other pages.  Each team card shows the
// structured metadata (Location, Home Ground, Capacity) in bold-label format
// matching the mockup, then a free-text tagline, and a VIEW TEAM button.
//
// The 2-column grid collapses to 1 column on mobile.
//
// DATA SOURCE
// ───────────
// Both leagues and teams are fetched from Supabase on mount via a single
// Promise.all call to minimise round-trips.  Teams are then grouped client-side
// by league_id to drive the section layout.  normalizeTeam() is applied so
// component code can continue using the camelCase field names (homeGround,
// leagueId) that were established in the original leagueData.js shape.

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Button from '../components/ui/Button';
import MetaRow from '../components/ui/MetaRow';
import { getLeagues, getTeams, normalizeTeam } from '../lib/supabase';
import { useSupabase } from '../shared/supabase/SupabaseProvider';

/**
 * "Our Heroic Teams" listing page.
 *
 * Fetches all leagues and teams from Supabase, groups the teams by their
 * parent league, and renders a section per league with a 2-column grid of
 * team cards.  Each card links to /teams/:teamId for the Team Detail page.
 *
 * Shows a loading state while the fetch is in flight.  Leagues with no
 * teams (shouldn't happen with correct seed data) are silently skipped.
 *
 * @returns {JSX.Element}
 */
export default function Teams() {
  const db = useSupabase();

  // ── Data fetch ────────────────────────────────────────────────────────────
  // Fetch leagues (for carousel order) and all teams in one round-trip.
  // Teams are grouped client-side by league_id — no second query needed.
  const [leagues,       setLeagues]       = useState([]);
  const [teamsByLeague, setTeamsByLeague] = useState({});
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState(false);

  // ── Carousel state ────────────────────────────────────────────────────────
  // leagueIdx indexes into the `leagues` array. Wraps at both ends so the
  // user can cycle through all four leagues without hitting a dead end.
  const [leagueIdx, setLeagueIdx] = useState(0);

  useEffect(() => {
    Promise.all([getLeagues(db), getTeams(db)])
      .then(([leagueRows, teamRows]) => {
        // Build leagueId → normalised team array for O(1) lookup per league.
        const grouped = {};
        teamRows.forEach(t => {
          const lid = t.league_id;
          if (!grouped[lid]) grouped[lid] = [];
          grouped[lid].push(normalizeTeam(t));
        });
        setLeagues(leagueRows);
        setTeamsByLeague(grouped);
        setLoading(false);
      })
      .catch((err) => {
        console.error('[ISL] Teams fetch failed:', err);
        setError(true);
        setLoading(false);
      });
  }, [db]);

  /** Advance the carousel by `delta` (-1 = prev, +1 = next), wrapping around. */
  function shiftLeague(delta) {
    setLeagueIdx(i => (i + delta + leagues.length) % leagues.length);
  }

  const currentLeague = leagues[leagueIdx];
  const currentTeams  = currentLeague ? (teamsByLeague[currentLeague.id] ?? []) : [];

  return (
    <div className="container page-content">

      <div className="page-hero">
        <h1>Our Heroic Teams</h1>
        <hr className="divider" />
        <p className="subtitle">Lorem ipsum dolor sit amet.</p>
      </div>

      {loading && <p className="status-text">Loading teams…</p>}
      {error   && <p className="status-text">Could not load teams. Please try again later.</p>}

      {!loading && !error && currentLeague && (
        <section className="section">
          <div className="section-nav">
            <button className="section-nav-btn" onClick={() => shiftLeague(-1)} aria-label="Previous league">◄</button>
            <h2 className="section-nav-title">{currentLeague.name}</h2>
            <button className="section-nav-btn" onClick={() => shiftLeague(1)} aria-label="Next league">►</button>
          </div>

          <div className="team-grid">
            {currentTeams.map(team => (
              <TeamCard key={team.id} team={team} />
            ))}
          </div>
        </section>
      )}

    </div>
  );
}

// ── TeamCard ──────────────────────────────────────────────────────────────────
// Internal sub-component for a single team listing card.
// Extracted to keep the Teams component's JSX scannable; not exported because
// it is only meaningful in the context of this page.

/**
 * Individual team listing card.
 *
 * Displays a circular brand-colour badge (logo placeholder until real crests
 * are uploaded), the team's structured metadata (Location, Home Ground,
 * Capacity) in bold-label style, a free-text tagline, and a VIEW TEAM primary
 * button that navigates to the team detail page.
 *
 * The card uses flexbox column layout with `flex: 1` on the tagline so the
 * VIEW TEAM button is always flush to the card's bottom edge, keeping all
 * cards in a row visually aligned.
 *
 * Expects a normalised team object (homeGround camelCase alias present).
 *
 * @param {{ id: string, name: string, location: string, homeGround: string,
 *           capacity: string, tagline: string, color: string }} team
 *   Normalised team object from Supabase via normalizeTeam().
 *   `color` is the team's primary brand hex used to tint the badge circle.
 * @returns {JSX.Element}
 */
function TeamCard({ team }) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {/* Brand badge — necessarily dynamic: tinted by team.color hex */}
      <div
        className="team-badge"
        style={{
          backgroundColor: team.color ? `${team.color}33` : 'rgba(227,224,213,0.1)',
          border: `1px solid ${team.color ? `${team.color}66` : 'rgba(227,224,213,0.2)'}`,
        }}
      />

      <h3 className="card-title">{team.name}</h3>

      <MetaRow label="Location"    value={team.location}   fontSize="11px" />
      <MetaRow label="Home Ground" value={team.homeGround} fontSize="11px" />
      <MetaRow label="Capacity"    value={team.capacity}   fontSize="11px" />

      <p className="team-card__tagline">{team.tagline}</p>

      <div>
        <Link to={`/teams/${team.id}`}>
          <Button variant="primary">View Team</Button>
        </Link>
      </div>
    </div>
  );
}
