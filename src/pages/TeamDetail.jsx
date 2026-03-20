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
      <div style={{ textAlign: 'center', padding: '48px 24px 32px' }}>
        <div className="container">
          <h1 style={{ marginBottom: '16px' }}>{team.name}</h1>
          <hr className="divider" style={{ maxWidth: '600px', margin: '0 auto 16px' }} />
          <p style={{ fontSize: '14px', opacity: 0.7 }}>{team.tagline}</p>
        </div>
      </div>

      <div className="container" style={{ paddingBottom: '40px' }}>

        {/* ── Team info card ────────────────────────────────────────────────── */}
        {/* Dark bordered card containing structured metadata and description
            prose.  Matches the prominent info block at the top of the mockup. */}
        <section className="section">
          <div className="card">
            {/* Card heading — team name repeated inside the card per mockup */}
            <h3 style={{ fontSize: '18px', marginBottom: '12px' }}>{team.name}</h3>

            {/* Structured metadata block */}
            <div style={{ marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <InfoRow label="Location"    value={team.location} />
              <InfoRow label="Home Ground" value={team.homeGround} />
              <InfoRow label="Capacity"    value={team.capacity} />
              {/* League membership — derived rather than stored on the team
                  object so it stays in sync if a team is moved between leagues */}
              {leagueName && <InfoRow label="League" value={leagueName} />}
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

// ── InfoRow ───────────────────────────────────────────────────────────────────

/**
 * Single "LABEL: value" metadata row for the team info card.
 *
 * Mirrors the MetaRow component in Teams.jsx but used within a card context
 * where the font size is slightly larger (13px vs 11px on the listing card).
 *
 * @param {string} label - Field name rendered bold-uppercase.
 * @param {string} value - Field value in normal weight.
 * @returns {JSX.Element}
 */
function InfoRow({ label, value }) {
  return (
    <p style={{ fontSize: '13px', lineHeight: 1.6 }}>
      <strong style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}:
      </strong>{' '}
      {value}
    </p>
  );
}
