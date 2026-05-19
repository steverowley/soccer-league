// ── PlayerDetail.tsx ──────────────────────────────────────────────────────────
// Player profile page — `/players/:playerId` route.
//
// WHY THIS PAGE EXISTS
//   Idols.tsx and MatchDetail.tsx both link to `/players/:id`; before this
//   page those URLs 404'd.  This is Phase C of the post-nuke rebuild.
//
// WHAT IS SHOWN (and what is intentionally omitted)
//   SHOWN:  Narrative identity — name, team, position, jersey, nationality,
//           age, personality archetype.  Season outcome stats (goals, assists,
//           discipline).  Idol standing (popularity rank inside the universe).
//   OMITTED: Raw engine stats (attacking, defending, mental, athletic,
//           technical) — an explicit non-goal per the game design: "the world
//           is treated like real life."  Fans watch outcomes, not spreadsheets.
//           Exposing engine inputs breaks the Blaseball-inspired hidden-
//           mechanics pillar.
//
// LAYOUT
//   Header (global)
//   I.   Hero           — player identity (name, team, position, bio fields)
//   II.  Season Stats   — outcome stats from match_player_stats aggregate
//   III. Idol Standing  — global rank + popularity data from player_idol_score
//   Footer (global)
//
// DATA STRATEGY
//   `getPlayer` and `getPlayerIdolRank` fire in parallel on mount.  Neither
//   is required for the other — the player identity section renders as soon
//   as the player fetch resolves, even if the idol rank is still loading.
//   Unknown playerId → error state (no redirect, URL stays, error surface
//   shown inline — same pattern as TeamDetail and LeagueDetail).

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import Header from '../components/Header';
import { COLORS, Container, BackLink, Footer } from '../components/Layout';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import { getPlayer, getPlayerIdolRank } from '../lib/supabase';

// ── Design tokens ─────────────────────────────────────────────────────────────
const {
  dust:      DUST,
  quantum:   QUANTUM,
  flare:     FLARE,
  terraNova: TERRA,
  hairline:  HAIRLINE,
  phobosAsh: PHOBOS,
} = COLORS;
const DUST_50 = COLORS.dust50;
const DUST_70 = COLORS.dust70;

// ── Position display map ──────────────────────────────────────────────────────
// Maps the two-letter engine abbreviation stored in the DB to the full
// position label shown in the hero.  Readers see "Goalkeeper", not "GK" —
// the abbreviation is an engine artefact, not a narrative label.
const POSITION_LABEL: Record<string, string> = {
  GK: 'Goalkeeper',
  DF: 'Defender',
  MF: 'Midfielder',
  FW: 'Forward',
};

// ── Local shape helpers ───────────────────────────────────────────────────────
// `getPlayer` returns a wide `PlayerWithStats = { seasonStats, [key]: unknown }`
// shape.  We narrow only the fields this page accesses to keep the compiler
// honest without recreating the full DB row type here.

/** Fields this page reads from the player row. */
interface PlayerFields {
  id:            string;
  name:          string;
  position:      string | null;
  jersey_number: number | null;
  starter:       boolean;
  nationality:   string | null;
  age:           number | null;
  personality:   string | null;
  is_active:     boolean;
  team_id:       string | null;
  /** Joined from teams table by getPlayer. */
  teams:         { id: string; name: string; color?: string | null } | null;
}

/** Aggregated season stats returned alongside the player row. */
interface SeasonStats {
  goals:          number;
  assists:        number;
  yellow_cards:   number;
  red_cards:      number;
  minutes_played: number;
  matches_played: number;
  avg_rating:     number | null;
}

/** Combined shape returned by `getPlayer`. */
interface PlayerWithStats extends PlayerFields {
  seasonStats: SeasonStats;
}

/** Shape returned by `getPlayerIdolRank`. */
interface IdolRank {
  global_rank:        number;
  team_rank:          number;
  favourite_count:    number;
  training_count_14d: number;
  idol_score?:        number;
}

// ── Root page ─────────────────────────────────────────────────────────────────

/**
 * Player profile page.  Fetches the player row + season stats via `getPlayer`,
 * and the idol standing via `getPlayerIdolRank`, in parallel.  Unknown player
 * IDs render an error surface rather than redirecting — consistent with the
 * TeamDetail / LeagueDetail pattern so the user's URL is preserved.
 */
export default function PlayerDetail() {
  const { playerId }  = useParams<{ playerId: string }>();
  const db            = useSupabase();

  const [player,     setPlayer]     = useState<PlayerWithStats | null>(null);
  const [idol,       setIdol]       = useState<IdolRank | null>(null);
  const [playerErr,  setPlayerErr]  = useState<string | null>(null);
  const [playerDone, setPlayerDone] = useState(false);
  const [idolDone,   setIdolDone]   = useState(false);

  // ── Parallel fetch on mount ───────────────────────────────────────────────
  // Both queries fire simultaneously.  `playerDone` and `idolDone` gate their
  // respective loading skeletons independently so the hero renders as soon as
  // the player data arrives without waiting for the idol rank.
  useEffect(() => {
    if (!playerId) return undefined;
    let cancelled = false;

    // Player data (including season stats aggregate)
    getPlayer(playerId)
      .then((p) => {
        if (cancelled) return;
        setPlayer(p as unknown as PlayerWithStats);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setPlayerErr(msg);
      })
      .finally(() => { if (!cancelled) setPlayerDone(true); });

    // Idol rank from player_idol_score view (DI-aware — uses db from context)
    getPlayerIdolRank(db, playerId)
      .then((rank) => {
        if (cancelled) return;
        setIdol(rank as IdolRank | null);
      })
      .catch(() => { /* idol rank is supplementary; silently omit on error */ })
      .finally(() => { if (!cancelled) setIdolDone(true); });

    return () => { cancelled = true; };
  }, [db, playerId]);

  // ── Unknown player ────────────────────────────────────────────────────────
  // Only show the error surface once the player fetch has settled (to avoid
  // a flash of "Unknown Player" while the fetch is in flight).
  if (playerDone && (playerErr || !player)) {
    return (
      <>
        <Header />
        <main>
          <Container>
            <div style={{ padding: '80px 0', textAlign: 'center' }}>
              <p style={{ ...LABEL_STYLE, color: FLARE, marginBottom: 12 }}>
                Unknown Player
              </p>
              <p style={{ ...VALUE_STYLE, color: DUST_50, marginBottom: 24 }}>
                No player found for this ID.
              </p>
              <Link to="/idols" style={{ ...LABEL_STYLE, color: QUANTUM, textDecoration: 'none' }}>
                View Idol Rankings
              </Link>
            </div>
          </Container>
        </main>
        <Footer />
      </>
    );
  }

  // Brand accent: team colour drives the hero border strip (same as TeamDetail).
  // Falls back to QUANTUM when the team row has no colour set.
  const teamColor = (player?.teams as { color?: string | null } | null)?.color ?? QUANTUM;

  return (
    <>
      <Header />
      <main>
        {/* ── I. Hero ──────────────────────────────────────────────────── */}
        <section
          aria-labelledby="player-name"
          style={{ borderTop: `2px solid ${teamColor}` }}
        >
          <Container>
            <div style={{ padding: '48px 0 40px' }}>
              {/* Back to team page if we know the team */}
              {player?.teams?.id && (
                <BackLink to={`/teams/${player.teams.id}`}>
                  {player.teams.name ?? 'Team'}
                </BackLink>
              )}

              {!playerDone ? (
                <HeroSkeleton />
              ) : player ? (
                <PlayerHero player={player} />
              ) : null}
            </div>
          </Container>
        </section>

        <div style={{ borderTop: `1px solid ${HAIRLINE}` }} />

        {/* ── II. Season Stats ─────────────────────────────────────────── */}
        <section aria-labelledby="stats-heading">
          <Container>
            <div style={{ padding: '40px 0' }}>
              <SectionLabel id="stats-heading" kicker="II" title="Season Statistics" />

              {!playerDone ? (
                <Skeleton height={100} />
              ) : player ? (
                <StatsGrid stats={player.seasonStats} />
              ) : null}
            </div>
          </Container>
        </section>

        <div style={{ borderTop: `1px solid ${HAIRLINE}` }} />

        {/* ── III. Idol Standing ───────────────────────────────────────── */}
        <section aria-labelledby="idol-heading">
          <Container>
            <div style={{ padding: '40px 0 80px' }}>
              <SectionLabel id="idol-heading" kicker="III" title="Idol Standing" />

              {!idolDone ? (
                <Skeleton height={80} />
              ) : idol ? (
                <IdolPanel idol={idol} />
              ) : (
                <p style={{ ...VALUE_STYLE, color: DUST_50 }}>
                  Not yet ranked in the cosmos.
                </p>
              )}
            </div>
          </Container>
        </section>
      </main>
      <Footer />
    </>
  );
}

// ── Sub-sections ──────────────────────────────────────────────────────────────

/**
 * Hero block: player name, jersey number pill, team, position, and the
 * identity meta row (nationality · age · personality archetype).
 *
 * Inline status badge for players who have been incinerated or are inactive
 * so the fan sees the historical context without any raw stat exposure.
 */
function PlayerHero({ player }: { player: PlayerWithStats }) {
  const posLabel = player.position ? (POSITION_LABEL[player.position] ?? player.position) : null;
  const teamName = player.teams?.name ?? null;

  return (
    <div>
      {/* Jersey number + position pill */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {player.jersey_number != null && (
          <span style={{
            fontFamily: 'Space Mono, monospace',
            fontSize: 12,
            fontWeight: 700,
            color: DUST_50,
            border: `1px solid ${HAIRLINE}`,
            padding: '4px 10px',
            letterSpacing: '0.1em',
          }}>
            #{player.jersey_number}
          </span>
        )}
        {posLabel && (
          <span style={{ ...LABEL_STYLE, color: DUST_70 }}>{posLabel}</span>
        )}
        {!player.is_active && (
          <span style={{ ...LABEL_STYLE, color: FLARE }}>Inactive</span>
        )}
        {player.starter && (
          <span style={{ ...LABEL_STYLE, color: TERRA }}>Starter</span>
        )}
      </div>

      {/* Player name — headline */}
      <h1
        id="player-name"
        style={{
          fontFamily: 'Space Mono, monospace',
          fontSize: 36,
          fontWeight: 700,
          color: DUST,
          margin: '0 0 8px',
          letterSpacing: '-0.01em',
          lineHeight: 1.15,
        }}
      >
        {player.name}
      </h1>

      {/* Team link */}
      {teamName && player.teams?.id && (
        <Link
          to={`/teams/${player.teams.id}`}
          style={{
            fontFamily: 'Space Mono, monospace',
            fontSize: 14,
            fontWeight: 700,
            color: QUANTUM,
            textDecoration: 'none',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}
        >
          {teamName}
        </Link>
      )}

      {/* Identity meta row: nationality · age · personality */}
      {(player.nationality || player.age != null || player.personality) && (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px 18px',
          marginTop: 18,
          paddingTop: 18,
          borderTop: `1px solid ${HAIRLINE}`,
        }}>
          {player.nationality && (
            <MetaItem label="Origin" value={player.nationality} />
          )}
          {player.age != null && (
            <MetaItem label="Age" value={String(player.age)} />
          )}
          {player.personality && (
            <MetaItem label="Archetype" value={player.personality} />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Six-cell stats grid: goals, assists, minutes, matches, yellow cards, red
 * cards.  Average rating occupies its own cell when non-null.
 *
 * WHY THESE STATS
 *   These are outcome stats (what happened in matches), not engine inputs
 *   (the hidden skill attributes).  Showing outcomes keeps the Blaseball-
 *   style hidden-mechanics contract intact — fans can see "scored 12 goals"
 *   without seeing "attacking = 88".
 */
function StatsGrid({ stats }: { stats: SeasonStats }) {
  const cells: Array<{ label: string; value: string; accent?: string }> = [
    { label: 'Goals',         value: String(stats.goals)                              },
    { label: 'Assists',       value: String(stats.assists)                            },
    { label: 'Matches',       value: String(stats.matches_played)                     },
    { label: 'Minutes',       value: stats.minutes_played.toLocaleString('en-GB')     },
    { label: 'Yellow Cards',  value: String(stats.yellow_cards), accent: '#F5C518'    },
    { label: 'Red Cards',     value: String(stats.red_cards),    accent: FLARE        },
    ...(stats.avg_rating != null
      ? [{ label: 'Avg Rating', value: stats.avg_rating.toFixed(1), accent: TERRA }]
      : []),
  ];

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
      gap: 1,
      background: HAIRLINE,
    }}>
      {cells.map(({ label, value, accent }) => (
        <div
          key={label}
          style={{
            background: PHOBOS,
            padding: '20px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <p style={{ ...LABEL_STYLE, margin: 0 }}>{label}</p>
          <p style={{
            fontFamily: 'Space Mono, monospace',
            fontSize: 22,
            fontWeight: 700,
            color: accent ?? DUST,
            margin: 0,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {value}
          </p>
        </div>
      ))}
    </div>
  );
}

/**
 * Idol standing panel: global rank, team rank, fan favourites, and 14-day
 * training activity.  These numbers are the universe's measure of a player's
 * cultural weight — distinct from their on-pitch stats.
 *
 * WHY TRAINING COUNT IS 14D
 *   Training log clicks decay — only the last 14 days feed into the idol
 *   score so recently-hot players rank higher than all-time stalwarts who
 *   no one trains anymore.  The panel shows `training_count_14d` so the
 *   label matches the actual window.
 */
function IdolPanel({ idol }: { idol: IdolRank }) {
  const cells = [
    { label: 'Global Rank',       value: `#${idol.global_rank}`                      },
    { label: 'Club Rank',         value: `#${idol.team_rank}`                        },
    { label: 'Fan Favourites',    value: idol.favourite_count.toLocaleString('en-GB') },
    { label: 'Training (14 days)',value: idol.training_count_14d.toLocaleString('en-GB') },
    ...(idol.idol_score != null
      ? [{ label: 'Idol Score', value: idol.idol_score.toLocaleString('en-GB') }]
      : []),
  ];

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
      gap: 1,
      background: HAIRLINE,
    }}>
      {cells.map(({ label, value }) => (
        <div
          key={label}
          style={{
            background: PHOBOS,
            padding: '20px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <p style={{ ...LABEL_STYLE, margin: 0 }}>{label}</p>
          <p style={{
            fontFamily: 'Space Mono, monospace',
            fontSize: 22,
            fontWeight: 700,
            color: QUANTUM,
            margin: 0,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {value}
          </p>
        </div>
      ))}
    </div>
  );
}

// ── Primitive components ──────────────────────────────────────────────────────

/**
 * Section label with a roman-numeral kicker above the title.
 * Matches the editorial-header style used on the admin dashboard and
 * other detail pages in the ISL design system.
 */
function SectionLabel({ id, kicker, title }: {
  id:     string;
  kicker: string;
  title:  string;
}) {
  return (
    <div style={{ marginBottom: 24 }}>
      <p style={{ ...LABEL_STYLE, color: DUST_50, marginBottom: 6 }}>{kicker}</p>
      <h2
        id={id}
        style={{
          fontFamily: 'Space Mono, monospace',
          fontSize: 18,
          fontWeight: 700,
          color: DUST,
          margin: 0,
          letterSpacing: '-0.01em',
        }}
      >
        {title}
      </h2>
    </div>
  );
}

/**
 * Single meta field — label above, value below.  Used in the identity row
 * for nationality, age, and personality archetype.
 */
function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ ...LABEL_STYLE, margin: '0 0 3px' }}>{label}</p>
      <p style={{ ...VALUE_STYLE, margin: 0 }}>{value}</p>
    </div>
  );
}

/**
 * Hero loading skeleton shown while the player fetch is in flight.
 * Two blocks approximate the name headline + meta row to avoid layout
 * shift when the data arrives.
 */
function HeroSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ width: 280, height: 40, background: PHOBOS, opacity: 0.6 }} />
      <div style={{ width: 160, height: 18, background: PHOBOS, opacity: 0.4 }} />
    </div>
  );
}

/**
 * Generic panel skeleton — a flat rectangle in Phobos Ash matching the
 * admin dashboard's Skeleton component convention.
 *
 * @param height  Pixel height of the placeholder block.
 */
function Skeleton({ height }: { height: number }) {
  return (
    <div style={{
      height,
      background: PHOBOS,
      border: `1px solid ${HAIRLINE}`,
      opacity: 0.6,
    }} />
  );
}

// ── Shared style constants ────────────────────────────────────────────────────
// Extracted here (rather than repeated inline) so JSX bodies stay readable.
// These mirror the tokens used in the Admin and MatchDetail pages.

/** Uppercase mono label used for field names, kickers, and table headers. */
const LABEL_STYLE: React.CSSProperties = {
  fontFamily:    'Space Mono, monospace',
  fontSize:      11,
  fontWeight:    700,
  textTransform: 'uppercase',
  letterSpacing: '0.14em',
  color:         DUST_50,
};

/** Value display — slightly larger mono for data values. */
const VALUE_STYLE: React.CSSProperties = {
  fontFamily: 'Space Mono, monospace',
  fontSize:   13,
  fontWeight: 400,
  color:      DUST,
};

