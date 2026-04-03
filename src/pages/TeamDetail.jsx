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
//   │ LEAGUE: Rocky Inner League (link)       │
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
// DATA SOURCE
// ───────────
// Team data is fetched from Supabase via getTeam(teamId) on mount (and when
// the :teamId route param changes).  getTeam() returns the full team row joined
// with its parent league (for the League link) plus players[] and managers[]
// (currently empty in the DB — reserved for future use).
//
// normalizeTeam() maps snake_case DB fields to the camelCase aliases (homeGround,
// leagueId) used throughout the component.  The league name is taken from the
// nested `leagues` object returned by the join rather than calling getLeagueName().
//
// A loading skeleton, 404 fallback, and error state are all handled before the
// main render, keeping the happy-path JSX clean.

import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import IslTable from '../components/ui/IslTable';
import StatTable from '../components/ui/StatTable';
import Button from '../components/ui/Button';
import MetaRow from '../components/ui/MetaRow';
import { getTeam, normalizeTeam } from '../lib/supabase';
import { PLAYER_STAT_COLS, placeholderPlayerRows } from '../data/leagueData';
import { POS_ORDER } from '../constants';

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

// ── Squad helpers ─────────────────────────────────────────────────────────────
// buildSquadGroups and SquadRow are defined at module scope (not inside the
// component) so they are stable references — no recreation on every render.
//
// POS_LABEL maps the two-letter DB position code to the full English heading
// displayed above each position group in the Squad section.
const POS_LABEL = {
  GK: 'Goalkeepers',
  DF: 'Defenders',
  MF: 'Midfielders',
  FW: 'Forwards',
};

/**
 * Group a flat players array into position buckets sorted GK → DF → MF → FW,
 * with starters separated from bench within each bucket.
 *
 * Sort order within a bucket:
 *   1. Starters before bench (boolean sort: true > false numerically)
 *   2. Overall rating descending within each sub-group (best first)
 *
 * Positions not recognised in POS_ORDER fall to the end (weight 9) so that
 * any future position codes degrade gracefully rather than crashing.
 *
 * @param {Array<{position: string, starter: boolean, overall_rating: number}>} players
 *   Raw players array from the Supabase team join.
 * @returns {Array<{position: string, starters: Array, bench: Array}>}
 *   One entry per distinct position, sorted in field order (GK first).
 */
function buildSquadGroups(players) {
  if (!players?.length) return [];

  // Sort a copy so we never mutate the original state array.
  const sorted = [...players].sort((a, b) => {
    // Primary: position order (GK=0, DF=1, MF=2, FW=3)
    const posDiff = (POS_ORDER[a.position] ?? 9) - (POS_ORDER[b.position] ?? 9);
    if (posDiff !== 0) return posDiff;
    // Secondary: starters before bench (true=1 > false=0)
    if (b.starter !== a.starter) return b.starter - a.starter;
    // Tertiary: best overall_rating first within starter/bench sub-group
    return b.overall_rating - a.overall_rating;
  });

  // Build a map keyed by position so each player is appended exactly once.
  const groups = {};
  for (const p of sorted) {
    if (!groups[p.position]) {
      groups[p.position] = { position: p.position, starters: [], bench: [] };
    }
    if (p.starter) groups[p.position].starters.push(p);
    else           groups[p.position].bench.push(p);
  }

  // Return as an array in POS_ORDER sequence (GK → DF → MF → FW).
  return Object.values(groups).sort(
    (a, b) => (POS_ORDER[a.position] ?? 9) - (POS_ORDER[b.position] ?? 9)
  );
}

/**
 * Single player row in the Squad section of the team page.
 *
 * Three-column grid: player name (linked to /players/:id) · position code ·
 * OVR rating.  Bench players render at 0.65 opacity to visually separate them
 * from the starting eleven without hiding them.
 *
 * @param {{ id: string, name: string, position: string,
 *            overall_rating: number, starter: boolean }} player
 * @param {boolean} [isBench=false] - When true renders at reduced opacity.
 * @returns {JSX.Element}
 */
function SquadRow({ player, isBench = false }) {
  return (
    <div style={{
      display: 'grid',
      // Name takes remaining space; position badge and OVR are fixed-width.
      gridTemplateColumns: '1fr 40px 48px',
      gap: '8px',
      padding: '5px 0',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
      fontSize: '12px',
      // 0.65 for bench mirrors the dimming in Players.jsx PlayerRow
      opacity: isBench ? 0.65 : 1,
    }}>
      {/* Player name — links to their individual profile page */}
      <Link
        to={`/players/${player.id}`}
        style={{
          color: 'inherit',
          textDecoration: 'underline',
          textDecorationColor: 'rgba(255,255,255,0.3)',
        }}
      >
        {player.name}
      </Link>

      {/* Position code — small, muted, uppercase */}
      <span style={{ fontSize: '10px', fontWeight: 'bold', letterSpacing: '0.06em', opacity: 0.7 }}>
        {player.position}
      </span>

      {/* OVR rating — right-aligned, tabular numerals for column alignment */}
      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        <span style={{ fontSize: '10px', opacity: 0.5 }}>OVR </span>
        {player.overall_rating}
      </span>
    </div>
  );
}

/**
 * Returns a single zeroed record row for a given team name.
 *
 * Used for Season Stats and Historic Stats tables pre-season.
 * When match results are persisted, the caller will replace this with
 * a selector reading from the results store.
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
 * Reads :teamId from the URL, fetches the team from Supabase (including its
 * parent league and squad), and renders the full team page: hero, info card,
 * season/historic stats, trophy cabinet, and all five player stat tables.
 *
 * Renders loading, "team not found" (404), and generic error fallbacks as
 * appropriate.  The main render only runs once all data is ready.
 *
 * @returns {JSX.Element}
 */
export default function TeamDetail() {
  // ── Route param ────────────────────────────────────────────────────────────
  const { teamId } = useParams();

  // ── Data fetch ────────────────────────────────────────────────────────────
  // Re-fetch whenever teamId changes so navigating between team pages (e.g.
  // via the teams listing) always loads the correct data without a full remount.
  const [team,    setTeam]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error,   setError]   = useState(false);

  useEffect(() => {
    // Reset state before each fetch so stale data from a previous team doesn't
    // flash while the new request is in flight.
    setTeam(null);
    setLoading(true);
    setNotFound(false);
    setError(false);

    getTeam(teamId)
      .then(raw => {
        setTeam(normalizeTeam(raw));
        setLoading(false);
      })
      .catch(err => {
        // Supabase returns an error (not null data) when .single() finds no row.
        // Treat "no rows" as a 404; all other errors as generic failures.
        if (err?.code === 'PGRST116') {
          setNotFound(true);
        } else {
          setError(true);
        }
        setLoading(false);
      });
  }, [teamId]);

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="container" style={{ paddingTop: '80px', textAlign: 'center' }}>
        <p style={{ opacity: 0.5, fontSize: '14px' }}>Loading team…</p>
      </div>
    );
  }

  // ── 404 fallback ──────────────────────────────────────────────────────────
  if (notFound) {
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

  // ── Generic error fallback ────────────────────────────────────────────────
  if (error || !team) {
    return (
      <div className="container" style={{ paddingTop: '80px', textAlign: 'center' }}>
        <h2>Something went wrong</h2>
        <p style={{ marginTop: '16px', opacity: 0.6 }}>
          Could not load team data. Please try again later.
        </p>
        <Link to="/teams" style={{ display: 'inline-block', marginTop: '24px' }}>
          <Button variant="primary">View All Teams</Button>
        </Link>
      </div>
    );
  }

  // ── Derived display values ────────────────────────────────────────────────
  // Pre-compute row data and the league name so JSX below stays readable.
  // leagues is the nested join object from getTeam(); it contains id and name.
  const seasonRows   = zeroRecord(team.name);
  const historicRows = zeroRecord(team.name);
  const trophyRows   = zeroTrophies(team.name);
  const playerRows   = placeholderPlayerRows();
  const leagueId     = team.leagues?.id;
  const leagueName   = team.leagues?.name;

  // Split description on newline characters into separate paragraphs.
  // The DB stores \n as a paragraph separator within description strings.
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
                  Sourced from the nested leagues join object rather than a
                  separate lookup — avoids an extra Supabase round-trip and
                  keeps the data consistent with what the DB actually says.
                  The value is a Link so users can navigate to the league page. */}
              {leagueName && (
                <MetaRow
                  label="League"
                  value={
                    <Link
                      to={`/leagues/${leagueId}`}
                      style={{ color: 'inherit', textDecoration: 'underline', textDecorationColor: 'rgba(255,255,255,0.3)' }}
                    >
                      {leagueName}
                    </Link>
                  }
                />
              )}
              {/* ── Manager ──────────────────────────────────────────────────
                  team.managers is an array from the Supabase join (one-to-many
                  schema).  We take [0] because each club has exactly one active
                  manager.  The block is conditionally rendered so pages load
                  cleanly even before manager seed data is applied. */}
              {team.managers?.[0] && (
                <>
                  <MetaRow label="Manager"       value={team.managers[0].name} />
                  <MetaRow label="Tactical Style" value={team.managers[0].style} />
                </>
              )}
            </div>

            {/* Description paragraphs — split from the \n-delimited string.
                Key uses the paragraph text (sliced to 60 chars) rather than
                array index so React can correctly reconcile if the text order
                ever changes between renders. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {descParagraphs.map((para) => (
                <p key={para.slice(0, 60)} style={{ fontSize: '13px', lineHeight: 1.8, opacity: 0.85 }}>
                  {para}
                </p>
              ))}
            </div>
          </div>
        </section>

        {/* ── Cross-feature actions ──────────────────────────────────────────── */}
        {/* Positioned immediately after the team info card so all key actions
            are visible before the user scrolls into the stats tables.
            - Simulate a Match → Matches page (fixture selector)
            - Browse League    → parent league's standings + player-stat tables
            - View Players     → Players page filtered to this league's clubs   */}
        <section className="section" style={{ paddingTop: '8px' }}>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <Link to="/matches">
              <Button variant="tertiary">Simulate a Match</Button>
            </Link>
            {leagueId && (
              <Link to={`/leagues/${leagueId}`}>
                <Button variant="primary">Browse League</Button>
              </Link>
            )}
            {leagueId && (
              <Link to={`/players?league=${leagueId}`}>
                <Button variant="primary">View Players</Button>
              </Link>
            )}
          </div>
        </section>

        {/* ── SQUAD ─────────────────────────────────────────────────────────────── */}
        {/* Only rendered when the DB has player rows for this team.  Gated on
            team.players?.length so the section is absent (not empty) for any
            future team that has not yet been seeded.
            buildSquadGroups groups players into GK→DF→MF→FW position buckets,
            each split into a starters block followed by a "Bench" separator and
            the substitute rows.  Player names are Links to /players/:id. */}
        {team.players?.length > 0 && (
          <section className="section">
            <h2 className="section-title">Squad</h2>

            {buildSquadGroups(team.players).map(group => (
              <div key={group.position} style={{ marginBottom: '24px' }}>

                {/* Position group heading — e.g. "DEFENDERS" */}
                <h3 style={{
                  fontSize: '11px',
                  fontWeight: 'bold',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  opacity: 0.5,
                  marginBottom: '6px',
                  borderBottom: '1px solid rgba(255,255,255,0.1)',
                  paddingBottom: '4px',
                }}>
                  {POS_LABEL[group.position]}
                </h3>

                {/* Starting eleven players for this position */}
                {group.starters.map(p => (
                  <SquadRow key={p.id} player={p} />
                ))}

                {/* "Bench" divider — only shown when both starters and bench
                    players exist for this position, so a GK group with one
                    starter and one bench sub doesn't show an orphaned label */}
                {group.bench.length > 0 && group.starters.length > 0 && (
                  <div style={{
                    fontSize: '10px',
                    opacity: 0.35,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    padding: '4px 0',
                    marginTop: '4px',
                  }}>
                    Bench
                  </div>
                )}

                {/* Substitute players — dimmed by SquadRow's isBench prop */}
                {group.bench.map(p => (
                  <SquadRow key={p.id} player={p} isBench />
                ))}
              </div>
            ))}
          </section>
        )}

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
