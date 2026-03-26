// ── LeagueDetail.jsx ──────────────────────────────────────────────────────────
// Individual league page.  Implements the league detail layout generalised for
// all four leagues via the :leagueId URL param:
//
//   H1: ROCKY INNER LEAGUE
//   ──────────────────────────
//   Description prose (centred, max ~700px)
//   Cross-feature CTAs (Simulate / Teams / Players)
//
//   LEAGUE STANDINGS        ← live data from matchResultsService; falls back
//                             to zeroed placeholder rows pre-season
//
//   TOP SCORERS  |  TOP ASSISTS       ← live data; empty state shown pre-season
//   MOST YELLOW CARDS  |  MOST RED CARDS
//
// LIVE DATA STRATEGY
// ──────────────────
// matchResultsService reads from localStorage (written by the simulator on
// full-time).  All stat functions (getTopScorers, getTopAssists, getTopCards)
// return empty arrays before any matches have been played — the tables render
// an appropriate "—" empty state via placeholderPlayerRows().
//
// computeStandings() merges real W/D/L/GD/Pts into the full team list so
// the table always shows all teams in the league, not just those that have
// played.
//
// A 404-style fallback is rendered if :leagueId does not match any known
// league — important because users can hand-type URLs.

import { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import IslTable from '../components/ui/IslTable';
import StatTable from '../components/ui/StatTable';
import Button from '../components/ui/Button';
import {
  LEAGUES, STANDINGS_COLS,
  SCORER_COLS, ASSISTS_COLS, CARDS_COLS,
  buildStandingsRows, placeholderPlayerRows,
} from '../data/leagueData';
import {
  computeStandings,
  getTopScorers,
  getTopAssists,
  getTopCards,
} from '../lib/matchResultsService';

/**
 * League Detail page.
 *
 * Reads the :leagueId URL param, looks up the matching league record, and
 * renders the full league page: hero, live standings, and all four player-stat
 * tables.  Falls back to zeroed placeholder data before any matches are played.
 *
 * DATA FLOW
 * ─────────
 * All live data is derived from localStorage via matchResultsService on each
 * render — no async fetch, no loading state.  useMemo gates prevent redundant
 * recomputation on unrelated re-renders (e.g. hover effects).
 *
 * @returns {JSX.Element}
 */
export default function LeagueDetail() {
  // ── Route param resolution ─────────────────────────────────────────────────
  const { leagueId } = useParams();
  const league = LEAGUES.find(l => l.id === leagueId);

  // ── 404 fallback ───────────────────────────────────────────────────────────
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

  // ── Live standings ─────────────────────────────────────────────────────────
  // buildStandingsRows() produces the zeroed base list (all teams in the
  // league).  computeStandings() merges in real W/D/L/GD/Pts from localStorage
  // for any team mapped in TEAM_LEAGUE_MAP, leaving unplayed teams at zero.
  // useMemo prevents a full localStorage read on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const standingsRows = useMemo(
    () => computeStandings(leagueId, buildStandingsRows(leagueId)),
    [leagueId]
  );

  // ── Player stat tables ─────────────────────────────────────────────────────
  // Each aggregator scans all saved results filtered to this league and returns
  // rows sorted by the relevant stat descending.  Falls back to placeholder
  // rows (all "—") when no results exist yet so the tables never appear empty.
  //
  // Limit: 6 rows — the display cap shown in the design mockup before the
  // "SEE MORE" button appears.  Matches placeholderPlayerRows()'s row count
  // so the table height is stable as data populates.
  const scorerRows = useMemo(() => {
    const live = getTopScorers(leagueId, 6);   // top 6 goal scorers
    return live.length > 0 ? live : placeholderPlayerRows();
  }, [leagueId]);

  const assistRows = useMemo(() => {
    const live = getTopAssists(leagueId, 6);   // top 6 assist providers
    return live.length > 0 ? live : placeholderPlayerRows();
  }, [leagueId]);

  const yellowRows = useMemo(() => {
    const live = getTopCards(leagueId, 'yellow', 6);  // top 6 yellow-card recipients
    return live.length > 0 ? live : placeholderPlayerRows();
  }, [leagueId]);

  const redRows = useMemo(() => {
    const live = getTopCards(leagueId, 'red', 6);     // top 6 red-card recipients
    return live.length > 0 ? live : placeholderPlayerRows();
  }, [leagueId]);

  return (
    <div>
      {/* ── Page hero ─────────────────────────────────────────────────────────── */}
      {/* .page-hero provides the standard centred layout and vertical padding
          shared across all detail pages.  The description retains its maxWidth
          constraint so prose doesn't span the full viewport on wide screens —
          this is intentional.  .subtitle supplies 14px / 0.7 opacity;
          lineHeight and margin are kept as overrides for this longer copy. */}
      <div className="page-hero">
        <div className="container">
          <h1 style={{ marginBottom: '16px' }}>{league.name}</h1>
          <hr className="divider" style={{ maxWidth: '700px', margin: '0 auto 24px' }} />
          <p className="subtitle" style={{ maxWidth: '700px', margin: '0 auto', lineHeight: 1.8 }}>
            {league.description}
          </p>

          {/* ── Cross-feature CTAs ──────────────────────────────────────────── */}
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
        {/* Full-width dark table — primary content section of the page.
            computeStandings() sorts rows by Pts desc so the leader is always
            first once matches have been played.  Pre-season all rows are zero
            and the original leagueData order is preserved. */}
        <section className="section">
          <h2 className="section-title">League Standings</h2>
          <IslTable variant="dark" columns={STANDINGS_COLS} rows={standingsRows} />
        </section>

        {/* ── TOP SCORERS | TOP ASSISTS ────────────────────────────────────── */}
        <div
          className="stats-two-col"
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px' }}
        >
          {/* SCORER_COLS uses key:'goals' matching getTopScorers() output shape */}
          <StatTable title="Top Scorers"  columns={SCORER_COLS}  rows={scorerRows}  />
          {/* ASSISTS_COLS uses key:'assists' matching getTopAssists() output shape */}
          <StatTable title="Top Assists"  columns={ASSISTS_COLS} rows={assistRows}  />
        </div>

        {/* ── MOST YELLOW CARDS | MOST RED CARDS ──────────────────────────── */}
        {/* CARDS_COLS uses key:'cards' matching getTopCards() output shape for
            both yellow and red — the section title provides the distinction. */}
        <div
          className="stats-two-col"
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px' }}
        >
          <StatTable title="Most Yellow Cards" columns={CARDS_COLS} rows={yellowRows} />
          <StatTable title="Most Red Cards"    columns={CARDS_COLS} rows={redRows}    />
        </div>

      </div>
    </div>
  );
}
