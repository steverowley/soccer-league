// ── TeamDetail.jsx ────────────────────────────────────────────────────────────
// Individual team page.  Implements the Figma team detail layout for all teams
// via the :teamId URL param:
//
//   H1: MERCURY RUNNERS FC   ← centred page title + tagline
//   ─────────────────────────────
//   ┌──────────────────────────────────────────────────────────┐
//   │ ○  MERCURY RUNNERS FC   ← info card: badge + meta + prose│
//   │    LOCATION / HOME GROUND / CAPACITY / MANAGER          │
//   │    [description paragraphs]                             │
//   └──────────────────────────────────────────────────────────┘
//
//   ┌─────────────────────┐  ┌──────────────────────────────┐
//   │  NEXT MATCH         │  │  TEAM FORM                   │
//   │  (next fixture)     │  │  (last 5 W/D/L indicators)   │
//   └─────────────────────┘  └──────────────────────────────┘
//
//   SQUAD                 ← GK→DF→MF→FW, jersey-number order
//   SEASON STATS          ← light table
//   HISTORIC STATS        ← light table
//   TROPHY CABINET        ← light table
//
//   TOP SCORERS | TOP ASSISTS       ← StatTable (light, SEE MORE)
//   TOP CLEAN SHEETS                ← StatTable half-width (light, SEE MORE)
//   MOST YELLOW CARDS | MOST RED CARDS  ← StatTable (light, SEE MORE)
//
//   ◄ LEAGUE STANDINGS — {LEAGUE} ►  ← light table, bottom anchor
//
// DATA SOURCE
// ───────────
// Team data is fetched from Supabase via getTeam(teamId) on mount.
// Next match is fetched from the `matches` table filtered to this team
// with status='scheduled', ordered by created_at ASC (earliest first).
// Team form (last 5 W/D/L) is computed from localStorage via getResults().
// League standings are computed the same way as LeagueDetail via
// computeStandings() + buildStandingsRows() — no extra Supabase call needed.

import { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import IslTable from '../components/ui/IslTable';
import StatTable from '../components/ui/StatTable';
import Button from '../components/ui/Button';
import MetaRow from '../components/ui/MetaRow';
import { getTeam, normalizeTeam } from '../lib/supabase';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import {
  SCORER_COLS, ASSISTS_COLS, CARDS_COLS, CLEAN_SHEETS_COLS,
  STANDINGS_COLS, placeholderPlayerRows, buildStandingsRows,
} from '../data/leagueData';
import { computeStandings, getResults } from '../lib/matchResultsService';
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
 * Group a flat players array into position buckets sorted GK → DF → MF → FW.
 * Within each bucket players are sorted by jersey_number ascending so the squad
 * list reads in shirt-number order (1, 2, 3 … 16) without any starter/bench
 * split — bench players appear inline between their positional peers, numbered
 * after the starters in the same position group.
 *
 * Positions not recognised in POS_ORDER fall to the end (weight 9) so that
 * any future position codes degrade gracefully rather than crashing.
 *
 * Players without a jersey_number (e.g. a freshly-inserted DB row whose seed
 * UPDATE has not yet run) sort to the end of their position group via the
 * ?? 99 fallback — they remain visible rather than being hidden or erroring.
 *
 * @param {Array<{position: string, jersey_number: number|null,
 *                overall_rating: number}>} players
 *   Raw players array from the Supabase team join.
 * @returns {Array<{position: string, players: Array}>}
 *   One entry per distinct position, sorted in field order (GK first).
 *   Each entry's players array is sorted by jersey_number ascending.
 */
function buildSquadGroups(players) {
  if (!players?.length) return [];

  // Sort a copy so we never mutate the original state array.
  // Primary key: position order (GK=0, DF=1, MF=2, FW=3).
  // Secondary key: jersey_number ascending — starters get lower numbers
  // (1–11) and bench players get higher numbers (12–16) from the seed, so
  // this naturally shows starters first without an explicit starter sort.
  const sorted = [...players].sort((a, b) => {
    const posDiff = (POS_ORDER[a.position] ?? 9) - (POS_ORDER[b.position] ?? 9);
    if (posDiff !== 0) return posDiff;
    return (a.jersey_number ?? 99) - (b.jersey_number ?? 99);
  });

  // Build a map keyed by position; all players for a position go into a single
  // flat array — no starter/bench split.
  const groups = {};
  for (const p of sorted) {
    if (!groups[p.position]) {
      groups[p.position] = { position: p.position, players: [] };
    }
    groups[p.position].players.push(p);
  }

  // Return as an array in POS_ORDER sequence (GK → DF → MF → FW).
  return Object.values(groups).sort(
    (a, b) => (POS_ORDER[a.position] ?? 9) - (POS_ORDER[b.position] ?? 9)
  );
}

/**
 * Single player row in the Squad section of the team page.
 *
 * Four-column grid:
 *   jersey_number (28 px) · player name (flex) · position code (40 px) · OVR (48 px)
 *
 * All players — starters and bench alike — render at full opacity.  The bench
 * divider that previously separated them has been removed; jersey numbers give
 * enough context (1–11 = starters, 12+ = bench) without hiding bench players.
 *
 * @param {{ id: string, name: string, position: string,
 *            overall_rating: number, jersey_number: number|null }} player
 * @returns {JSX.Element}
 */
function SquadRow({ player }) {
  return (
    <div style={{
      display: 'grid',
      // Fixed 28 px number column · flexible name · fixed position · fixed OVR.
      // 28 px comfortably fits two-digit numbers (10, 11 … 16) at 10 px font.
      gridTemplateColumns: '28px 1fr 40px 48px',
      gap: '8px',
      padding: '5px 0',
      borderBottom: '1px solid rgba(227,224,213,0.06)',
      fontSize: '12px',
    }}>
      {/* Jersey number — right-aligned within its column so single- and
          double-digit numbers align along the right edge.  Muted at 0.5
          opacity so it reads as metadata rather than primary content. */}
      <span style={{
        fontSize: '10px',
        fontVariantNumeric: 'tabular-nums',
        opacity: 0.5,
        textAlign: 'right',
        paddingRight: '4px',
        alignSelf: 'center',
      }}>
        {player.jersey_number ?? '—'}
      </span>

      {/* Player name — links to their individual profile page */}
      <Link
        to={`/players/${player.id}`}
        style={{
          color: 'inherit',
          textDecoration: 'underline',
          textDecorationColor: 'rgba(227,224,213,0.3)',
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

  // ── Supabase client (dependency injection) ─────────────────────────────────
  // Components never import the supabase singleton directly — they consume it
  // via context so unit tests can swap in a mock client without patching modules.
  const db = useSupabase();

  // ── Data fetch ────────────────────────────────────────────────────────────
  // Re-fetch whenever teamId changes so navigating between team pages (e.g.
  // via the teams listing) always loads the correct data without a full remount.
  const [team,    setTeam]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error,   setError]   = useState(false);

  // ── Next match fetch ──────────────────────────────────────────────────────
  // Fetches the earliest scheduled fixture involving this team from Supabase.
  // WHY a separate useEffect: the team fetch and next-match fetch are
  // independent — the team page should render fully even if the matches
  // query fails, so we keep them separate rather than blocking on both.
  const [nextMatch, setNextMatch] = useState(null);
  useEffect(() => {
    if (!teamId) return;
    let cancelled = false;
    // Two parallel queries (home and away) because Supabase .or() on FK
    // columns requires explicit casting that varies by Postgres version —
    // querying separately and merging is more portable and easier to read.
    Promise.all([
      db
        .from('matches')
        .select('id, round, stadium, played_at, away_team:teams!matches_away_team_id_fkey(id, name, color)')
        .eq('home_team_id', teamId)
        .eq('status', 'scheduled')
        .order('created_at', { ascending: true })
        .limit(1),
      db
        .from('matches')
        .select('id, round, stadium, played_at, home_team:teams!matches_home_team_id_fkey(id, name, color)')
        .eq('away_team_id', teamId)
        .eq('status', 'scheduled')
        .order('created_at', { ascending: true })
        .limit(1),
    ]).then(([homeRes, awayRes]) => {
      if (cancelled) return;
      // Merge the two single-row results, attach a venue flag so the card
      // can label the fixture "(H)" or "(A)", then pick the earliest one.
      const candidates = [
        ...(homeRes.data ?? []).map(m => ({ ...m, venue: 'H' })),
        ...(awayRes.data  ?? []).map(m => ({ ...m, venue: 'A' })),
      ];
      if (candidates.length === 0) { setNextMatch(null); return; }
      // Sort by played_at ascending; rows without a date sort to the end.
      candidates.sort((a, b) => {
        if (!a.played_at && !b.played_at) return 0;
        if (!a.played_at) return 1;
        if (!b.played_at) return -1;
        return new Date(a.played_at) - new Date(b.played_at);
      });
      setNextMatch(candidates[0]);
    }).catch(() => { if (!cancelled) setNextMatch(null); }); // non-fatal — card shows "TBD"
    return () => { cancelled = true; };
  }, [teamId, db]);

  useEffect(() => {
    // Reset state before each fetch so stale data from a previous team doesn't
    // flash while the new request is in flight.
    setTeam(null);
    setLoading(true);
    setNotFound(false);
    setError(false);

    getTeam(db, teamId)
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
  }, [teamId, db]);

  // ── Derived memos — must be before early returns to satisfy Rules of Hooks ──
  const standingsRows = useMemo(
    () => {
      const lid = team?.leagues?.id;
      return lid ? computeStandings(lid, buildStandingsRows(lid)) : [];
    },
    [team?.leagues?.id]
  );

  const teamForm = useMemo(() => {
    if (!team?.id) return [];
    const all = getResults();
    return all
      .filter(r => r.homeTeamId === team.id || r.awayTeamId === team.id)
      .slice(0, 5)
      .map(r => {
        const isHome = r.homeTeamId === team.id;
        const gf = isHome ? r.homeScore : r.awayScore;
        const ga = isHome ? r.awayScore : r.homeScore;
        if (gf > ga)  return { result: 'W', gf, ga, opponent: isHome ? r.awayTeamName : r.homeTeamName };
        if (gf === ga) return { result: 'D', gf, ga, opponent: isHome ? r.awayTeamName : r.homeTeamName };
        return           { result: 'L', gf, ga, opponent: isHome ? r.awayTeamName : r.homeTeamName };
      });
  }, [team?.id]);

  const cleanSheetRows = useMemo(() => placeholderPlayerRows(), []);

  // ── Loading / 404 / error states ─────────────────────────────────────────
  // WHY page-hero wrapper: keeps the top spacing (100px desktop / 70px mobile)
  // identical to the ready state so the page chrome never jumps on load.
  if (loading) {
    return (
      <div className="page-hero">
        <div className="container">
          <p style={{ opacity: 0.5, fontSize: '14px' }}>Loading team…</p>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="page-hero">
        <div className="container">
          <h2>Team not found</h2>
          <p style={{ marginTop: '16px', opacity: 0.6 }}>
            No team exists with the id "{teamId}".
          </p>
          <Link to="/teams" style={{ display: 'inline-block', marginTop: '24px' }}>
            <Button variant="primary">View All Teams</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (error || !team) {
    return (
      <div className="page-hero">
        <div className="container">
          <h2>Something went wrong</h2>
          <p style={{ marginTop: '16px', opacity: 0.6 }}>
            Could not load team data. Please try again later.
          </p>
          <Link to="/teams" style={{ display: 'inline-block', marginTop: '24px' }}>
            <Button variant="primary">View All Teams</Button>
          </Link>
        </div>
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
          <h1>{team.name}</h1>
          <hr className="divider" />
          <p className="subtitle">{team.tagline}</p>
        </div>
      </div>

      <div className="container" style={{ paddingBottom: '40px' }}>

        {/* ── Team info card ────────────────────────────────────────────────── */}
        {/* Full-width card: badge circle (top-left) → team name → meta rows →
            description prose.  Matches the Figma team detail info block.
            The badge circle uses the team's primary brand colour at 20% opacity
            as a fill so each club has a distinct identity before real crests
            are added — same pattern as the Teams listing cards. */}
        <section className="section">
          <div className="card">
            {/* ── Brand badge circle ──────────────────────────────────────────
                80×80px — matches Teams listing card size (Figma detail spec).
                team.color is the primary brand hex from the DB seed. */}
            <div style={{
              width: 80,
              height: 80,
              borderRadius: '50%',
              backgroundColor: team.color ? `${team.color}33` : 'rgba(227,224,213,0.1)',
              border: `1px solid ${team.color ? `${team.color}66` : 'rgba(227,224,213,0.2)'}`,
              marginBottom: '16px',
              flexShrink: 0,
            }} />

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
                      style={{ color: 'inherit', textDecoration: 'underline', textDecorationColor: 'rgba(227,224,213,0.3)' }}
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

        {/* ── NEXT MATCH | TEAM FORM — 2-column ────────────────────────────────── */}
        {/* Figma spec: two equal-width cards side by side immediately below the
            info card.  Left card shows the next scheduled fixture; right card
            shows the last 5 W/D/L indicators as coloured dots.
            The stats-two-col responsive class collapses to 1-col on mobile. */}
        <section className="section">
          <div
            className="stats-two-col"
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px' }}
          >
            {/* ── NEXT MATCH card ─────────────────────────────────────────────
                nextMatch is null when the fetch is still in flight OR when no
                scheduled fixture exists — both render the same "TBD" state so
                the layout is stable rather than shifting. */}
            <div className="card">
              <h3 className="section-title" style={{ marginBottom: '16px' }}>Next Match</h3>
              {nextMatch ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {/* Venue indicator — "(H)" home or "(A)" away */}
                  {nextMatch.venue && (
                    <span style={{ fontSize: '11px', opacity: 0.5, letterSpacing: '0.08em' }}>
                      {nextMatch.venue === 'H' ? 'HOME' : 'AWAY'}
                    </span>
                  )}
                  {/* Opponent name + their badge circle */}
                  {(nextMatch.away_team || nextMatch.home_team) && (() => {
                    const opp = nextMatch.away_team ?? nextMatch.home_team;
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{
                          width: 40,
                          height: 40,
                          borderRadius: '50%',
                          backgroundColor: opp.color ? `${opp.color}33` : 'rgba(227,224,213,0.1)',
                          border: `1px solid ${opp.color ? `${opp.color}66` : 'rgba(227,224,213,0.2)'}`,
                          flexShrink: 0,
                        }} />
                        <span style={{ fontSize: '14px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          {opp.name}
                        </span>
                      </div>
                    );
                  })()}
                  {/* Date/time — shown when played_at is set; "TBD" otherwise */}
                  <p style={{ fontSize: '12px', opacity: 0.6, marginTop: '4px' }}>
                    {nextMatch.played_at
                      ? new Date(nextMatch.played_at).toLocaleString(undefined, {
                          month: 'short', day: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })
                      : 'Date TBD'}
                  </p>
                  {nextMatch.stadium && (
                    <MetaRow label="Ground" value={nextMatch.stadium} fontSize="11px" />
                  )}
                  {nextMatch.round && (
                    <MetaRow label="Round" value={nextMatch.round} fontSize="11px" />
                  )}
                </div>
              ) : (
                <p style={{ fontSize: '13px', opacity: 0.5 }}>No fixture scheduled.</p>
              )}
            </div>

            {/* ── TEAM FORM card ───────────────────────────────────────────────
                Shows the last 5 match outcomes as coloured dot indicators:
                  Green (--color-green) = Win, Grey (dust @ 30%) = Draw,
                  Red (#e05252)   = Loss
                Pre-season (no results in localStorage) renders 5 grey dots
                as placeholder so the card height is stable. */}
            <div className="card">
              <h3 className="section-title" style={{ marginBottom: '16px' }}>Team Form</h3>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                {(teamForm.length > 0 ? teamForm : Array(5).fill(null)).map((entry, i) => {
                  // Colour map: W=green, D=muted dust, L=Solar Flare red.
                  // These values mirror the pill colours used in the match
                  // feed so the visual language is consistent across pages.
                  const color =
                    entry?.result === 'W' ? 'var(--color-green)' :
                    entry?.result === 'L' ? 'var(--color-red)' :
                    'rgba(227,224,213,0.3)';
                  const label = entry?.result ?? '—';
                  return (
                    <div
                      key={i}
                      title={entry ? `${entry.result} ${entry.gf}–${entry.ga} vs ${entry.opponent}` : 'No result'}
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: '50%',
                        backgroundColor: color,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '11px',
                        fontWeight: 700,
                        color: entry?.result ? 'var(--color-abyss)' : 'rgba(227,224,213,0.4)',
                        letterSpacing: '0.05em',
                        flexShrink: 0,
                      }}
                    >
                      {label}
                    </div>
                  );
                })}
              </div>
              {/* Recent result scorelines below the dots — gives context without
                  exposing raw match stats, in keeping with the hidden-mechanics
                  design principle. */}
              {teamForm.length > 0 && (
                <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {teamForm.map((entry, i) => (
                    <p key={i} style={{ fontSize: '11px', opacity: 0.55 }}>
                      {entry.result} {entry.gf}–{entry.ga} vs {entry.opponent}
                    </p>
                  ))}
                </div>
              )}
            </div>
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

            {/* buildSquadGroups returns one bucket per position (GK→DF→MF→FW).
                Within each bucket all players — starters and bench — are listed
                together in jersey-number order.  No bench divider is shown;
                the number itself signals squad role (1–11 = starter, 12+ = sub). */}
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
                  borderBottom: '1px solid rgba(227,224,213,0.1)',
                  paddingBottom: '4px',
                }}>
                  {POS_LABEL[group.position]}
                </h3>

                {/* All players for this position in jersey-number order */}
                {group.players.map(p => (
                  <SquadRow key={p.id} player={p} />
                ))}
              </div>
            ))}
          </section>
        )}

        {/* ── SEASON STATS ──────────────────────────────────────────────────── */}
        {/* Light variant — cream/dust background against the Galactic Abyss
            page background, matching the Figma design spec for all data
            tables on detail pages. */}
        <section className="section">
          <h2 className="section-title">Season Stats</h2>
          <IslTable variant="light" columns={RECORD_COLS} rows={seasonRows} />
        </section>

        {/* ── HISTORIC STATS ────────────────────────────────────────────────── */}
        <section className="section">
          <h2 className="section-title">Historic Stats</h2>
          <IslTable variant="light" columns={RECORD_COLS} rows={historicRows} />
        </section>

        {/* ── TROPHY CABINET ────────────────────────────────────────────────── */}
        <section className="section">
          <h2 className="section-title">Trophy Cabinet</h2>
          <IslTable variant="light" columns={TROPHY_COLS} rows={trophyRows} />
        </section>

        {/* ── TOP SCORERS | TOP ASSISTS — 2-column ──────────────────────────── */}
        {/* Use the specific SCORER_COLS / ASSISTS_COLS so header labels match
            what the data actually contains (Goals / Assists). */}
        <div
          className="stats-two-col"
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px' }}
        >
          <StatTable title="Top Scorers" columns={SCORER_COLS}  rows={playerRows} />
          <StatTable title="Top Assists" columns={ASSISTS_COLS} rows={playerRows} />
        </div>

        {/* ── TOP CLEAN SHEETS — half-width ─────────────────────────────────── */}
        {/* CLEAN_SHEETS_COLS key:'clean_sheets' — uses cleanSheetRows placeholder
            until matchResultsService.getTopCleanSheets() is implemented.
            Empty right column matches Figma half-width placement. */}
        <div
          className="stats-two-col"
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px' }}
        >
          <StatTable title="Top Clean Sheets" columns={CLEAN_SHEETS_COLS} rows={cleanSheetRows} />
          <div aria-hidden="true" /> {/* intentional empty right column per Figma */}
        </div>

        {/* ── MOST YELLOW CARDS | MOST RED CARDS — 2-column ─────────────────── */}
        {/* CARDS_COLS key:'cards' — playerRows placeholder pre-season. */}
        <div
          className="stats-two-col"
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px' }}
        >
          <StatTable title="Most Yellow Cards" columns={CARDS_COLS} rows={playerRows} />
          <StatTable title="Most Red Cards"    columns={CARDS_COLS} rows={playerRows} />
        </div>

        {/* ── LEAGUE STANDINGS ──────────────────────────────────────────────── */}
        {/* Placed last per the Figma team detail spec — gives fans a quick
            read of where their club sits in the table without navigating away.
            Only rendered when leagueId is present (every seeded team has one).
            standingsRows is pre-computed via useMemo above. */}
        {leagueId && standingsRows.length > 0 && (
          <section className="section">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <span aria-hidden="true" style={{ opacity: 0.5, fontSize: '14px' }}>◄</span>
              <h2 className="section-title" style={{ margin: 0 }}>
                League Standings — {leagueName}
              </h2>
              <span aria-hidden="true" style={{ opacity: 0.5, fontSize: '14px' }}>►</span>
            </div>
            {/* Light variant — cream/dust bg matching all other data tables
                on detail pages per the Figma design spec. */}
            <IslTable variant="light" columns={STANDINGS_COLS} rows={standingsRows} />
          </section>
        )}

      </div>

    </div>
  );
}
