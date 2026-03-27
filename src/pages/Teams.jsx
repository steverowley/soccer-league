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
  // ── Data fetch ────────────────────────────────────────────────────────────
  // Fetch leagues (for ordered section headings) and all teams in one go.
  // Teams are then grouped by league_id client-side — no second query needed.
  const [leagues,       setLeagues]       = useState([]);
  const [teamsByLeague, setTeamsByLeague] = useState({});
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState(false);

  useEffect(() => {
    Promise.all([getLeagues(), getTeams()])
      .then(([leagueRows, teamRows]) => {
        // ── Group teams by league ──────────────────────────────────────────
        // Build a map of leagueId → normalised team array so the render loop
        // can look up each league's clubs in O(1) rather than filtering each time.
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
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, []); // empty deps: run once on mount

  return (
    <div className="container" style={{ paddingTop: '40px', paddingBottom: '40px' }}>

      {/* ── Page hero ─────────────────────────────────────────────────────────── */}
      {/* .page-hero provides the standard centred layout and vertical padding
          shared across all listing pages (Teams, Players, Leagues, etc.).
          .subtitle inside .page-hero gets 14px / 0.7 opacity from index.css. */}
      <div className="page-hero">
        <h1>Our Heroic Teams</h1>
        <hr className="divider" style={{ maxWidth: '600px', margin: '16px auto 16px' }} />
        <p className="subtitle">Lorem ipsum dolor sit amet.</p>
      </div>

      {/* ── Loading / error states ──────────────────────────────────────────── */}
      {loading && (
        <p style={{ textAlign: 'center', opacity: 0.5, fontSize: '14px' }}>
          Loading teams…
        </p>
      )}
      {error && (
        <p style={{ textAlign: 'center', opacity: 0.5, fontSize: '14px' }}>
          Could not load teams. Please try again later.
        </p>
      )}

      {/* ── League sections ───────────────────────────────────────────────────── */}
      {/* Render one section per league, in the order returned by getLeagues().
          Leagues with no teams in teamsByLeague are silently skipped so a
          partially-seeded DB doesn't crash the page. */}
      {!loading && !error && leagues.map(league => {
        const teams = teamsByLeague[league.id];
        if (!teams || teams.length === 0) return null;

        return (
          <section key={league.id} className="section">

            {/* ── League group heading ────────────────────────────────────────── */}
            {/* Displayed in the section-title style (20px bold uppercase) with a
                bottom margin that separates it from the card grid below. */}
            <h2 className="section-title" style={{ marginBottom: '16px' }}>
              {league.name}
            </h2>

            {/* ── 2-column team card grid ─────────────────────────────────────── */}
            {/* align-items: stretch ensures paired cards share the same height
                so the VIEW TEAM buttons stay vertically aligned across each row. */}
            <div
              className="team-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '16px',
              }}
            >
              {teams.map(team => (
                <TeamCard key={team.id} team={team} />
              ))}
            </div>
          </section>
        );
      })}

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
 * Displays the team's structured metadata (Location, Home Ground, Capacity)
 * in bold-label style, a free-text tagline, and a VIEW TEAM primary button
 * that navigates to the team detail page.
 *
 * The card uses flexbox column layout with `flex: 1` on the tagline so the
 * VIEW TEAM button is always flush to the card's bottom edge, keeping all
 * cards in a row visually aligned.
 *
 * Expects a normalised team object (homeGround camelCase alias present).
 *
 * @param {{ id: string, name: string, location: string, homeGround: string,
 *           capacity: string, tagline: string }} team
 *   Normalised team object from Supabase via normalizeTeam().
 * @returns {JSX.Element}
 */
function TeamCard({ team }) {
  return (
    <div
      className="card"
      style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}
    >
      {/* ── Team name heading ─────────────────────────────────────────────── */}
      {/* .card-title (18px uppercase) — standardised in-card heading class. */}
      <h3 className="card-title" style={{ marginBottom: '8px' }}>{team.name}</h3>

      {/* ── Structured metadata rows ──────────────────────────────────────── */}
      {/* Each row uses the "LABEL: value" format shown in the mockup.
          Labels are bold-uppercase; values are normal-weight. */}
      <MetaRow label="Location"    value={team.location}   fontSize="11px" />
      <MetaRow label="Home Ground" value={team.homeGround} fontSize="11px" />
      <MetaRow label="Capacity"    value={team.capacity}   fontSize="11px" />

      {/* ── Tagline ──────────────────────────────────────────────────────── */}
      {/* flex: 1 pushes the button below to the card's bottom edge. */}
      <p style={{ fontSize: '12px', opacity: 0.7, marginTop: '8px', flex: 1, marginBottom: '16px' }}>
        {team.tagline}
      </p>

      {/* ── VIEW TEAM button ──────────────────────────────────────────────── */}
      <div>
        <Link to={`/teams/${team.id}`}>
          <Button variant="primary">View Team</Button>
        </Link>
      </div>
    </div>
  );
}
