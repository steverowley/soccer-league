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
  SCORER_COLS, ASSISTS_COLS, CARDS_COLS, CLEAN_SHEETS_COLS,
  STANDINGS_COLS,
  buildStandingsRows, placeholderPlayerRows,
} from '../data/leagueData';

// ── STANDINGS_WITH_POS_COLS ───────────────────────────────────────────────────
// League detail page adds a POSITION column (numbered rank) before TEAM and
// uses long labels (Played / Wins / Draws…) where the shared STANDINGS_COLS
// on the Home carousel uses the short single-letter forms (P / W / D…).
//
// The last-5 FORM column is the same renderer + data on both surfaces, so we
// pluck it off the shared STANDINGS_COLS rather than duplicating the render
// callback.  If STANDINGS_COLS gains additional cross-page columns in the
// future, append them the same way — keeping a single source of truth for the
// pip-rendering logic in leagueData.js.
//
// The `position` field is populated by augmentWithPosition() below.
const STANDINGS_FORM_COL = STANDINGS_COLS.find(c => c.key === 'form');
const STANDINGS_WITH_POS_COLS = [
  { key: 'position', label: 'Pos',    align: 'right' },
  { key: 'team',     label: 'Team',   linkField: 'teamLink' },
  { key: 'played',   label: 'Played', align: 'right' },
  { key: 'wins',     label: 'Wins',   align: 'right' },
  { key: 'draws',    label: 'Draws',  align: 'right' },
  { key: 'loses',    label: 'Loses',  align: 'right' },
  { key: 'gd',       label: 'GD',     align: 'right' },
  { key: 'points',   label: 'Points', align: 'right' },
  // STANDINGS_FORM_COL is defined when leagueData.js loaded successfully and
  // STANDINGS_COLS includes it.  Defensive `if present` guard so a future
  // refactor that renames the form key doesn't crash this page.
  ...(STANDINGS_FORM_COL ? [STANDINGS_FORM_COL] : []),
];

import {
  computeStandings,
  getTopScorers,
  getTopAssists,
  getTopCards,
} from '../lib/matchResultsService';
import { getLeagues } from '../lib/supabase';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import { SectionHeader } from '@shared/ui';

/**
 * Add a 1-based `position` field to every row in the supplied standings
 * array.  Used before passing rows to IslTable so the position column's
 * renderer can show the rank without needing IslTable to expose row
 * indices.  computeStandings already sorts by Pts DESC + GD tie-break,
 * so position === idx + 1 IS the table rank.
 *
 * @param {object[]} rows  Standings rows from computeStandings().
 * @returns {object[]}     Same rows with `position` field stamped on.
 */
function augmentWithPosition(rows) {
  return rows.map((row, i) => ({ ...row, position: i + 1 }));
}

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
  const db = useSupabase();

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
    let cancelled = false;
    setLeague(null);
    setLoading(true);
    setNotFound(false);
    setError(false);

    getLeagues(db)
      .then(all => {
        if (cancelled) return;
        const match = all.find(l => l.id === leagueId);
        if (!match) {
          setNotFound(true);
        } else {
          setLeague(match);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[ISL] LeagueDetail fetch failed:', err);
        setError(true);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [leagueId, db]);

  // ── Live standings ─────────────────────────────────────────────────────────
  // buildStandingsRows() produces the zeroed base list (all teams in the
  // league from leagueData.js).  computeStandings() merges in real W/D/L/GD/Pts
  // from localStorage for any team whose results have been saved by the
  // simulator.  useMemo prevents a full localStorage read on every render.
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

  // ── Loading / 404 / error states ─────────────────────────────────────────
  // WHY page-hero wrapper: keeps the top spacing (100px desktop / 70px mobile)
  // identical to the ready state so the page chrome never jumps on load.
  if (loading) {
    return (
      <div className="page-hero">
        <div className="container">
          <p style={{ opacity: 0.5, fontSize: '14px' }}>Loading league…</p>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="page-hero">
        <div className="container">
          <h2>League not found</h2>
          <p style={{ marginTop: '16px', opacity: 0.6 }}>
            No league exists with the id "{leagueId}".
          </p>
          <Link to="/leagues" style={{ display: 'inline-block', marginTop: '24px' }}>
            <Button variant="primary">View All Leagues</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (error || !league) {
    return (
      <div className="page-hero">
        <div className="container">
          <h2>Something went wrong</h2>
          <p style={{ marginTop: '16px', opacity: 0.6 }}>
            Could not load league data. Please try again later.
          </p>
          <Link to="/leagues" style={{ display: 'inline-block', marginTop: '24px' }}>
            <Button variant="primary">View All Leagues</Button>
          </Link>
        </div>
      </div>
    );
  }

  // Inject 1-based position numbers after computeStandings() has sorted by Pts.
  const rankedRows = augmentWithPosition(standingsRows);

  return (
    <div className="container" style={{ paddingBlock: 'var(--space-12)' }}>

      {/* ── Editorial hero ──────────────────────────────────────────────────
          Display masthead + small-caps "Conference" kicker.  The previous
          centred page-hero + 80 px circle is dropped — the league name on
          its own carries the page in the new editorial layout. */}
      <div style={{
        fontSize: 'var(--font-size-micro)',
        textTransform: 'uppercase',
        letterSpacing: 'var(--letter-spacing-widest)',
        opacity: 0.6,
        marginBottom: 'var(--space-3)',
      }}>
        <Link to="/leagues" style={{ color: 'inherit', borderBottom: '1px solid var(--color-hairline)' }}>
          ← All Leagues
        </Link>
        <span style={{ marginInline: 'var(--space-3)', opacity: 0.5 }}>•</span>
        <span>Conference</span>
      </div>

      <h1 className="display-title" style={{ marginBottom: 'var(--space-3)' }}>
        {league.name}
      </h1>
      <hr className="divider" style={{ marginBlock: 0 }} />

      <p style={{
        fontSize: 'var(--font-size-small)',
        lineHeight: 'var(--line-height-body)',
        opacity: 0.75,
        maxWidth: 'var(--max-width-narrow)',
        marginTop: 'var(--space-4)',
      }}>
        {league.description}
      </p>

      {/* ── I • THE TABLE — Standings ─────────────────────────────────────── */}
      <section className="section" style={{ marginTop: 'var(--space-12)' }}>
        <SectionHeader
          kicker="I"
          label="The Table"
          title="Standings"
          subtitle="Live position table.  Position pipe + numeral on the left; bottom two rows trigger the relegation cue."
        />
        <IslTable variant="dark" columns={STANDINGS_WITH_POS_COLS} rows={rankedRows} />
      </section>

      {/* ── II • TOP OF THE BOARD — Scorers + Assisters ───────────────────── */}
      <section className="section">
        <SectionHeader
          kicker="II"
          label="Top Of The Board"
          title="Scorers & Assisters"
          subtitle="Players the cosmos has noted most often this season."
        />
        <div className="stats-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-6)' }}>
          <StatTable title="Top Scorers"    columns={SCORER_COLS}  rows={scorerRows} />
          <StatTable title="Top Assisters"  columns={ASSISTS_COLS} rows={assistRows} />
        </div>
      </section>

      {/* ── III • THE BACK PAGE — Clean sheets + Discipline ───────────────── */}
      <section className="section">
        <SectionHeader
          kicker="III"
          label="The Back Page"
          title="Discipline & Clean Sheets"
          subtitle="Cards in colour and goalkeepers who refused to concede."
        />
        <div className="stats-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-6)', marginBottom: 'var(--space-6)' }}>
          <StatTable title="Top Yellow Cards" columns={CARDS_COLS} rows={yellowRows} />
          <StatTable title="Top Red Cards"    columns={CARDS_COLS} rows={redRows}    />
        </div>
        <div className="stats-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-6)' }}>
          <StatTable title="Top Clean Sheets" columns={CLEAN_SHEETS_COLS} rows={cleanSheetRows} />
          <div aria-hidden="true" />
        </div>
      </section>

      {/* Mobile breakpoint — collapse the two-column stat grids to single
          column so each table stays readable on narrow viewports. */}
      <style>{`
        @media (max-width: 640px) {
          .stats-two-col {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
