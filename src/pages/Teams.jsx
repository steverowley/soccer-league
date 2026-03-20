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

import { Link } from 'react-router-dom';
import Button from '../components/ui/Button';
import MetaRow from '../components/ui/MetaRow';
import { LEAGUES, TEAMS_BY_LEAGUE } from '../data/leagueData';

/**
 * "Our Heroic Teams" listing page.
 *
 * Iterates over every league in display order, rendering a section heading
 * and a 2-column grid of team cards for each.  Each card links to
 * /teams/:teamId for the Team Detail page.
 *
 * @returns {JSX.Element}
 */
export default function Teams() {
  return (
    <div className="container" style={{ paddingTop: '40px', paddingBottom: '40px' }}>

      {/* ── Page hero ─────────────────────────────────────────────────────────── */}
      <div style={{ textAlign: 'center', marginBottom: '40px' }}>
        <h1>Our Heroic Teams</h1>
        <hr className="divider" style={{ maxWidth: '600px', margin: '16px auto 16px' }} />
        <p style={{ fontSize: '14px', opacity: 0.7 }}>Lorem ipsum dolor sit amet.</p>
      </div>

      {/* ── League sections ───────────────────────────────────────────────────── */}
      {/* Render one section per league.  Only leagues that have entries in
          TEAMS_BY_LEAGUE are rendered; unknown league IDs are silently skipped
          so adding a new league to LEAGUES without team data doesn't crash. */}
      {LEAGUES.map(league => {
        const teams = TEAMS_BY_LEAGUE[league.id];
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
 * @param {{ id: string, name: string, location: string, homeGround: string,
 *           capacity: string, tagline: string }} team
 *   Team data object from TEAMS_BY_LEAGUE.
 * @returns {JSX.Element}
 */
function TeamCard({ team }) {
  return (
    <div
      className="card"
      style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}
    >
      {/* ── Team name heading ─────────────────────────────────────────────── */}
      <h3 style={{ fontSize: '16px', marginBottom: '8px' }}>{team.name}</h3>

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

