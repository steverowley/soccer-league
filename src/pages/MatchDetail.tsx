// ── MatchDetail.tsx ─────────────────────────────────────────────────────────
// Single-match detail page — `/matches/:matchId` route, rebuilt in PR 5.
//
// Layout:
//   Header (global)
//   I.   Hero          — backlink, kicker (competition + round), two-team
//                        score row with brand-colour crests, status pip,
//                        kickoff / FT timestamp, weather + stadium meta
//   II.  Bookie        — WagerWidget — five render branches (closed /
//                        loading / no odds / anonymous CTA / picker)
//                        keyed off match.status + auth state.  Added
//                        in PR 10.
//   III. Live Feed     — LiveCommentary — pre-simulated match_events log
//                        revealed at wall-clock pace for in_progress
//                        matches, dumped wholesale for completed ones,
//                        omitted entirely for scheduled / cancelled.
//                        Added in Phase A (live match event streaming).
//   IV.  Stats         — match_player_stats table (goals / assists /
//                        cards / minutes / rating) grouped by side,
//                        sorted by rating DESC
//   Footer (shared)
//
// Data sources:
//   - getMatch(db, matchId) — joins home_team, away_team, competitions,
//     and match_player_stats (with player meta)
//   - getMatchEvents(db, matchId) — full pre-simulated event log
//     (Section III)
//   - getMatchDurationSeconds(db, matchId) — season pacing knob; how
//     long the viewer takes to reveal a 90-minute match (Section III)
//   - subscribeToMatchEvents(db, matchId, onInsert) — Realtime stream
//     of new events while a match is in_progress (Section III)
//
// 404 case: matchId returns no row → renders an "Unknown Match" surface.

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Header from '../components/Header';
import { COLORS, Container, SectionHeader, Footer, BackLink, TeamCrest } from '../components/Layout';
import WagerWidget from '../components/WagerWidget';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import { getMatch } from '../lib/supabase';
import {
  computeElapsedGameMinute,
  filterEventsByElapsedMinute,
  getMatchEvents,
  getMatchDurationSeconds,
  subscribeToMatchEvents,
  DEFAULT_MATCH_DURATION_SECONDS,
  type MatchEventRow,
} from '../features/match';

// ── Local aliases for terser inline styles ──────────────────────────────────
// QUANTUM (focus) drives LIVE indicators; FLARE is retained for both
// the genuine fetch-failure error and the Cancelled status pip
// (cancellation is the only match status that genuinely is an error
// outcome — every wager on it gets voided).
const { dust: DUST, abyss: ABYSS, flare: FLARE, quantum: QUANTUM } = COLORS;
const HAIRLINE = COLORS.hairline;
const DUST_50  = COLORS.dust50;
const DUST_70  = COLORS.dust70;

// ── Status mapping ──────────────────────────────────────────────────────────
// STATUS_LABELS — display copy for the status pip on the score row.
// Matches the wording used on the Matches index so the two surfaces
// agree on terminology.
const STATUS_LABELS: Record<string, string> = {
  in_progress: 'Live',
  completed:   'Full Time',
  scheduled:   'Scheduled',
  cancelled:   'Cancelled',
};

/**
 * Match detail page.
 *
 * Fires a single `getMatch(db, matchId)` fetch on mount; renders a
 * loading placeholder until it settles.  Unknown id → UnknownMatch
 * surface.  Hero paints from the live row (no static fallback exists
 * for matches — they're generated, not seeded).
 *
 * @returns {JSX.Element}
 */
export default function MatchDetail() {
  const { matchId } = useParams();
  const db          = useSupabase();

  const [match,     setMatch]     = useState<any>(null);
  const [loadError, setLoadError] = useState<any>(null);
  const [loaded,    setLoaded]    = useState<boolean>(false);

  useEffect(() => {
    if (!matchId) return undefined;
    let cancelled = false;
    setLoadError(null);
    setLoaded(false);
    getMatch(matchId)
      .then((data: any) => {
        if (cancelled) return;
        setMatch(data);
        setLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[MatchDetail] getMatch failed:', err);
        setLoadError(err);
        setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [db, matchId]);

  if (loaded && !match && !loadError) return <UnknownMatch matchId={matchId} />;

  return (
    <div style={{
      background: ABYSS,
      color: DUST,
      minHeight: '100vh',
      fontFamily: 'Space Mono, monospace',
    }}>
      <Header />

      <section style={{ padding: '64px 32px 32px' }}>
        <Container>
          <BackLink to="/matches">All Matches</BackLink>

          {!loaded && (
            <p style={{
              marginTop: 32, color: DUST_50, fontStyle: 'italic', fontSize: 13,
            }}>
              Loading match…
            </p>
          )}

          {loadError && (
            <p style={{
              marginTop: 32, color: FLARE, fontStyle: 'italic', fontSize: 13,
            }}>
              Match data unavailable. The void has swallowed the result.
            </p>
          )}

          {match && !loadError && <MatchHero match={match} />}
        </Container>
      </section>

      {/* Section II — Wager placement.
          WagerWidget renders all five branches internally (closed
          status, loading, no odds, anonymous CTA, full picker) so
          this section always appears on every match — same visual
          weight whether the user can or cannot bet. */}
      {match && !loadError && (
        <section style={{ padding: '0 32px 64px' }}>
          <Container>
            <SectionHeader
              kicker="II"
              label="The Bookie"
              title="Place A Wager"
              subtitle="Stake at least 10 credits on any of the three outcomes. Odds lock in at the moment you place — the bookie's later re-pricing won't claw your potential payout back."
            />
            <div style={{ marginTop: 24 }}>
              <WagerWidget match={match} />
            </div>
          </Container>
        </section>
      )}

      {/* Section III — Live commentary (Phase A).
          Renders nothing for scheduled / cancelled matches (no event log
          exists to show).  For in_progress, ticks once per second and
          reveals events as wall-clock crosses each minute boundary; for
          completed, dumps the full pre-simulated log so the user can
          replay the match's narrative arc end-to-end. */}
      {match && !loadError && (
        <section style={{ padding: '0 32px 64px' }}>
          <Container>
            <LiveCommentary match={match} />
          </Container>
        </section>
      )}

      {match && !loadError && (
        <section style={{ padding: '0 32px 120px' }}>
          <Container>
            <SectionHeader
              kicker="IV"
              label="The Stats"
              title="Player Performance"
              subtitle="Aggregated match stats per player.  Ratings reflect engine assessment — interpret them as the booth would."
            />
            <PlayerStats
              homeTeam={match.home_team}
              awayTeam={match.away_team}
              stats={match.match_player_stats ?? []}
            />
          </Container>
        </section>
      )}

      <Footer />
    </div>
  );
}

/**
 * Hero block at the top of the match page.
 *
 * Carries the kicker (competition + round), the two-team score row
 * with brand-colour crest silhouettes, a status pip, and a meta row
 * with kickoff time, weather, and stadium.  Scheduled matches show
 * "v" in place of the score; cancelled matches show the original
 * scheduled time + a cancelled pip.
 *
 * @param {{ match: object }} props
 */
function MatchHero({ match  }: any) {
  const competition = match.competitions?.name ?? 'League';
  const round       = match.round ?? '';
  const status      = match.status ?? 'scheduled';

  const homeName  = match.home_team?.name     ?? '?';
  const awayName  = match.away_team?.name     ?? '?';
  const homeColor = match.home_team?.color    ?? null;
  const awayColor = match.away_team?.color    ?? null;
  const homeLoc   = match.home_team?.location ?? '';
  const awayLoc   = match.away_team?.location ?? '';
  const homeScore = match.home_score ?? 0;
  const awayScore = match.away_score ?? 0;

  const ts = match.played_at
    ? new Date(match.played_at)
    : match.scheduled_at
      ? new Date(match.scheduled_at)
      : null;
  const tsLabel = match.played_at ? 'Played' : 'Kickoff';

  return (
    <>
      {/* Kicker row — competition + round + status pip aligned right. */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 16,
        marginTop: 24,
        fontSize: 11,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: DUST_70,
      }}>
        <span>
          {competition}
          {round && <> <span style={{ color: DUST_50 }}>•</span> {round}</>}
        </span>
        <StatusPip status={status} />
      </div>

      {/* Score row — three-column grid: home block / score / away block.
          Crests are placeholder shield silhouettes coloured by each
          team's brand colour (same pattern as Home's LiveMatchPanel). */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center',
        gap: 32,
        margin: '24px 0 0',
        padding: '40px 0',
        borderTop: `1px solid ${HAIRLINE}`,
        borderBottom: `1px solid ${HAIRLINE}`,
      }}>
        <TeamScoreBlock side="Home" name={homeName} location={homeLoc} color={homeColor} />
        <ScoreDisplay status={status} home={homeScore} away={awayScore} />
        <TeamScoreBlock side="Away" name={awayName} location={awayLoc} color={awayColor} />
      </div>

      {/* Meta row — timestamp + weather + stadium.  Bullets at 50 % dust
          so the row reads as one continuous data band. */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 16,
        marginTop: 24,
        fontSize: 11,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: DUST_70,
      }}>
        {ts && (
          <span>
            {tsLabel}: {ts.toLocaleString(undefined, {
              weekday: 'short', month: 'short', day: 'numeric',
              hour: '2-digit', minute: '2-digit',
            })}
          </span>
        )}
        {match.stadium && (
          <>
            <span style={{ color: DUST_50 }}>•</span>
            <span>{match.stadium}</span>
          </>
        )}
        {match.weather && (
          <>
            <span style={{ color: DUST_50 }}>•</span>
            <span>{prettifyWeather(match.weather)}</span>
          </>
        )}
      </div>
    </>
  );
}

/**
 * Prettify a snake_case weather key into a Title-Case label.  Used in
 * the meta row so raw seed keys (`dust_storm`, `magnetic_storm`) don't
 * leak to the user.  Inverse of nothing — there's no parser back the
 * other way; this is a one-way display transform.
 *
 * @param {string} key
 * @returns {string}
 */
function prettifyWeather(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c: string) => c.toUpperCase());
}

/**
 * Centred score display.  Two render branches:
 *   in_progress / completed → big bold score with optional flare pip
 *   scheduled / cancelled   → faded "v" glyph
 *
 * @param {object} props
 * @param {string} props.status
 * @param {number} props.home
 * @param {number} props.away
 */
function ScoreDisplay({ status, home, away  }: any) {
  if (status === 'scheduled' || status === 'cancelled') {
    return (
      <div style={{
        fontSize: 32,
        color: DUST_50,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.14em',
      }}>
        v
      </div>
    );
  }
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 16,
      fontSize: 56,
      fontWeight: 700,
      fontVariantNumeric: 'tabular-nums',
      lineHeight: 1,
    }}>
      {status === 'in_progress' && (
        <span
          aria-hidden="true"
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: QUANTUM,
            boxShadow: `0 0 8px ${QUANTUM}`,
          }}
        />
      )}
      <span>
        {home} <span style={{ color: DUST_50, fontSize: 40 }}>·</span> {away}
      </span>
    </div>
  );
}

/**
 * Single-team score block — crest silhouette, name, side + location.
 * Mirrors Home's TeamScoreBlock at slightly larger weight so the
 * detail page has a clear hierarchical bump over the index.
 *
 * @param {object} props
 * @param {'Home'|'Away'} props.side
 * @param {string} props.name
 * @param {string} props.location
 * @param {string|null} props.color
 */
function TeamScoreBlock({ side, name, location, color  }: any) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <TeamCrest color={color} />
      <h2 style={{
        fontSize: 22,
        fontWeight: 700,
        textTransform: 'uppercase',
        textAlign: 'center',
        margin: 0,
        lineHeight: 1.1,
      }}>
        {name}
      </h2>
      <div style={{
        fontSize: 11,
        color: DUST_50,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
      }}>
        {side}
        {location && <> <span style={{ color: DUST_50 }}>•</span> {location}</>}
      </div>
    </div>
  );
}

/**
 * Status pip — small bordered chip in the kicker row.  Per-status
 * colour assignment:
 *   in_progress → Quantum Purple (focus / attention cue)
 *   cancelled   → Solar Flare    (error — every wager voided)
 *   completed   → Lunar Dust     (neutral, no special cue needed)
 *   scheduled   → Lunar Dust     (neutral)
 *
 * Status values are the raw DB enum, mapped through STATUS_LABELS
 * for display.  PR 12 split the Live + Cancelled cases — they used
 * to share Solar Flare under the old "flare = attention" rule.
 *
 * @param {{ status: string }} props
 */
function StatusPip({ status  }: any) {
  const isLive      = status === 'in_progress';
  const isCancelled = status === 'cancelled';
  // Live = quantum (focus); cancelled = flare (genuine error outcome).
  const colour      = isLive ? QUANTUM : isCancelled ? FLARE : DUST;
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 10px',
      border: `1px solid ${colour}`,
      color:  colour,
      fontSize: 10,
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
      fontWeight: 700,
    }}>
      {isLive && (
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: QUANTUM,
            boxShadow: `0 0 4px ${QUANTUM}`,
            display: 'inline-block',
          }}
        />
      )}
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

/**
 * Player stats section.  Splits the match_player_stats array by team
 * (home vs away based on team_id) and renders each side as its own
 * sub-table, sorted by rating DESC then by goals DESC.  Pre-match
 * rows render a single italic placeholder so the section still
 * paints (matches the "we checked, no data yet" pattern from
 * MatchSection).
 *
 * @param {object} props
 * @param {object} props.homeTeam
 * @param {object} props.awayTeam
 * @param {Array<object>} props.stats
 */
function PlayerStats({ homeTeam, awayTeam, stats  }: any) {
  if (stats.length === 0) {
    return (
      <p style={{
        marginTop: 24, color: DUST_50, fontSize: 13, fontStyle: 'italic',
      }}>
        Player stats unavailable for this match.
      </p>
    );
  }

  // Bucket by team_id so home / away tables render side-by-side.  The
  // sort is stable (rating DESC → goals DESC) so MVPs surface at the
  // top of each list.
  const sortStats = (a: any, b: any) => (b.rating ?? 0) - (a.rating ?? 0) || (b.goals ?? 0) - (a.goals ?? 0);
  const homeStats = stats.filter((s: any) => s.team_id === homeTeam?.id).sort(sortStats);
  const awayStats = stats.filter((s: any) => s.team_id === awayTeam?.id).sort(sortStats);

  return (
    <div
      className="isl-stats-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 24,
        marginTop: 24,
      }}
    >
      <StatsTable team={homeTeam} rows={homeStats} />
      <StatsTable team={awayTeam} rows={awayStats} />

      <style>{`
        @media (max-width: 899px) {
          .isl-stats-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

/**
 * Per-team stats sub-table.  Column set: Player / G / A / Y / R / Min /
 * Rating.  Rating is bold + tabular-nums so the right-most column
 * scans as the "MVP" column.  Player names link to /players/:id which
 * 404s today (wired up in a later PR).
 *
 * @param {object} props
 * @param {object} props.team   Home or away team row.
 * @param {Array<object>} props.rows
 */
function StatsTable({ team, rows  }: any) {
  return (
    <div style={{ border: `1px solid ${HAIRLINE}` }}>
      <header style={{
        padding: '14px 16px',
        borderBottom: `1px solid ${HAIRLINE}`,
        fontSize: 11,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
      }}>
        {team?.name ?? '?'}
      </header>

      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: 13,
      }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
            <th style={statsTh()}>Player</th>
            <th style={{ ...statsTh(40), textAlign: 'right' }}>G</th>
            <th style={{ ...statsTh(40), textAlign: 'right' }}>A</th>
            <th style={{ ...statsTh(40), textAlign: 'right' }}>Y</th>
            <th style={{ ...statsTh(40), textAlign: 'right' }}>R</th>
            <th style={{ ...statsTh(56), textAlign: 'right' }}>Min</th>
            <th style={{ ...statsTh(56), textAlign: 'right' }}>Rating</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s: any) => (
            <tr key={s.id} style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
              <td style={statsTd}>
                <Link
                  to={`/players/${s.player_id}`}
                  style={{ color: DUST, textDecoration: 'none' }}
                >
                  {s.players?.name ?? '—'}
                </Link>
              </td>
              <td style={{ ...statsTd, textAlign: 'right' }}>{s.goals        ?? 0}</td>
              <td style={{ ...statsTd, textAlign: 'right' }}>{s.assists      ?? 0}</td>
              <td style={{ ...statsTd, textAlign: 'right' }}>{s.yellow_cards ?? 0}</td>
              <td style={{ ...statsTd, textAlign: 'right' }}>{s.red_cards    ?? 0}</td>
              <td style={{ ...statsTd, textAlign: 'right', color: DUST_70 }}>
                {s.minutes_played ?? 0}
              </td>
              <td style={{
                ...statsTd, textAlign: 'right', fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
              }}>
                {formatRating(s.rating)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const statsTd: React.CSSProperties = { textAlign: 'left', padding: '10px 12px' };
const statsTh = (width?: number | string): React.CSSProperties => ({
  textAlign: 'left',
  padding: '10px 12px',
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.14em',
  color: DUST_70,
  width,
});

/**
 * Format the player rating with a single decimal (DB stores numeric(3,1)).
 *
 * Edge cases:
 *   - null / undefined → "—" (player didn't appear)
 *   - 0                → "0.0" (a real zero is a legit booth grade)
 *
 * @param {number | null | undefined} rating
 * @returns {string}
 */
function formatRating(rating: number | null | undefined): string {
  if (rating === null || rating === undefined) return '—';
  return Number(rating).toFixed(1);
}

/**
 * Unknown-match fallback surface.  Same pattern as UnknownLeague /
 * UnknownClub — minimal central message + backlink + no router
 * redirect, so a bad URL stays the user's URL.
 *
 * @param {{ matchId?: string }} props
 */
function UnknownMatch({ matchId  }: any) {
  return (
    <div style={{
      background: ABYSS,
      color: DUST,
      minHeight: '100vh',
      fontFamily: 'Space Mono, monospace',
    }}>
      <Header />
      <section style={{ padding: '120px 32px' }}>
        <Container>
          <BackLink to="/matches">All Matches</BackLink>
          <h1 style={{
            fontSize: 32,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.02em',
            marginTop: 24,
          }}>
            Unknown Match
          </h1>
          <p style={{
            fontSize: 14,
            lineHeight: 1.7,
            color: DUST_70,
            marginTop: 16,
            maxWidth: '52ch',
          }}>
            No match registered under <code style={{
              color: DUST,
              fontFamily: 'inherit',
              background: COLORS.dustFaint,
              padding: '2px 6px',
              border: `1px solid ${HAIRLINE}`,
            }}>{matchId ?? '—'}</code>.  Try the
            {' '}<Link to="/matches" style={{ color: DUST }}>full fixture list</Link>{' '}
            to find the result you were after.
          </p>
        </Container>
      </section>
      <Footer />
    </div>
  );
}

// ── Live commentary section (Phase A) ────────────────────────────────────────
//
// The match worker pre-simulates a fixture at its kickoff_at instant, writing
// every `genEvent()` output into `match_events` with a monotone (minute,
// subminute) ordering.  This section reads that pre-simulated stream and
// reveals it client-side via two complementary mechanisms:
//
//   1. computeElapsedGameMinute(kickoff, now, durationSeconds) — pure helper
//      from features/match/logic that maps wall-clock seconds onto the
//      simulated 0–90 minute axis.  A setInterval re-runs the helper once
//      per second so freshly-elapsed events appear without a page refresh.
//
//   2. subscribeToMatchEvents(db, matchId, onInsert) — Supabase Realtime
//      filtered to `match_id=eq.<id>`.  Late-joining a live match means the
//      initial getMatchEvents() fetch covered everything up to "now", but
//      events the worker writes *after* the page loaded would otherwise be
//      missed.  The subscription fills that gap so the in-memory `events`
//      array always mirrors the DB.
//
// THE FOUR RENDER BRANCHES (driven by match.status):
//   • scheduled  → nothing renders (no events to show pre-kickoff)
//   • cancelled  → nothing renders (the match was never played)
//   • in_progress → ticking commentary feed, capped at elapsedMinute
//   • completed   → the full event log dumped at once

// ── Wall-clock tick rate ────────────────────────────────────────────────────
/**
 * Milliseconds between elapsed-minute recomputations during a live match.
 * 1000 ms = once per real-time second.  Game minutes advance at roughly
 * 6.7 real seconds each (600 s / 90 min) under the production default, so
 * any tick rate ≤ 1 s is fast enough to never miss a minute boundary.
 * Faster ticks would just burn CPU re-running an identical filter.
 */
const LIVE_TICK_MS = 1000;

/**
 * Subset of the matches row this component actually reads.  Declared loosely
 * because `getMatch()` returns the full joined row with many more fields the
 * commentary feed doesn't need — narrowing here keeps the prop contract
 * honest about what we depend on without pulling in the entire join shape.
 *
 * All fields are optional / nullable because the only render branch that
 * touches `scheduled_at` is the in_progress one (which the worker guarantees
 * has a non-null kickoff), and the showSection guard skips early if status
 * or id are missing.
 */
interface LiveCommentaryMatch {
  id?:           string;
  status?:       string;
  scheduled_at?: string | null;
}

/**
 * Live commentary feed for a single match.
 *
 * Pulls the full pre-simulated event log on mount, looks up the season's
 * pacing knob, then either ticks once per second (in_progress) or paints
 * the full log immediately (completed).  Scheduled and cancelled matches
 * return null so the section disappears from the page entirely — there
 * is no "events haven't started" placeholder because the empty section
 * would just be noise.
 *
 * Realtime subscription is only attached while the match is in_progress;
 * completed matches have no further events incoming so a long-lived
 * WebSocket channel would be wasted bandwidth.
 *
 * @param props.match  Match row from getMatch() — needs id, status, and
 *                     scheduled_at (the kickoff anchor for elapsed math).
 */
function LiveCommentary({ match }: { match: LiveCommentaryMatch }) {
  const db = useSupabase();

  // ── Match-status guards ───────────────────────────────────────────────────
  // Status drives every branch in this component, so we cache the three
  // booleans up front to avoid re-typing the string comparisons everywhere.
  const status       = match?.status ?? 'scheduled';
  const isInProgress = status === 'in_progress';
  const isCompleted  = status === 'completed';
  const showSection  = isInProgress || isCompleted;

  const [events,        setEvents]        = useState<MatchEventRow[]>([]);
  const [duration,      setDuration]      = useState<number>(DEFAULT_MATCH_DURATION_SECONDS);
  const [elapsedMinute, setElapsedMinute] = useState<number>(0);
  const [loaded,        setLoaded]        = useState<boolean>(false);
  const [loadError,     setLoadError]     = useState<unknown>(null);

  // ── Initial fetch: event log + season pacing knob ─────────────────────────
  // Both queries fire in parallel — they hit independent tables and the page
  // can't render anything useful until both settle.  Promise.all keeps total
  // wall-clock latency to the slower of the two.  Skipped entirely for
  // scheduled / cancelled matches because the empty section won't render.
  useEffect(() => {
    if (!showSection || !match?.id) return undefined;
    let cancelled = false;
    setLoaded(false);
    setLoadError(null);
    Promise.all([
      getMatchEvents(db, match.id),
      getMatchDurationSeconds(db, match.id),
    ])
      .then(([evRows, durSeconds]) => {
        if (cancelled) return;
        setEvents(evRows);
        setDuration(durSeconds);
        setLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[LiveCommentary] fetch failed:', err);
        setLoadError(err);
        setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [db, match?.id, showSection]);

  // ── Elapsed-minute clock ──────────────────────────────────────────────────
  // Completed matches jump straight to 120 so filterEventsByElapsedMinute
  // returns the full log on the first paint (no interval needed — nothing
  // is going to change).  Live matches tick every LIVE_TICK_MS and feed
  // the latest wall-clock into computeElapsedGameMinute.  The initial
  // tick() call before setInterval guarantees we don't render an empty
  // feed for ~1 s while waiting for the first interval fire.
  useEffect(() => {
    if (isCompleted) {
      setElapsedMinute(120);
      return undefined;
    }
    if (!isInProgress) return undefined;

    // scheduled_at is the canonical kickoff anchor: matches that have
    // transitioned to in_progress always have a scheduled_at value because
    // the worker requires it to pick the fixture up.  Guard anyway so a
    // malformed row can't divide-by-undefined here.
    const kickoff = match?.scheduled_at;
    if (!kickoff) return undefined;

    const tick = (): void => {
      setElapsedMinute(computeElapsedGameMinute(kickoff, new Date(), duration));
    };
    tick();
    const interval = setInterval(tick, LIVE_TICK_MS);
    return () => clearInterval(interval);
  }, [isInProgress, isCompleted, match?.scheduled_at, duration]);

  // ── Realtime subscription (live matches only) ─────────────────────────────
  // Worker writes new events as it simulates them; without this subscription
  // a viewer who landed on the page after kickoff would only ever see the
  // events that existed at fetch time.  De-dupe by id because Realtime
  // payloads can arrive while the initial fetch is still in flight (race
  // window: subscribe completes before the fetch resolves).
  useEffect(() => {
    if (!isInProgress || !match?.id) return undefined;
    return subscribeToMatchEvents(db, match.id, (row) => {
      setEvents((prev) => {
        if (prev.some((e) => e.id === row.id)) return prev;
        // Keep the list sorted so filterEventsByElapsedMinute can rely on
        // the input order being chronological — saves a sort on every tick.
        return [...prev, row].sort(
          (a, b) => a.minute - b.minute || Number(a.subminute) - Number(b.subminute),
        );
      });
    });
  }, [db, match?.id, isInProgress]);

  // ── Visible-event derivation ─────────────────────────────────────────────
  // Recomputed only when events / elapsedMinute / status change.  Memoised
  // to avoid re-running filterEventsByElapsedMinute on every parent render
  // (cheap today but the list can grow to ~150 rows per match).
  const visibleEvents = useMemo(() => {
    if (isCompleted) return events;
    return filterEventsByElapsedMinute(events, elapsedMinute);
  }, [events, elapsedMinute, isCompleted]);

  if (!showSection) return null;

  // ── Section copy ──────────────────────────────────────────────────────────
  // The kicker / label / subtitle differ by status so the section reads as
  // either "the match is happening right now" or "here's what happened".
  // Kept inline (not extracted) because each status branch only ever appears
  // once per page render and pulling it out adds indirection without reuse.
  const heading = isInProgress
    ? {
        kicker:   'III',
        label:    'Live Feed',
        title:    'The Cosmos Watches',
        subtitle: 'Events surface as wall-clock elapsed-from-kickoff crosses each minute. What you read is what just happened.',
      }
    : {
        kicker:   'III',
        label:    'The Replay',
        title:    'Ninety Minutes In The Void',
        subtitle: 'Full event log from the match. Read top-down for the chronological arc; the most recent minute appears at the top.',
      };

  return (
    <>
      <SectionHeader
        kicker={heading.kicker}
        label={heading.label}
        title={heading.title}
        subtitle={heading.subtitle}
      />

      {/* Live-only minute indicator — visible only while the match is in
          progress so the viewer can see the clock is ticking even during
          a quiet patch of play.  Hidden on completed matches because the
          static "90" would just read as decorative chrome. */}
      {isInProgress && loaded && (
        <div style={{
          marginTop: 24,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 14px',
          border: `1px solid ${QUANTUM}`,
          color: QUANTUM,
          fontSize: 11,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          fontWeight: 700,
        }}>
          <span
            aria-hidden="true"
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: QUANTUM,
              boxShadow: `0 0 4px ${QUANTUM}`,
              display: 'inline-block',
            }}
          />
          Minute {Math.min(elapsedMinute, 90)}
          {elapsedMinute > 90 && <> + {elapsedMinute - 90}</>}
        </div>
      )}

      {loadError && (
        <p style={{
          marginTop: 24, color: FLARE, fontSize: 13, fontStyle: 'italic',
        }}>
          Commentary feed unavailable. The cosmic broadcast has cut out.
        </p>
      )}

      {!loadError && !loaded && (
        <p style={{
          marginTop: 24, color: DUST_50, fontSize: 13, fontStyle: 'italic',
        }}>
          Tuning into the cosmic broadcast…
        </p>
      )}

      {!loadError && loaded && visibleEvents.length === 0 && (
        <p style={{
          marginTop: 24, color: DUST_50, fontSize: 13, fontStyle: 'italic',
        }}>
          {isInProgress
            ? 'The void is silent. Awaiting the first whistle…'
            : 'No events were recorded for this match.'}
        </p>
      )}

      {!loadError && loaded && visibleEvents.length > 0 && (
        <CommentaryFeed events={visibleEvents} />
      )}
    </>
  );
}

/**
 * Vertical feed of pre-simulated match events, rendered most-recent-first.
 *
 * Reverses the chronological input so the latest minute appears at the top
 * of the visible viewport — matches the "scroll to bottom to read history"
 * inversion common to live-game UIs.  No virtualisation: a 90-minute match
 * yields ~100–150 events which renders fine without windowing.
 *
 * @param props.events  Visible events (already filtered by elapsed minute).
 */
function CommentaryFeed({ events }: { events: MatchEventRow[] }) {
  // Reverse onto a fresh array; mutating the prop array would also reverse
  // the parent's memoised value on every render.
  const ordered = [...events].reverse();
  return (
    <div style={{
      marginTop: 24,
      border: `1px solid ${HAIRLINE}`,
      display: 'flex',
      flexDirection: 'column',
    }}>
      {ordered.map((ev) => (
        <CommentaryRow key={ev.id} event={ev} />
      ))}
    </div>
  );
}

/**
 * Single event row in the commentary feed.
 *
 * Three columns: minute pip / event-type chip / commentary text.  The
 * minute column uses tabular-nums so the column edge scans cleanly down
 * the list.  Architect-touched events get a Quantum-purple left border so
 * the cosmic interference is visible without explaining the mechanic in
 * words (per the "hidden mechanics" design pillar — the colour cue reads
 * as "something's off" without naming what).
 *
 * @param props.event  One row from match_events.  Payload is jsonb so we
 *                     defensively destructure.
 */
function CommentaryRow({ event }: { event: MatchEventRow }) {
  // Payload is jsonb in Supabase → `unknown` in TS.  We narrow to a
  // string-keyed record-of-unknown so individual field reads still demand
  // a per-field type assertion (no implicit any leakage), but the .key
  // syntax stays terse.  Shape is documented by gameEngine.types.ts:MatchEvent.
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  // Commentary text comes from gameEngine's `commentary` field when present;
  // fall back to the event type as a graceful last-resort label so the row
  // never renders blank for novel event types we haven't styled yet.
  const text =
    typeof payload.commentary === 'string' && payload.commentary.length > 0
      ? payload.commentary
      : prettifyEventType(event.type);
  const isGoal = payload.isGoal === true || event.type === 'goal';
  // Architect interference is signalled by any of the architect* booleans
  // in the payload.  Any single flag triggers the purple accent — we don't
  // try to convey *which* kind of interference to the user.
  const isArchitect =
    payload.architectAnnulled === true ||
    payload.architectForced   === true ||
    payload.architectConjured === true ||
    payload.architectStolen   === true ||
    payload.architectEcho     === true;

  // Accent colour priority: architect > goal > none.  Architect wins because
  // a cosmic-touched goal is more narratively significant than an ordinary
  // goal, and the purple accent is the established "something's off" cue.
  const accent = isArchitect ? QUANTUM : isGoal ? DUST : 'transparent';

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '64px 120px 1fr',
      gap: 16,
      padding: '14px 16px',
      borderBottom: `1px solid ${HAIRLINE}`,
      borderLeft: `2px solid ${accent}`,
      alignItems: 'baseline',
    }}>
      <span style={{
        fontVariantNumeric: 'tabular-nums',
        fontWeight: 700,
        fontSize: 13,
        color: isGoal || isArchitect ? DUST : DUST_70,
      }}>
        {event.minute}{event.minute > 90 ? '+' : "'"}
      </span>
      <span style={{
        fontSize: 11,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: isArchitect ? QUANTUM : DUST_70,
        fontWeight: 700,
      }}>
        {prettifyEventType(event.type)}
      </span>
      <span style={{
        fontSize: 14,
        lineHeight: 1.5,
        color: DUST,
      }}>
        {text}
      </span>
    </div>
  );
}

/**
 * Prettify a snake_case event-type key into a Title-Case display label.
 * Mirrors prettifyWeather() above — kept as a separate function (rather than
 * generalising) so a future change to event-type display rules doesn't
 * inadvertently shift the weather chip wording.
 *
 * @param key  Raw event.type string from match_events (e.g. 'penalty_kick').
 * @returns    Title-Case label suitable for the event-type chip.
 */
function prettifyEventType(key: string): string {
  if (!key) return '—';
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c: string) => c.toUpperCase());
}
