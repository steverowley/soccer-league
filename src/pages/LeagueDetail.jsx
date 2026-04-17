// ── LeagueDetail.jsx ──────────────────────────────────────────────────────────
// Individual league page.  Implements the Figma league detail layout for all
// four leagues via the :leagueId URL param:
//
//   H1: ROCKY INNER LEAGUE   ← centred page title
//   ──────────────────────────
//   ┌────────────────────────────────────────────────────────────────┐
//   │ ○  ROCKY INNER LEAGUE  ← league info card with badge circle   │
//   │    Description prose (left-aligned inside card)               │
//   └────────────────────────────────────────────────────────────────┘
//
//   ◄ LEAGUE STANDINGS — ROCKY INNER ►   ← light table
//
//   TOP SCORERS  |  TOP ASSISTS           ← StatTable (light, SEE MORE)
//   TOP CLEAN SHEETS                      ← StatTable half-width (light, SEE MORE)
//   MOST YELLOW CARDS  |  MOST RED CARDS  ← StatTable (light, SEE MORE)
//
// DATA STRATEGY
// ─────────────
// League metadata (name, description) is fetched from Supabase on mount —
// the DB is the source of truth for display copy.
//
// Standings and player-stat tables are driven by localStorage via
// matchResultsService — the DB matches table is empty pre-season so there is
// no point querying it for standings yet.  buildStandingsRows() (from
// leagueData.js) supplies the zeroed base rows for every team in the league so
// the table always shows the full club list even before any match is played.
//
// Clean-sheet data (getTopCleanSheets) does not exist in matchResultsService
// yet — falls back to placeholderPlayerRows() like all other stat tables do
// pre-season.
//
// A 404-style fallback is rendered if :leagueId does not match any league
// in the DB — important because users can hand-type URLs.

import { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import IslTable from '../components/ui/IslTable';
import StatTable from '../components/ui/StatTable';
import Button from '../components/ui/Button';
import {
  STANDINGS_COLS,
  SCORER_COLS, ASSISTS_COLS, CARDS_COLS, CLEAN_SHEETS_COLS,
  buildStandingsRows, placeholderPlayerRows,
} from '../data/leagueData';
import {
  computeStandings,
  getTopScorers,
  getTopAssists,
  getTopCards,
} from '../lib/matchResultsService';
import { getLeagues } from '../lib/supabase';

/**
 * League Detail page.
 *
 * Fetches the league record from Supabase by the :leagueId URL param, then
 * renders the full league page: hero, live standings, and all four player-stat
 * tables.  Falls back to zeroed placeholder data before any matches are played.
 *
 * DATA FLOW
 * ─────────
 * League metadata  → Supabase (single fetch on mount / leagueId change)
 * League standings → localStorage via matchResultsService (synchronous)
 * Player stats     → localStorage via matchResultsService (synchronous)
 *
 * @returns {JSX.Element}
 */
export default function LeagueDetail() {
  // ── Route param ────────────────────────────────────────────────────────────
  const { leagueId } = useParams();

  // ── Data fetch ────────────────────────────────────────────────────────────
  // Fetch all leagues then find the one matching the URL param.  We fetch all
  // rather than a single-row query so the result can be cached or reused by
  // other pages without an additional network call.
  const [league,   setLeague]   = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error,    setError]    = useState(false);

  useEffect(() => {
    setLeague(null);
    setLoading(true);
    setNotFound(false);
    setError(false);

    getLeagues()
      .then(all => {
        const match = all.find(l => l.id === leagueId);
        if (!match) {
          setNotFound(true);
        } else {
          setLeague(match);
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error('[ISL] LeagueDetail fetch failed:', err);
        setError(true);
        setLoading(false);
      });
  }, [leagueId]);

  // ── Live standings ─────────────────────────────────────────────────────────
  // buildStandingsRows() produces the zeroed base list (all teams in the
  // league from leagueData.js).  computeStandings() merges in real W/D/L/GD/Pts
  // from localStorage for any team whose results have been saved by the
  // simulator.  useMemo prevents a full localStorage read on every render.
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
    const live = getTopScorers(leagueId, 6);
    return live.length > 0 ? live : placeholderPlayerRows();
  }, [leagueId]);

  const assistRows = useMemo(() => {
    const live = getTopAssists(leagueId, 6);
    return live.length > 0 ? live : placeholderPlayerRows();
  }, [leagueId]);

  const yellowRows = useMemo(() => {
    const live = getTopCards(leagueId, 'yellow', 6);
    return live.length > 0 ? live : placeholderPlayerRows();
  }, [leagueId]);

  const redRows = useMemo(() => {
    const live = getTopCards(leagueId, 'red', 6);
    return live.length > 0 ? live : placeholderPlayerRows();
  }, [leagueId]);

  // ── Clean sheet rows ───────────────────────────────────────────────────────
  // matchResultsService does not yet aggregate clean-sheet data — that requires
  // tracking which GK was on the pitch at full-time for each 0-conceded match.
  // Until that aggregator is built, fall back to placeholderPlayerRows() so
  // the table renders at correct height with "—" values, exactly like all
  // other stat tables before season data exists.
  const cleanSheetRows = useMemo(() => placeholderPlayerRows(), []);

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="container" style={{ paddingTop: '80px', textAlign: 'center' }}>
        <p style={{ opacity: 0.5, fontSize: '14px' }}>Loading league…</p>
      </div>
    );
  }

  // ── 404 fallback ───────────────────────────────────────────────────────────
  if (notFound) {
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

  // ── Generic error fallback ────────────────────────────────────────────────
  if (error || !league) {
    return (
      <div className="container" style={{ paddingTop: '80px', textAlign: 'center' }}>
        <h2>Something went wrong</h2>
        <p style={{ marginTop: '16px', opacity: 0.6 }}>
          Could not load league data. Please try again later.
        </p>
        <Link to="/leagues" style={{ display: 'inline-block', marginTop: '24px' }}>
          <Button variant="primary">View All Leagues</Button>
        </Link>
      </div>
    );
  }

  return (
    <div>
      {/* ── Page title ────────────────────────────────────────────────────────── */}
      {/* Centred H1 + divider matches the Figma page-title pattern used on every
          detail page.  The league info (description, badge) sits below in a card
          rather than in this hero area — keeping the hero minimal so the card
          becomes the visual anchor. */}
      <div className="page-hero">
        <div className="container">
          <h1 style={{ marginBottom: '16px' }}>{league.name}</h1>
          <hr className="divider" style={{ maxWidth: '700px', margin: '0 auto' }} />
        </div>
      </div>

      <div className="container" style={{ paddingBottom: '64px' }}>

        {/* ── LEAGUE INFO CARD ──────────────────────────────────────────────── */}
        {/* Figma spec: full-width card containing a 64px badge circle (top-left)
            followed by the league name as a card-title and the description prose.
            This replaces the old centred page-hero prose block — moving the copy
            into a card gives it visual weight and matches the team/player detail
            pattern used elsewhere in the design system. */}
        <section className="section">
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* ── Badge circle ──────────────────────────────────────────────
                64×64px placeholder — leagues have no brand colour so we use
                the neutral Lunar Dust tint.  Replace with a real crest <img>
                once league logo assets are added to the DB. */}
            <div style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              backgroundColor: 'rgba(227,224,213,0.1)',
              border: '1px solid rgba(227,224,213,0.2)',
              flexShrink: 0,
            }} />

            {/* League name repeated inside the card so it reads as a self-
                contained information block — the H1 above is the page title,
                this is the card's entity label. */}
            <h3 className="card-title" style={{ margin: 0 }}>{league.name}</h3>

            {/* Description prose — unrestricted width inside the card so long
                text fills the card naturally rather than centering in a narrow
                max-width column as it did in the old page-hero layout. */}
            <p style={{ fontSize: '14px', lineHeight: 1.8, opacity: 0.85, margin: 0 }}>
              {league.description}
            </p>
          </div>
        </section>

        {/* ── LEAGUE STANDINGS ──────────────────────────────────────────────── */}
        {/* computeStandings() sorts rows by Pts desc so the leader is always
            first once matches have been played.  Pre-season all rows are zero
            and the original leagueData order is preserved.
            The ◄ ► chevrons are the ISL design-system decorative section
            header motif — purely visual, not interactive on this page. */}
        <section className="section">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <span aria-hidden="true" style={{ opacity: 0.5, fontSize: '14px' }}>◄</span>
            <h2 className="section-title" style={{ margin: 0 }}>
              League Standings — {league.name}
            </h2>
            <span aria-hidden="true" style={{ opacity: 0.5, fontSize: '14px' }}>►</span>
          </div>
          {/* Light variant: cream/dust bg contrasts the Galactic Abyss page bg,
              matching the Figma data-table spec for all detail pages. */}
          <IslTable variant="light" columns={STANDINGS_COLS} rows={standingsRows} />
        </section>

        {/* ── TOP SCORERS | TOP ASSISTS — 2-column ─────────────────────────── */}
        {/* SCORER_COLS key:'goals'   → getTopScorers() output shape.
            ASSISTS_COLS key:'assists' → getTopAssists() output shape.
            StatTable includes a SEE MORE button by default (showSeeMore=true). */}
        <div
          className="stats-two-col"
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px' }}
        >
          <StatTable title="Top Scorers" columns={SCORER_COLS}  rows={scorerRows} />
          <StatTable title="Top Assists" columns={ASSISTS_COLS} rows={assistRows} />
        </div>

        {/* ── TOP CLEAN SHEETS — half-width ─────────────────────────────────── */}
        {/* Figma places this section at full left half-width with the right
            column empty.  The 1fr 1fr grid + empty <div> achieves this without
            custom width hacks, and the responsive .stats-two-col rule in
            index.css collapses both to full-width on mobile. */}
        <div
          className="stats-two-col"
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px' }}
        >
          {/* CLEAN_SHEETS_COLS key:'clean_sheets' — placeholder until
              matchResultsService.getTopCleanSheets() is implemented. */}
          <StatTable title="Top Clean Sheets" columns={CLEAN_SHEETS_COLS} rows={cleanSheetRows} />
          <div aria-hidden="true" /> {/* intentional empty right column per Figma */}
        </div>

        {/* ── MOST YELLOW CARDS | MOST RED CARDS — 2-column ────────────────── */}
        {/* CARDS_COLS key:'cards' — shared by both yellow and red aggregators;
            the section title provides the visual distinction. */}
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
