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
//   I.   Hero               — player identity (name, team, position, bio)
//   II.  Season Stats       — outcome stats from match_player_stats aggregate
//   III. Idol Standing      — global rank + popularity data from player_idol_score
//   IV.  Recent Matches     — last N appearances with opponent + W/D/L + line
//   V.   Narrative Mentions — narratives referencing this player's entity_id
//   Footer (global)
//
// DATA STRATEGY
//   Four fetches fire in parallel on mount: `getPlayer`, `getPlayerIdolRank`,
//   `getPlayerRecentMatches`, `getNarrativesMentioningPlayer`.  None depend
//   on each other, so each section paints as soon as its own fetch settles
//   without blocking the hero.  Unknown playerId → error state (no redirect,
//   URL stays, inline error surface — same pattern as TeamDetail).

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import Header from '../components/Header';
import { COLORS, Container, BackLink, Footer } from '../components/Layout';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import { getPlayer, getPlayerIdolRank } from '../features/match';
import {
  getPlayerRecentMatches,
  getNarrativesMentioningPlayer,
  type PlayerRecentMatch,
  type NarrativeMention,
} from '../features/match';
import { RelationshipGraph } from '../features/entities';

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
  /**
   * Universal Agent System entity row id (FK to `entities.id`).  Used by
   * the relationship-graph section to seed the subgraph extractor.  Older
   * players (pre-migration 0002) may have a null entity_id; the section
   * is hidden in that case.
   */
  entity_id:     string | null;
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

  const [player,        setPlayer]        = useState<PlayerWithStats | null>(null);
  const [idol,          setIdol]          = useState<IdolRank | null>(null);
  const [recentMatches, setRecentMatches] = useState<PlayerRecentMatch[]>([]);
  const [narratives,    setNarratives]    = useState<NarrativeMention[]>([]);
  const [playerErr,     setPlayerErr]     = useState<string | null>(null);
  const [playerDone,    setPlayerDone]    = useState(false);
  const [idolDone,      setIdolDone]      = useState(false);
  const [matchesDone,   setMatchesDone]   = useState(false);
  const [narrativesDone, setNarrativesDone] = useState(false);

  // ── Parallel fetch on mount ───────────────────────────────────────────────
  // Four queries fire simultaneously.  Each `*Done` flag gates its own
  // skeleton independently so the hero paints the moment the player row
  // resolves — the page never blocks behind the slower narrative fetch.
  useEffect(() => {
    if (!playerId) return undefined;
    let cancelled = false;

    // Player data (including season stats aggregate)
    getPlayer(db, playerId)
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

    // Last 10 appearances — feature API already returns [] on error so the
    // section degrades to an empty state without a catch().
    getPlayerRecentMatches(db, playerId, 10)
      .then((rows) => { if (!cancelled) setRecentMatches(rows); })
      .finally(() => { if (!cancelled) setMatchesDone(true); });

    // Last 10 narratives mentioning the player's entity_id.  Empty when
    // the player has no entity link or no narratives reference them.
    getNarrativesMentioningPlayer(db, playerId, 10)
      .then((rows) => { if (!cancelled) setNarratives(rows); })
      .finally(() => { if (!cancelled) setNarrativesDone(true); });

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
            <div style={{ padding: '40px 0' }}>
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

        <div style={{ borderTop: `1px solid ${HAIRLINE}` }} />

        {/* ── IV. Recent Matches ────────────────────────────────────────
            Sourced from `match_lineups` (one row per starter) with a
            LEFT JOIN to `match_player_stats` for the contribution
            columns — see getPlayerRecentMatches in playerStats.ts.
            A defender with 30 clean sheets shows 30 rows; the
            contribution columns just read as zeros for quiet shifts
            (isl-pfm). */}
        <section aria-labelledby="matches-heading">
          <Container>
            <div style={{ padding: '40px 0' }}>
              <SectionLabel id="matches-heading" kicker="IV" title="Recent Matches" />

              {!matchesDone ? (
                <Skeleton height={120} />
              ) : recentMatches.length > 0 ? (
                <RecentMatchesTable rows={recentMatches} />
              ) : (
                <p style={{ ...VALUE_STYLE, color: DUST_50 }}>
                  No recorded appearances yet.
                </p>
              )}
            </div>
          </Container>
        </section>

        <div style={{ borderTop: `1px solid ${HAIRLINE}` }} />

        {/* ── V. Narrative Mentions ────────────────────────────────────── */}
        <section aria-labelledby="narratives-heading">
          <Container>
            <div style={{ padding: '40px 0' }}>
              <SectionLabel id="narratives-heading" kicker="V" title="Narrative Mentions" />

              {!narrativesDone ? (
                <Skeleton height={100} />
              ) : narratives.length > 0 ? (
                <NarrativeList rows={narratives} />
              ) : (
                <p style={{ ...VALUE_STYLE, color: DUST_50 }}>
                  The cosmos has not yet whispered their name.
                </p>
              )}
            </div>
          </Container>
        </section>

        {/* ── VI. Web of Influence (issue isl-uwq) ──────────────────────
            Drop-in <RelationshipGraph> hub showing the player's
            connections to managers, rivals, mentors, journalists, etc.
            Hidden when the player row has no entity_id link (legacy
            seeds before migration 0002 added the FK).  Section sits
            between Narrative Mentions and the footer so the read flow
            ends on the broader web of connections rather than the
            narrower per-mention feed above. */}
        {player?.entity_id && (
          <div style={{ borderTop: `1px solid ${HAIRLINE}` }} />
        )}
        {player?.entity_id && (
          <section aria-labelledby="connections-heading">
            <Container>
              <div style={{ padding: '40px 0 80px' }}>
                <SectionLabel id="connections-heading" kicker="VI" title="Web of Influence" />
                <RelationshipGraph entityId={player.entity_id} />
              </div>
            </Container>
          </section>
        )}

        {/* Maintain the previous bottom padding when there's no
            relationship-graph section so the footer doesn't kiss the
            narratives feed. */}
        {!player?.entity_id && <div style={{ padding: '0 0 40px' }} />}
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

/**
 * Recent Matches table — one row per appearance, newest first.
 *
 * Each row links the opponent name to `/matches/:matchId` so a reader
 * can jump from the player profile straight into the match detail.  We
 * deliberately keep the rendered columns tight (Date · Opponent · Result
 * · G · A · Min · ⭐) so the table reads as a quick activity log rather
 * than a stats dump — the season aggregate up in II already covers the
 * "totals" surface.
 *
 * VISUAL TREATMENT FOR RESULT
 *   W → Terra Nova green, L → Flare red, D → Dust grey.  Mirrors the
 *   convention used by the StandingsTable and the MatchCard chips so
 *   colour semantics stay consistent across the app.
 */
function RecentMatchesTable({ rows }: { rows: PlayerRecentMatch[] }) {
  return (
    <div style={{ border: `1px solid ${HAIRLINE}` }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
            <th style={th(120)}>Date</th>
            <th style={th()}>Opponent</th>
            <th style={{ ...th(60),  textAlign: 'center' }}>Res.</th>
            <th style={{ ...th(48),  textAlign: 'right'  }}>G</th>
            <th style={{ ...th(48),  textAlign: 'right'  }}>A</th>
            <th style={{ ...th(64),  textAlign: 'right'  }}>Min</th>
            <th style={{ ...th(72),  textAlign: 'right'  }}>Rating</th>
            <th style={{ ...th(56),  textAlign: 'right'  }}>Cards</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.matchId} style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
              <td style={{ ...td, color: DUST_70 }}>{formatDate(r.date)}</td>
              <td style={td}>
                {/* Opponent name links straight to the match detail page so
                    the row doubles as a "open the match" affordance. */}
                <Link
                  to={`/matches/${r.matchId}`}
                  style={{ color: DUST, textDecoration: 'none' }}
                >
                  {/* The vs / @ prefix encodes home/away without a separate
                      column — fewer columns, same information density. */}
                  <span style={{ color: DUST_50, marginRight: 6 }}>
                    {r.isHome ? 'vs' : '@'}
                  </span>
                  {r.opponent?.name ?? '—'}
                </Link>
              </td>
              <td style={{ ...td, textAlign: 'center', fontWeight: 700 }}>
                <ResultPill result={r.result} />
              </td>
              <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {r.goals}
              </td>
              <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {r.assists}
              </td>
              <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: DUST_70 }}>
                {r.minutes}
              </td>
              <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: r.rating != null ? TERRA : DUST_50 }}>
                {r.rating != null ? r.rating.toFixed(1) : '—'}
              </td>
              <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                <CardsCell yellow={r.yellowCards} red={r.redCards} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Coloured one-letter pill encoding the result of a single appearance.
 * Renders an em-dash for `null` (a row joined to an unsimulated match).
 *
 * COLOUR MAP
 *   W → Terra Nova (#5DE0A6) — the canonical "win" hue in the design system
 *   D → Dust 70%               — neutral grey, no opinion
 *   L → Flare (#FF4F5E)        — the canonical "loss" hue
 */
function ResultPill({ result }: { result: 'W' | 'D' | 'L' | null }) {
  if (result == null) return <span style={{ color: DUST_50 }}>—</span>;
  const color = result === 'W' ? TERRA : result === 'L' ? FLARE : DUST_70;
  return (
    <span style={{
      color,
      fontFamily: 'Space Mono, monospace',
      fontWeight: 700,
      letterSpacing: '0.04em',
    }}>
      {result}
    </span>
  );
}

/**
 * Single-cell representation of yellow + red cards for a match.
 *
 * Renders "—" when the player took no cards (the common case) so the
 * column doesn't churn the eye with a wall of zeros.  Otherwise emits
 * up to two coloured glyphs: a 🟨 (yellow, #F5C518) for each yellow,
 * and a 🟥 (red, FLARE) when the player saw red.  Numbers above 1
 * (rare — a second yellow always converts to red) print as `Nx`.
 */
function CardsCell({ yellow, red }: { yellow: number; red: number }) {
  if (yellow === 0 && red === 0) {
    return <span style={{ color: DUST_50 }}>—</span>;
  }
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'baseline' }}>
      {yellow > 0 && (
        <span style={{ color: '#F5C518' }}>
          {yellow > 1 ? `${yellow}×` : ''}■
        </span>
      )}
      {red > 0 && (
        <span style={{ color: FLARE }}>
          {red > 1 ? `${red}×` : ''}■
        </span>
      )}
    </span>
  );
}

/**
 * Narrative Mentions list — one card per narrative, newest first.
 *
 * Each card carries the narrative kind (small-caps), a relative
 * timestamp, and the summary text.  Pundit takes render in italics
 * inside quote marks to match the News page treatment so the same
 * narrative reads identically in both surfaces.
 */
function NarrativeList({ rows }: { rows: NarrativeMention[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {rows.map((n) => (
        <NarrativeCard key={n.id} narrative={n} />
      ))}
    </div>
  );
}

/**
 * Single narrative card — kind + relative time header above the summary.
 *
 * Pundit takes (kind === 'pundit_takes') get the italic + curly-quote
 * treatment, mirroring the News page so the cosmetics don't drift
 * between surfaces.
 *
 * @param narrative  Validated NarrativeMention row.
 */
function NarrativeCard({ narrative }: { narrative: NarrativeMention }) {
  const isPundit = narrative.kind === 'pundit_takes';
  return (
    <article style={{
      border:     `1px solid ${HAIRLINE}`,
      background: PHOBOS,
      padding:    16,
    }}>
      <header style={{
        display:        'flex',
        justifyContent: 'space-between',
        alignItems:     'baseline',
        marginBottom:   10,
        gap:            12,
      }}>
        <span style={{ ...LABEL_STYLE, color: QUANTUM }}>
          {prettifyKind(narrative.kind)}
        </span>
        <span style={{ ...LABEL_STYLE, color: DUST_50, fontWeight: 400 }}>
          {formatRelativeTime(narrative.created_at)}
        </span>
      </header>
      <p style={{
        fontFamily: 'Space Mono, monospace',
        fontSize:   14,
        lineHeight: 1.6,
        color:      DUST,
        fontStyle:  isPundit ? 'italic' : 'normal',
        margin:     0,
      }}>
        {isPundit ? `“${narrative.summary}”` : narrative.summary}
      </p>
    </article>
  );
}

// ── Sub-section formatting helpers ────────────────────────────────────────────

/**
 * Render an ISO timestamp as a short "12 Apr" style label for the Recent
 * Matches table.  Falls back to em-dash for null/invalid input so the
 * column never collapses to whitespace.
 *
 * @param iso  ISO timestamp string, or null.
 * @returns    Short date label, or "—".
 */
function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '—';
  return t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Render an ISO timestamp as a human-readable relative time
 * ("3h ago", "yesterday", "5d ago") for the narrative card header.
 *
 * Mirrors the News page implementation so a narrative shown in both
 * surfaces reads identically.  Falls back to a calendar-style label
 * for anything over a week old.
 *
 * @param iso  ISO timestamp string, or null/undefined.
 * @returns    Relative-time string, or "—".
 */
function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diffMs = Date.now() - t;
  // Width thresholds — match the News page exactly.  Each branch returns
  // before the next so the longest-matching label wins.
  const min  = Math.floor(diffMs / 60_000);
  const hour = Math.floor(diffMs / 3_600_000);
  const day  = Math.floor(diffMs / 86_400_000);
  if (min  < 1)   return 'just now';
  if (min  < 60)  return `${min}m ago`;
  if (hour < 24)  return `${hour}h ago`;
  if (day  === 1) return 'yesterday';
  if (day  < 7)   return `${day}d ago`;
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Prettify a snake_case narrative kind into a Title-Case label.
 *
 * Mirrors the same helper on the News page so unknown kinds (added
 * after a future migration) don't leak their raw underscores into the
 * UI.  Defensive default keeps the chip from ever rendering blank.
 *
 * @param key  Narrative kind from the DB (e.g. 'pundit_takes').
 * @returns    Title-cased label (e.g. 'Pundit Takes').
 */
function prettifyKind(key: string): string {
  return (key ?? 'narrative')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Recent Matches table style tokens ─────────────────────────────────────────
// Mirrors the squadTd / squadTh pattern from TeamDetail.tsx so the two
// detail pages share visual rhythm.

/** Body cell — base style applied via spread; per-cell overrides handle alignment. */
const td: React.CSSProperties = {
  textAlign: 'left',
  padding:   '12px 14px',
  color:     DUST,
};

/** Header cell factory — width is optional to let the Opponent column flex. */
const th = (width?: number | string): React.CSSProperties => ({
  textAlign:     'left',
  padding:       '12px 14px',
  fontSize:      11,
  fontWeight:    700,
  textTransform: 'uppercase',
  letterSpacing: '0.14em',
  color:         DUST_70,
  width,
});

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

