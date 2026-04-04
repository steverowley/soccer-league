// ── PlayerDetail.jsx ──────────────────────────────────────────────────────────
// Individual player profile page.  Route: /players/:playerId
//
// LAYOUT
// ──────
//   H1: PLAYER NAME
//   ─────────────────────────────
//   Subtitle: [POSITION badge]  ·  TEAM NAME (link)
//
//   ┌─────────────────────────────────────────┐
//   │ PLAYER NAME (card title)                │  ← dark info card
//   │ AGE: 24                                 │
//   │ NATIONALITY: Martian                    │
//   │ OVERALL RATING: 85                      │
//   │ POSITION: FW                            │
//   │ ─────────────────────────────────────── │
//   │ PERSONALITY: ✨ Creative                │  ← icon + label
//   │   "Audacious skill moves; 30%…"         │  ← italicised description
//   └─────────────────────────────────────────┘
//
//   SEASON STATS                 ← dark IslTable
//   MP | Goals | Assists | Yel | Red | Mins | Avg Rtg
//
// DATA SOURCE
// ───────────
// getPlayer(playerId) fetches the player row joined with its parent team
// (for the hero breadcrumb) plus aggregated season stats computed from
// match_player_stats.  avg_rating is null for players with no rated
// appearances; the table cell renders "—" in that case.
//
// PERSONALITY DISPLAY
// ───────────────────
// PERS_ICON (from constants.js) provides the emoji used in the subtitle.
// PERS_DESC (defined locally here) provides the one-line mechanical
// description shown as italicised flavour text — it is display copy, not
// game logic, so it lives here rather than in constants.js.
//
// Loading, 404, and error fallbacks mirror the pattern used in TeamDetail.jsx.

import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import IslTable from '../components/ui/IslTable';
import Button from '../components/ui/Button';
import MetaRow from '../components/ui/MetaRow';
import { getPlayer } from '../lib/supabase';
import { PERS_ICON } from '../constants';

// ── Personality descriptions ──────────────────────────────────────────────────
// One-line mechanical summaries shown on the player card.  Each value matches
// a key in PERS (constants.js) and explains the in-match effect that
// personality has during simulation (e.g. wonder-goal chance, foul tendency).
// These are intentionally short so they fit in a single card line.
const PERS_DESC = {
  balanced:    'Reliable all-rounder — no special triggers.',
  selfish:     'Shoots from anywhere; misses often but creates chaos.',
  team_player: 'Creates assists and boosts teammates after scoring.',
  aggressive:  'Prone to fouls; picks up yellow and red cards.',
  cautious:    'Snuffs out danger quietly; rarely ventures forward.',
  creative:    'Audacious skill moves; 30% wonder-goal chance.',
  lazy:        'Randomly drops work rate and loses possession.',
  workhorse:   'Sprints at full fatigue; accumulates tiredness.',
};

// ── Season stats column definitions ──────────────────────────────────────────
// Mirrors the column order used in league player-stat tables for visual
// consistency.  avg_rating is last because it is nullable (shows "—" pre-season).
const SEASON_STAT_COLS = [
  { key: 'matches_played', label: 'MP',      align: 'right' },
  { key: 'goals',          label: 'Goals',   align: 'right' },
  { key: 'assists',        label: 'Assists', align: 'right' },
  { key: 'yellow_cards',   label: 'Yel',     align: 'right' },
  { key: 'red_cards',      label: 'Red',     align: 'right' },
  { key: 'minutes_played', label: 'Mins',    align: 'right' },
  { key: 'avg_rating',     label: 'Avg Rtg', align: 'right' },
];

/**
 * Player detail page.
 *
 * Reads :playerId (UUID) from the URL, fetches the player from Supabase
 * via getPlayer() (which includes team name join and aggregated season stats),
 * and renders the full player profile: hero, info card with personality, and
 * a season stats table.
 *
 * Renders loading, 404 ("player not found"), and generic error fallbacks as
 * appropriate.  The main render only runs once all data is ready.
 *
 * @returns {JSX.Element}
 */
export default function PlayerDetail() {
  // ── Route param ────────────────────────────────────────────────────────────
  const { playerId } = useParams();

  // ── Data fetch ────────────────────────────────────────────────────────────
  // Re-fetch whenever playerId changes so navigating between player pages
  // always loads the correct data without a full remount.
  const [player,   setPlayer]   = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error,    setError]    = useState(false);

  useEffect(() => {
    // Reset all state before each fetch so stale data from a previous player
    // doesn't flash while the new request is in flight.
    setPlayer(null);
    setLoading(true);
    setNotFound(false);
    setError(false);

    getPlayer(playerId)
      .then(data => {
        setPlayer(data);
        setLoading(false);
      })
      .catch(err => {
        // PGRST116 = "no rows returned" from .single() → treat as 404.
        // Any other error is a genuine DB/network failure.
        if (err?.code === 'PGRST116') {
          setNotFound(true);
        } else {
          setError(true);
        }
        setLoading(false);
      });
  }, [playerId]);

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="container" style={{ paddingTop: '80px', textAlign: 'center' }}>
        <p style={{ opacity: 0.5, fontSize: '14px' }}>Loading player…</p>
      </div>
    );
  }

  // ── 404 fallback ──────────────────────────────────────────────────────────
  if (notFound) {
    return (
      <div className="container" style={{ paddingTop: '80px', textAlign: 'center' }}>
        <h2>Player not found</h2>
        <p style={{ marginTop: '16px', opacity: 0.6 }}>
          No player exists with this id.
        </p>
        <Link to="/players" style={{ display: 'inline-block', marginTop: '24px' }}>
          <Button variant="primary">View All Players</Button>
        </Link>
      </div>
    );
  }

  // ── Generic error fallback ────────────────────────────────────────────────
  if (error || !player) {
    return (
      <div className="container" style={{ paddingTop: '80px', textAlign: 'center' }}>
        <h2>Something went wrong</h2>
        <p style={{ marginTop: '16px', opacity: 0.6 }}>
          Could not load player data. Please try again later.
        </p>
        <Link to="/players" style={{ display: 'inline-block', marginTop: '24px' }}>
          <Button variant="primary">View All Players</Button>
        </Link>
      </div>
    );
  }

  // ── Derived display values ────────────────────────────────────────────────
  // teams is the nested join object returned by getPlayer(); it contains id
  // and name.  team_id is the raw FK slug used for the Link href.
  const teamName = player.teams?.name;
  const teamId   = player.team_id;

  // Personality icon from constants.js; description from local PERS_DESC.
  // Falls back to empty string if an unrecognised personality key is encountered.
  const persIcon = PERS_ICON[player.personality] ?? '';
  const persDesc = PERS_DESC[player.personality]  ?? '';

  // ── Season stats row ──────────────────────────────────────────────────────
  // IslTable expects an array of row objects keyed to SEASON_STAT_COLS.
  // avg_rating is replaced with '—' (string) when null so the table cell
  // shows a meaningful placeholder rather than blank or "0.0".
  const statsRow = [{
    id: 'season',
    ...player.seasonStats,
    avg_rating: player.seasonStats.avg_rating ?? '—',
  }];

  return (
    <div>
      {/* ── Page hero ─────────────────────────────────────────────────────────── */}
      {/* .page-hero provides the standard centred layout and vertical padding.
          The subtitle row shows a position badge and a link to the player's club. */}
      <div className="page-hero">
        <div className="container">
          <h1 style={{ marginBottom: '16px' }}>{player.name}</h1>
          <hr className="divider" style={{ maxWidth: '500px', margin: '0 auto 16px' }} />

          <p className="subtitle">
            {/* ── Jersey number badge ─────────────────────────────────────────
                Appears before the position pill so the hero reads as
                "#9 · FW · Club" — the natural way fans refer to players.
                Slightly lower opacity (0.75) than the position badge so
                number and position form a clear hierarchy at a glance.
                jersey_number is null for players whose seed has not yet run;
                the conditional guard prevents rendering an empty badge. */}
            {player.jersey_number != null && (
              <span style={{
                display: 'inline-block',
                padding: '2px 8px',
                border: '1px solid rgba(255,255,255,0.3)',
                borderRadius: '3px',
                fontSize: '11px',
                fontWeight: 'bold',
                letterSpacing: '0.08em',
                marginRight: '10px',
                opacity: 0.75,
              }}>
                #{player.jersey_number}
              </span>
            )}

            {/* ── Position badge ──────────────────────────────────────────────
                Inline bordered pill showing the two/three-letter position code.
                Uses the same border-opacity convention as other ghost elements. */}
            <span style={{
              display: 'inline-block',
              padding: '2px 8px',
              border: '1px solid rgba(255,255,255,0.3)',
              borderRadius: '3px',
              fontSize: '11px',
              fontWeight: 'bold',
              letterSpacing: '0.08em',
              marginRight: '10px',
            }}>
              {player.position}
            </span>

            {/* ── Team link ────────────────────────────────────────────────────
                Links to the team's detail page so users can navigate the roster
                in either direction (team → player or player → team). */}
            {teamName && (
              <Link
                to={`/teams/${teamId}`}
                style={{
                  color: 'inherit',
                  textDecoration: 'underline',
                  textDecorationColor: 'rgba(255,255,255,0.4)',
                }}
              >
                {teamName}
              </Link>
            )}
          </p>
        </div>
      </div>

      <div className="container" style={{ paddingBottom: '40px' }}>

        {/* ── Player info card ──────────────────────────────────────────────── */}
        {/* Dark bordered card matching the team info card style in TeamDetail.
            Structured metadata sits above the personality block, separated by
            a faint horizontal rule so the personality reads as a distinct section. */}
        <section className="section">
          <div className="card">
            <h3 className="card-title">{player.name}</h3>

            {/* Structured metadata block.
                Number is listed first — it is the most immediately recognisable
                identifier for a player (fans say "the number 9" more often than
                "the forward").  jersey_number is null for players whose seed
                UPDATE has not yet run; the '—' fallback keeps the row visible
                without showing a confusing "null" or "0". */}
            <div style={{ marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <MetaRow label="Number"         value={player.jersey_number != null ? `#${player.jersey_number}` : '—'} />
              <MetaRow label="Age"            value={player.age} />
              <MetaRow label="Nationality"    value={player.nationality} />
              <MetaRow label="Overall Rating" value={player.overall_rating} />
              <MetaRow label="Position"       value={player.position} />
            </div>

            {/* ── Personality block ─────────────────────────────────────────
                Separated from the metadata above by a faint rule so it reads
                as a thematic section rather than just another label/value row.
                The icon (from PERS_ICON) gives instant visual identification;
                the description (from PERS_DESC) explains the mechanical effect
                in plain language. */}
            <div style={{
              borderTop: '1px solid rgba(255,255,255,0.12)',
              paddingTop: '12px',
              marginTop: '4px',
            }}>
              <p style={{ fontSize: '13px', marginBottom: '6px' }}>
                <strong style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Personality:
                </strong>
                {' '}{persIcon}{' '}
                <span style={{ textTransform: 'capitalize' }}>
                  {/* Replace underscore with space for display (e.g. team_player → team player) */}
                  {player.personality?.replace('_', ' ')}
                </span>
              </p>

              {/* Mechanical description — italic flavour text explaining the
                  in-simulation effect of this personality type */}
              {persDesc && (
                <p style={{
                  fontSize: '12px',
                  opacity: 0.7,
                  lineHeight: 1.7,
                  fontStyle: 'italic',
                  paddingLeft: '4px',
                }}>
                  {persDesc}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* ── Season Stats ──────────────────────────────────────────────────── */}
        {/* Dark table variant (matching Season Stats on TeamDetail) rather than
            the light StatTable variant, since this is primary data not a
            comparison widget.  All-zero rows are expected pre-season. */}
        <section className="section">
          <h2 className="section-title">Season Stats</h2>
          <IslTable variant="dark" columns={SEASON_STAT_COLS} rows={statsRow} />
        </section>

      </div>
    </div>
  );
}
