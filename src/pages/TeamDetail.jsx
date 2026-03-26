// ── TeamDetail.jsx ────────────────────────────────────────────────────────────
// Individual team page.  Implements the "Mercury Runners FC" mockup layout
// (generalised for all teams via the :teamId URL param):
//
//   H1: MERCURY RUNNERS FC
//   ─────────────────────────────
//   Subtitle (tagline)
//
//   ┌─────────────────────────────────────────┐
//   │ MERCURY RUNNERS FC                      │  ← team info card (dark)
//   │ LOCATION: Mercury                       │
//   │ HOME GROUND: Solar Sprint Stadium…      │
//   │ CAPACITY: 35,000                        │
//   │                                         │
//   │ [description paragraphs]                │
//   └─────────────────────────────────────────┘
//
//   SEASON STATS          ← dark table
//   HISTORIC STATS        ← dark table
//   TROPHY CABINET        ← dark table (TEAM | LEAGUE CUPS | CELESTIAL CUPS | SOLAR CUPS)
//
//   TOP SCORERS | TOP ASSISTS       ← light tables, 2-col + SEE MORE
//   TOP CLEAN SHEETS                ← light table, half-width + SEE MORE
//   MOST YELLOW CARDS | MOST RED CARDS  ← light tables, 2-col + SEE MORE
//
// A 404-style fallback is shown for unknown teamId params.
// Description strings may contain \n characters which are split into separate
// <p> elements so paragraph breaks are preserved.

import { useParams, Link } from 'react-router-dom';
import IslTable from '../components/ui/IslTable';
import StatTable from '../components/ui/StatTable';
import Button from '../components/ui/Button';
import MetaRow from '../components/ui/MetaRow';
import { findTeam, getLeagueName, PLAYER_STAT_COLS, placeholderPlayerRows } from '../data/leagueData';

// ── Season / Historic stats column definitions ────────────────────────────────
// Shared by both the Season Stats and Historic Stats tables — same columns,
// different data sources (current season vs. all-time record).
const RECORD_COLS = [
  { key: 'team',   label: 'Team' },
  { key: 'played', label: 'Played', align: 'right' },
  { key: 'wins',   label: 'Wins',   align: 'right' },
  { key: 'draws',  label: 'Draws',  align: 'right' },
  { key: 'loses',  label: 'Loses',  align: 'right' },
  { key: 'points', label: 'Points', align: 'right' },
];

// ── Trophy cabinet column definitions ─────────────────────────────────────────
// Three cup competitions shown in the mockup:
//   LEAGUE CUPS   – annual league championship trophy
//   CELESTIAL CUPS – inter-league tournament trophy
//   SOLAR CUPS    – galaxy-wide knockout competition trophy
const TROPHY_COLS = [
  { key: 'team',          label: 'Team' },
  { key: 'leagueCups',    label: 'League Cups',    align: 'right' },
  { key: 'celestialCups', label: 'Celestial Cups', align: 'right' },
  { key: 'solarCups',     label: 'Solar Cups',     align: 'right' },
];

/**
 * Returns a single zeroed record row for a given team name.
 *
 * Used for Season Stats and Historic Stats tables pre-season.
 * When match results are persisted, the caller will replace this with
 * a selector reading from a results store.
 *
 * @param {string} teamName - The team's display name for the row label.
 * @returns {Array<{id: string, team: string, played: 0, wins: 0,
 *                  draws: 0, loses: 0, points: 0}>}
 */
function zeroRecord(teamName) {
  return [{ id: 'record', team: teamName, played: 0, wins: 0, draws: 0, loses: 0, points: 0 }];
}

/**
 * Returns a single zeroed trophy row for a given team name.
 *
 * @param {string} teamName
 * @returns {Array<{id: string, team: string, leagueCups: 0,
 *                  celestialCups: 0, solarCups: 0}>}
 */
function zeroTrophies(teamName) {
  return [{ id: 'trophies', team: teamName, leagueCups: 0, celestialCups: 0, solarCups: 0 }];
}

/**
 * Team Detail page.
 *
 * Reads :teamId from the URL, resolves the team record from leagueData, and
 * renders the full team page: hero, info card, season/historic stats, trophy
 * cabinet, and all five player stat tables.
 *
 * Renders a "team not found" fallback for unknown IDs.
 *
 * @returns {JSX.Element}
 */
export default function TeamDetail() {
  // ── Route param resolution ─────────────────────────────────────────────────
  const { teamId } = useParams();
  const team = findTeam(teamId);

  // ── 404 fallback ──────────────────────────────────────────────────────────
  if (!team) {
    return (
      <div className="container" style={{ paddingTop: '80px', textAlign: 'center' }}>
        <h2>Team not found</h2>
        <p style={{ marginTop: '16px', opacity: 0.6 }}>
          No team exists with the id "{teamId}".
        </p>
        <Link to="/teams" style={{ display: 'inline-block', marginTop: '24px' }}>
          <Button variant="primary">View All Teams</Button>
        </Link>
      </div>
    );
  }

  // Pre-compute row data so JSX below stays readable.
  const seasonRows  = zeroRecord(team.name);
  const historicRows = zeroRecord(team.name);
  const trophyRows  = zeroTrophies(team.name);
  const playerRows  = placeholderPlayerRows();
  const leagueName  = getLeagueName(team.leagueId);

  // Split description on newline characters into separate paragraphs.
  // The data file uses \n as a paragraph separator within description strings.
  const descParagraphs = (team.description ?? '').split('\n').filter(Boolean);

  return (
    <div>
      {/* ── Page hero ─────────────────────────────────────────────────────────── */}
      {/* .page-hero provides the standard centred layout and vertical padding
          shared across all detail pages.  .subtitle inherits 14px / 0.7
          opacity from the .page-hero .subtitle rule in index.css. */}
      <div className="page-hero">
        <div className="container">
          <h1 style={{ marginBottom: '16px' }}>{team.name}</h1>
          <hr className="divider" style={{ maxWidth: '600px', margin: '0 auto 16px' }} />
          <p className="subtitle">{team.tagline}</p>
        </div>
      </div>

      <div className="container" style={{ paddingBottom: '40px' }}>

        {/* ── Team info card ────────────────────────────────────────────────── */}
        {/* Dark bordered card containing structured metadata and description
            prose.  Matches the prominent info block at the top of the mockup. */}
        <section className="section">
          <div className="card">
            {/* Card heading — .card-title (18px uppercase) is the standardised
                in-card heading class; replaces the previous inline fontSize. */}
            <h3 className="card-title">{team.name}</h3>

            {/* Structured metadata block */}
            <div style={{ marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <MetaRow label="Location"    value={team.location} />
              <MetaRow label="Home Ground" value={team.homeGround} />
              <MetaRow label="Capacity"    value={team.capacity} />
              {/* ── League membership ──────────────────────────────────────────
                  Derived rather than stored on the team object so it stays in
                  sync if a team moves between leagues.  The value is a Link so
                  users can navigate directly from a team to its parent league. */}
              {leagueName && (
                <MetaRow
                  label="League"
                  value={
                    <Link
                      to={`/leagues/${team.leagueId}`}
                      style={{ color: 'inherit', textDecoration: 'underline', textDecorationColor: 'rgba(255,255,255,0.3)' }}
                    >
                      {leagueName}
                    </Link>
                  }
                />
              )}
            </div>

            {/* Description paragraphs — split from the \n-delimited string */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {descParagraphs.map((para, i) => (
                <p key={i} style={{ fontSize: '13px', lineHeight: 1.8, opacity: 0.85 }}>
                  {para}
                </p>
              ))}
            </div>
          </div>
        </section>

        {/* ── Cross-feature actions ──────────────────────────────────────────── */}
        {/* Positioned immediately after the team info card so all key actions
            are visible before the user scrolls into the stats tables.
            - Simulate a Match → Matches page (fixture selector pre-loaded)
            - Browse League    → parent league's standings + player stat tables
            - View Players     → Players page filtered to this league's clubs   */}
        <section className="section" style={{ paddingTop: '8px' }}>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <Link to="/matches">
              <Button variant="tertiary">Simulate a Match</Button>
            </Link>
            <Link to={`/leagues/${team.leagueId}`}>
              <Button variant="primary">Browse League</Button>
            </Link>
            <Link to={`/players?league=${team.leagueId}`}>
              <Button variant="primary">View Players</Button>
            </Link>
          </div>
        </section>

        {/* ── SEASON STATS ──────────────────────────────────────────────────── */}
        <section className="section">
          <h2 className="section-title">Season Stats</h2>
          <IslTable variant="dark" columns={RECORD_COLS} rows={seasonRows} />
        </section>

        {/* ── HISTORIC STATS ────────────────────────────────────────────────── */}
        <section className="section">
          <h2 className="section-title">Historic Stats</h2>
          <IslTable variant="dark" columns={RECORD_COLS} rows={historicRows} />
        </section>

        {/* ── TROPHY CABINET ────────────────────────────────────────────────── */}
        <section className="section">
          <h2 className="section-title">Trophy Cabinet</h2>
          <IslTable variant="dark" columns={TROPHY_COLS} rows={trophyRows} />
        </section>

        {/* ── TOP SCORERS | TOP ASSISTS — 2-column ──────────────────────────── */}
        <div
          className="stats-two-col"
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px' }}
        >
          <StatTable title="Top Scorers" columns={PLAYER_STAT_COLS} rows={playerRows} />
          <StatTable title="Top Assists" columns={PLAYER_STAT_COLS} rows={playerRows} />
        </div>

        {/* ── TOP CLEAN SHEETS — half-width ─────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px' }}>
          <StatTable title="Top Clean Sheets" columns={PLAYER_STAT_COLS} rows={playerRows} />
          <div /> {/* Intentional empty right column per mockup */}
        </div>

        {/* ── MOST YELLOW CARDS | MOST RED CARDS — 2-column ─────────────────── */}
        <div
          className="stats-two-col"
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px' }}
        >
          <StatTable title="Most Yellow Cards" columns={PLAYER_STAT_COLS} rows={playerRows} />
          <StatTable title="Most Red Cards"    columns={PLAYER_STAT_COLS} rows={playerRows} />
        </div>

      </div>

    </div>
  );
}

