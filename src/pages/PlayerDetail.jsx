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
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import { PERS_ICON } from '../constants';

// ── Cosmic Architect lore key ─────────────────────────────────────────────────
// The persistent lore object is stored in localStorage under this key by
// CosmicArchitect._saveLore().  PlayerDetail reads it directly (no Supabase
// query) because lore is client-side only — it accumulates in the browser that
// ran the matches and is never persisted to the DB.
const LORE_KEY = 'isi_cosmic_lore';

// ── Relationship type display labels ─────────────────────────────────────────
// Human-readable labels for the 8 relationship types stored in lore.
// Each label is intentionally cryptic / cosmic-sounding rather than literal —
// fans should sense the emotional weight without being handed an explanation.
//   rivalry          — heated on-pitch competition, contest bias applied
//   grudge           — historical animosity, elevated card severity
//   partnership      — chemistry bonus on shared sequences
//   mentor_pupil     — guidance modifier on younger player contests
//   former_teammates — hesitation debuff when facing ex-colleagues
//   mutual_respect   — cleaner play (lower card bias)
//   national_rivals  — international tension (moderate card bias)
//   captain_vs_rebel — authority conflict; modifies captain bonus vs target
const RELATIONSHIP_LABELS = {
  rivalry:           'Rivals',
  grudge:            'Grudge',
  partnership:       'Partnership',
  mentor_pupil:      'Mentor & Pupil',
  former_teammates:  'Former Teammates',
  mutual_respect:    'Mutual Respect',
  national_rivals:   'National Rivals',
  captain_vs_rebel:  'Captain vs. Rebel',
};

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
  const db = useSupabase();

  // ── Route param ────────────────────────────────────────────────────────────
  const { playerId } = useParams();

  // ── Data fetch ────────────────────────────────────────────────────────────
  // Re-fetch whenever playerId changes so navigating between player pages
  // always loads the correct data without a full remount.
  const [player,   setPlayer]   = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error,    setError]    = useState(false);

  // ── Cosmic lore ───────────────────────────────────────────────────────────
  // Read from localStorage after the player resolves so we have a name to
  // look up.  Kept in separate state from the DB fetch to avoid coupling
  // the lore read to the Supabase request lifecycle.
  //
  //   playerArc     — The Architect's running narrative for this player:
  //                   { team, arc } from lore.playerArcs[player.name].
  //                   null when no matches have been played or this player
  //                   has not been featured by The Architect yet.
  //
  //   relationships — Array of { otherName, type, intensity, thread } entries
  //                   extracted from lore.playerRelationships where either
  //                   side of the relationship key matches this player's name.
  //                   Empty array when no relationships exist.
  const [playerArc,      setPlayerArc]      = useState(null);
  const [relationships,  setRelationships]  = useState([]);

  useEffect(() => {
    // Reset all state before each fetch so stale data from a previous player
    // doesn't flash while the new request is in flight.
    setPlayer(null);
    setLoading(true);
    setNotFound(false);
    setError(false);

    getPlayer(db, playerId)
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
  }, [playerId, db]);

  // ── Cosmic lore read ──────────────────────────────────────────────────────
  // Reads the CosmicArchitect's persisted lore from localStorage once the
  // player record has resolved (we need player.name to look up the entries).
  //
  // WHY LOCALSTORAGE DIRECTLY
  // ──────────────────────────
  // Lore is generated and stored client-side by CosmicArchitect._saveLore()
  // during match simulation.  It is never written to Supabase, so there is no
  // API call to make here — a direct localStorage read is the correct approach.
  //
  // RELATIONSHIP KEY FORMAT
  // ────────────────────────
  // Keys are constructed by sorting both player names and joining with '_vs_'
  // (cross-team) or '_and_' (same-team).  We check both separators and both
  // orderings by testing whether the key contains the player's name as a
  // substring — safe because player names are unique within the league.
  useEffect(() => {
    if (!player?.name) return;

    try {
      const raw = localStorage.getItem(LORE_KEY);
      if (!raw) return;
      const lore = JSON.parse(raw);

      // ── Player arc ────────────────────────────────────────────────────────
      // { team, arc } — the Architect's running narrative for this player.
      // null-guarded: playerArcs may be absent on older lore schema versions.
      const arc = lore?.playerArcs?.[player.name] || null;
      setPlayerArc(arc);

      // ── Relationships ─────────────────────────────────────────────────────
      // Iterate all relationship keys and collect those where this player's
      // name appears on either side.  Extract the other player's name by
      // splitting on '_vs_' or '_and_' and picking the non-matching half.
      const rels = [];
      const relMap = lore?.playerRelationships || {};
      for (const [key, rel] of Object.entries(relMap)) {
        // Check both separators — cross-team uses '_vs_', same-team '_and_'.
        const sep = key.includes('_vs_') ? '_vs_' : '_and_';
        const [nameA, nameB] = key.split(sep);
        if (nameA !== player.name && nameB !== player.name) continue;
        const otherName = nameA === player.name ? nameB : nameA;
        rels.push({ otherName, type: rel.type, intensity: rel.intensity, thread: rel.thread });
      }
      // Sort by intensity descending so the most significant bond appears first.
      rels.sort((a, b) => (b.intensity || 0) - (a.intensity || 0));
      setRelationships(rels);
    } catch {
      // Malformed lore JSON is silently ignored — the section simply won't render.
    }
  }, [player?.name]);

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
          <h1>{player.name}</h1>
          <hr className="divider" />

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
                border: '1px solid rgba(227,224,213,0.3)',
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
              border: '1px solid rgba(227,224,213,0.3)',
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
                  textDecorationColor: 'rgba(227,224,213,0.4)',
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
              borderTop: '1px solid rgba(227,224,213,0.12)',
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
            Light variant — cream/dust background contrasts against the
            Galactic Abyss page background, matching the Figma design spec
            for all data tables on detail pages.
            All-zero rows are expected pre-season. */}
        <section className="section">
          <h2 className="section-title">Season Stats</h2>
          <IslTable variant="light" columns={SEASON_STAT_COLS} rows={statsRow} />
        </section>

        {/* ── The Convergence ───────────────────────────────────────────────
            The Architect's accumulated record for this mortal — arcs and
            bonds written across every match they have appeared in.
            Only rendered when lore exists in localStorage.  No explanation
            is given; fans sense the depth and theorise. */}
        {(playerArc || relationships.length > 0) && (
          <section className="section">

            {/* ── Outer void container ─────────────────────────────────────
                The whole section sits inside a void-black portal matching
                the match-page Architect aesthetic: deep black bg, radial
                violet bloom, architectPulse glow, 4 px left accent border. */}
            <div style={{
              backgroundColor: 'var(--color-architect-bg)',
              backgroundImage: 'radial-gradient(ellipse at 15% 40%, rgba(124,58,237,0.10) 0%, transparent 60%)',
              border: '1px solid rgba(157,111,251,0.20)',
              borderLeft: '4px solid var(--color-architect-accent)',
              animation: 'architectPulse 3s ease-in-out infinite',
              padding: '20px 20px 16px',
            }}>

              {/* ── Section title ─────────────────────────────────────────
                  Styled identically to the match title in App.jsx:
                  small uppercase text, wide letter-spacing, ∷ delimiters,
                  violet glow.  The title IS the only explanation — no
                  sub-heading, no description beneath it. */}
              <div style={{
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '0.20em',
                textTransform: 'uppercase',
                color: 'var(--color-architect-accent)',
                textShadow: '0 0 10px rgba(157,111,251,0.55)',
                marginBottom: '18px',
                textAlign: 'center',
              }}>
                ∷ THE CONVERGENCE ∷
              </div>

              {/* ── Player arc ────────────────────────────────────────────
                  The Architect's running thread for this player across all
                  matches.  Displayed as a plain italic quote — no label,
                  no sub-heading — so it reads as a decree, not a data field. */}
              {playerArc?.arc && (
                <p style={{
                  fontSize: '13px',
                  fontStyle: 'italic',
                  lineHeight: 1.65,
                  color: 'var(--color-architect-text)',
                  margin: '0 0 16px',
                  paddingBottom: relationships.length > 0 ? '16px' : 0,
                  borderBottom: relationships.length > 0
                    ? '1px solid rgba(157,111,251,0.15)'
                    : 'none',
                }}>
                  "{playerArc.arc}"
                </p>
              )}

              {/* ── Relationship bonds ────────────────────────────────────
                  Each entry is a player-pair bond.  The type label + other
                  player name are on one line; the thread (Architect's prose)
                  sits below.  Intensity encoded as a ● dot — size and
                  opacity scale with 0–1 intensity, no numeric label shown. */}
              {relationships.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {relationships.map((rel, i) => (
                    <div key={i} style={{
                      padding: '10px 0 10px 12px',
                      borderLeft: '2px solid rgba(157,111,251,0.35)',
                    }}>
                      <div style={{
                        display: 'flex', alignItems: 'center',
                        justifyContent: 'space-between', marginBottom: '5px',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{
                            fontSize: '8px', fontWeight: 700, letterSpacing: '0.14em',
                            textTransform: 'uppercase', color: 'var(--color-architect-accent)', opacity: 0.7,
                          }}>
                            {RELATIONSHIP_LABELS[rel.type] || rel.type}
                          </span>
                          <span style={{ fontSize: '12px', fontWeight: 700, color: '#E3E0D5' }}>
                            {rel.otherName}
                          </span>
                        </div>
                        <span style={{
                          color: 'var(--color-architect-accent)',
                          fontSize: `${8 + Math.round((rel.intensity || 0) * 6)}px`,
                          opacity: 0.3 + (rel.intensity || 0) * 0.7,
                        }}>●</span>
                      </div>
                      {rel.thread && (
                        <p style={{
                          fontSize: '11px', fontStyle: 'italic',
                          color: 'var(--color-architect-muted)', lineHeight: 1.5, margin: 0,
                        }}>
                          {rel.thread}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

            </div>
          </section>
        )}

      </div>
    </div>
  );
}
