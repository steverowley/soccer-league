// ── LeagueDetail.jsx ──────────────────────────────────────────────────────────
// Individual league page.  Implements the "Rocky Inner League" mockup layout
// (generalised for all four leagues via the :leagueId URL param):
//
//   H1: ROCKY INNER LEAGUE
//   ───────────────────────────
//   Description prose (centred, max ~700px)
//
//   LEAGUE STANDINGS        ← dark table, full width
//
//   TOP SCORERS  |  TOP ASSISTS       ← light tables, 2-col
//   [SEE MORE]      [SEE MORE]
//
//   TOP CLEAN SHEETS                  ← light table, half width
//   [SEE MORE]
//
//   MOST YELLOW CARDS  |  MOST RED CARDS   ← light tables, 2-col
//   [SEE MORE]            [SEE MORE]
//
// All stat tables are placeholder (empty rows) until match results are wired
// up from the simulator.  The standings table shows all league teams with
// zeroed stats, matching the mockup's pre-season state.
//
// A 404-style fallback is rendered if the :leagueId param does not match any
// known league — important because users can hand-type URLs.

import { useParams, Link } from 'react-router-dom';
import IslTable from '../components/ui/IslTable';
import StatTable from '../components/ui/StatTable';
import Button from '../components/ui/Button';
import { LEAGUES, STANDINGS_COLS, PLAYER_STAT_COLS, buildStandingsRows, placeholderPlayerRows } from '../data/leagueData';

/**
 * League Detail page.
 *
 * Reads the :leagueId URL param, looks up the matching league record, and
 * renders the full league page: hero, standings, and all five player stat
 * tables.  Renders a "league not found" message for unknown IDs.
 *
 * @returns {JSX.Element}
 */
export default function LeagueDetail() {
  // ── Route param resolution ─────────────────────────────────────────────────
  // :leagueId comes from the /leagues/:leagueId route defined in main.jsx.
  const { leagueId } = useParams();

  const league = LEAGUES.find(l => l.id === leagueId);

  // ── 404 fallback ──────────────────────────────────────────────────────────
  // Renders inline rather than redirecting so the user keeps the bad URL in
  // their address bar and can see what went wrong.
  if (!league) {
    return (
      <div className="container" style={{ paddingTop: '80px', textAlign: 'center' }}>
        <h2>League not found</h2>
        <p style={{ marginTop: '16px', opacity: 0.6 }}>
          No league exists with the id "{leagueId}".
        </p>
        <Link to="/leagues" style={{ display: 'inline-block', marginTop: '24px' }}>
          <Button variant="primary">View All Leagues</Button>
        </Link>
      </div>
    );
  }

  // Pre-build row data so JSX stays readable below.
  const standingsRows    = buildStandingsRows(leagueId);
  const playerStatRows   = placeholderPlayerRows();

  return (
    <div>
      {/* ── Page hero ─────────────────────────────────────────────────────────── */}
      <div style={{ textAlign: 'center', padding: '48px 24px 32px' }}>
        <div className="container">
          <h1 style={{ marginBottom: '16px' }}>{league.name}</h1>
          <hr className="divider" style={{ maxWidth: '700px', margin: '0 auto 24px' }} />
          {/* Description — centred prose block, max ~700px to prevent overly
              long line lengths on wide screens (matches mockup proportions). */}
          <p style={{ maxWidth: '700px', margin: '0 auto', fontSize: '13px', lineHeight: 1.8, opacity: 0.85 }}>
            {league.description}
          </p>

          {/* ── Cross-feature CTAs ────────────────────────────────────────────
              These buttons stitch the league detail page into the broader app:
              - Simulate a Match → Matches page (where the user picks a fixture)
              - View All Teams   → Teams listing (browse all clubs by league)
              - View Players     → Players page filtered to this league
              Placed below the description so the editorial content reads first,
              then the user has clear onward paths to adjacent features. */}
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap', marginTop: '24px' }}>
            <Link to="/matches">
              <Button variant="tertiary">Simulate a Match</Button>
            </Link>
            <Link to="/teams">
              <Button variant="primary">View All Teams</Button>
            </Link>
            <Link to={`/players?league=${league.id}`}>
              <Button variant="primary">View Players</Button>
            </Link>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingBottom: '40px' }}>

        {/* ── LEAGUE STANDINGS ──────────────────────────────────────────────── */}
        {/* Full-width dark table — the primary content section of the page. */}
        <section className="section">
          <h2 className="section-title">League Standings</h2>
          <IslTable variant="dark" columns={STANDINGS_COLS} rows={standingsRows} />
        </section>

        {/* ── TOP SCORERS | TOP ASSISTS — 2-column row ──────────────────────── */}
        {/* Side-by-side layout on desktop; stacks vertically on mobile via
            the responsive <style> override at the bottom of this component. */}
        <div
          className="stats-two-col"
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px' }}
        >
          <StatTable title="Top Scorers" columns={PLAYER_STAT_COLS} rows={playerStatRows} />
          <StatTable title="Top Assists" columns={PLAYER_STAT_COLS} rows={playerStatRows} />
        </div>

        {/* ── TOP CLEAN SHEETS — half-width ─────────────────────────────────── */}
        {/* Only spans the left half of the grid to match the mockup, which
            shows Clean Sheets alone on a row without a paired table. */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px' }}>
          <StatTable title="Top Clean Sheets" columns={PLAYER_STAT_COLS} rows={playerStatRows} />
          {/* Empty right column — intentional whitespace per mockup */}
          <div />
        </div>

        {/* ── MOST YELLOW CARDS | MOST RED CARDS — 2-column row ─────────────── */}
        <div
          className="stats-two-col"
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px' }}
        >
          <StatTable title="Most Yellow Cards" columns={PLAYER_STAT_COLS} rows={playerStatRows} />
          <StatTable title="Most Red Cards"    columns={PLAYER_STAT_COLS} rows={playerStatRows} />
        </div>

      </div>

    </div>
  );
}
