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

      <section style={{ padding: '48px 16px 24px' }}>
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
        <section style={{ padding: '0 0 48px' }}>
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
        <section style={{ padding: '0 0 48px' }}>
          <Container>
            <LiveCommentary match={match} />
          </Container>
        </section>
      )}

      {match && !loadError && (
        <section style={{ padding: '0 0 80px' }}>
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
  const rawStatus   = match.status ?? 'scheduled';

  const homeName  = match.home_team?.name     ?? '?';
  const awayName  = match.away_team?.name     ?? '?';
  const homeColor = match.home_team?.color    ?? null;
  const awayColor = match.away_team?.color    ?? null;
  const homeLoc   = match.home_team?.location ?? '';
  const awayLoc   = match.away_team?.location ?? '';
  const homeScore = match.home_score ?? 0;
  const awayScore = match.away_score ?? 0;

  // ── Perceived status (time-based override of the DB status) ───────────────
  // The match-worker pre-simulates the entire 90 minutes in ~10–60 s and
  // flips `status` to `completed` long before the viewer is done pacing the
  // event log on the wall clock.  For the hero pip and the pulsing score dot
  // we want the answer to "is this match live RIGHT NOW from the user's
  // perspective?", not "has the worker finished writing rows?".
  //
  // PERCEIVED_LIVE_WINDOW_MS is the wall-clock budget the viewer uses to
  // reveal the match minute-by-minute.  Mirrors season_config.
  // match_duration_seconds default (600 s = 10 minutes).  Sourcing the
  // actual season knob would require an extra DB roundtrip the hero doesn't
  // currently make; LiveCommentary fetches it for the event filter and a
  // mismatch here would only show "Full Time" up to a few minutes early on
  // non-default seasons, which is acceptable for v1.
  const PERCEIVED_LIVE_WINDOW_MS = 600 * 1000;
  const kickoffMs = match.scheduled_at ? new Date(match.scheduled_at).getTime() : null;
  // Snapshot Date.now() once for both boundary checks.  React-hooks's purity
  // rule flags Date.now() in render — we accept that here for the same reason
  // LiveCommentary does (lines 790/810 in this file): the hero re-renders
  // when the parent's match state changes, and stale "Live" past the pacing
  // window is harmless (it resolves on refresh / nav).  Hero has no per-second
  // tick because the pip / pulse don't need sub-minute precision.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const inPacingWindow = kickoffMs != null
    && nowMs >= kickoffMs
    && nowMs < kickoffMs + PERCEIVED_LIVE_WINDOW_MS;
  // 'completed' rows get upgraded to 'in_progress' while still inside the
  // pacing window so the pip reads "Live" and the score pulses.  Scheduled
  // and cancelled rows are untouched — a scheduled match should never read
  // as live, and a cancelled match was never played.
  const status = (rawStatus === 'completed' && inPacingWindow)
    ? 'in_progress'
    : rawStatus;

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
 * Merge two event lists into one, de-duplicating by `id` and re-sorting
 * chronologically by (minute, subminute).  The single funnel through which
 * BOTH the initial `getMatchEvents()` fetch and the Realtime `INSERT` stream
 * pass — that uniformity is what makes `filterEventsByElapsedMinute` correct
 * regardless of which source delivered a given row first.
 *
 * WHY DEDUP IS NECESSARY
 *   The two sources can deliver the same row twice in a narrow window:
 *     - Worker batch-inserts events → Realtime fires for each row
 *     - A late-mounting viewer's initial fetch may complete *after* the
 *       Realtime subscription has already captured those same rows
 *   Identifying by `id` (the `match_events.id` UUID) is the only stable
 *   join key — `(match_id, minute, subminute)` is not unique because the
 *   gameEngine can emit multiple events at the same subminute.
 *
 * WHY WE RE-SORT EVERY MERGE
 *   `filterEventsByElapsedMinute` preserves input order; downstream
 *   `CommentaryFeed` reverses the array to show newest-first.  Both contracts
 *   assume chronological input.  Keeping the merged list sorted here saves a
 *   sort in the visible-event memo on every tick (which fires every second
 *   during the paced window).
 *
 * @param existing  The current event list held in React state.
 * @param incoming  Newly arrived events from either the initial fetch
 *                  (potentially the full pre-simulated log) or the Realtime
 *                  channel (one row at a time).
 * @returns         A new array — never the same reference as either input —
 *                  containing every unique-by-id event from both sources,
 *                  ordered by (minute ASC, subminute ASC).
 */
export function mergeAndSortEvents(
  existing: MatchEventRow[],
  incoming: MatchEventRow[],
): MatchEventRow[] {
  // Build a set of existing IDs in O(n) so the dedup pass below is O(m) over
  // the incoming batch.  This matters for the initial-fetch case where
  // `incoming` may contain ~150 rows.
  const seen = new Set(existing.map((e) => e.id));
  const merged: MatchEventRow[] = existing.slice();
  for (const row of incoming) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
  }
  // Stable chronological sort: (minute ASC, then subminute ASC as numeric).
  // subminute is `numeric` in PostgREST which can surface as a string in the
  // typed row — Number() normalises so the comparator never compares strings.
  return merged.sort(
    (a, b) => a.minute - b.minute || Number(a.subminute) - Number(b.subminute),
  );
}

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
export function LiveCommentary({ match }: { match: LiveCommentaryMatch }) {
  const db = useSupabase();

  // ── Guard derivations ─────────────────────────────────────────────────────
  // The "live experience" anchors on wall-clock vs scheduled_at, NOT on the
  // match's row status.  This decouples the viewer's pacing from the worker's
  // 30-second simulation burst: a match that completed in the DB ten minutes
  // before a viewer opens the page should still play out at the viewer's
  // pace from kickoff if the elapsed wall-clock is < match_duration_seconds.
  //
  // STATUS still gates a few things:
  //   • Cancelled matches never render this section (no events to show).
  //   • Pre-kickoff scheduled matches in the *future* don't render either —
  //     there's nothing to fetch yet.
  // Otherwise everything is time-driven via `scheduled_at + duration`.
  const status      = match?.status ?? 'scheduled';
  const isCancelled = status === 'cancelled';
  const kickoffMs   = match?.scheduled_at ? new Date(match.scheduled_at).getTime() : null;
  const kickoffPassed = kickoffMs != null && kickoffMs <= Date.now();

  // Render the section once kickoff has passed for any non-cancelled match,
  // OR for any completed match (covers retroactive replays of matches whose
  // scheduled_at metadata was lost / never set).
  const showSection = !isCancelled && (kickoffPassed || status === 'completed');

  const [events,        setEvents]        = useState<MatchEventRow[]>([]);
  const [duration,      setDuration]      = useState<number>(DEFAULT_MATCH_DURATION_SECONDS);
  const [elapsedMinute, setElapsedMinute] = useState<number>(0);
  const [loaded,        setLoaded]        = useState<boolean>(false);
  const [loadError,     setLoadError]     = useState<unknown>(null);

  // Derived "is the viewer still inside the paced window?" — true while
  // wall-clock elapsed-from-kickoff is < match_duration_seconds.  Used to
  // (a) keep the per-second tick going only while it can change anything,
  // (b) keep the Realtime subscription open only while new events are
  // expected, and (c) decide between "Live" headings and "Replay" headings.
  const livePacingWindowOpen =
    kickoffMs != null &&
    Date.now() < kickoffMs + duration * 1000;

  // ── Initial fetch: event log + season pacing knob ─────────────────────────
  // Both queries fire in parallel — they hit independent tables and the page
  // can't render anything useful until both settle.  Promise.all keeps total
  // wall-clock latency to the slower of the two.  Skipped for cancelled and
  // pre-kickoff scheduled matches because the empty section won't render.
  //
  // Reset-on-match-change: when the user navigates between /matches/:a and
  // /matches/:b without the component unmounting (client-side routing), the
  // `events` state from match A would otherwise leak into match B's feed —
  // dedup-by-id won't catch them because the ids differ.  Clearing first
  // guarantees a clean slate, so the fetched rows can be assigned directly
  // (the Realtime stream still merges its own arrivals).
  useEffect(() => {
    if (!showSection || !match?.id) return undefined;
    let cancelled = false;
    setEvents([]);
    setLoaded(false);
    setLoadError(null);
    Promise.all([
      getMatchEvents(db, match.id),
      getMatchDurationSeconds(db, match.id),
    ])
      .then(([evRows, durSeconds]) => {
        if (cancelled) return;
        // Merge against current state (not []) so a Realtime row that landed
        // between the setEvents([]) above and this resolution is preserved.
        setEvents((prev) => mergeAndSortEvents(prev, evRows));
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
  // Always anchors on `scheduled_at + duration`.  Three branches:
  //   1. No scheduled_at metadata → fall back to "show all" via 120 so
  //      legacy / malformed rows still render their full event log.
  //   2. Paced window still open (now < kickoff + duration) → tick every
  //      LIVE_TICK_MS so freshly-elapsed events appear without a refresh.
  //   3. Paced window has closed (replay state) → jump straight to 120 so
  //      filterEventsByElapsedMinute returns the full log on first paint.
  useEffect(() => {
    const kickoff = match?.scheduled_at;
    if (!kickoff) {
      // No anchor → defer to status for the "show everything" behaviour.
      // Completed matches with no scheduled_at still display fully; pre-
      // kickoff scheduled matches without metadata won't render at all
      // (showSection is false above).
      if (status === 'completed') setElapsedMinute(120);
      return undefined;
    }

    const kickoffAtMs = new Date(kickoff).getTime();
    const endAtMs     = kickoffAtMs + duration * 1000;

    if (Date.now() >= endAtMs) {
      // Paced window already closed — render as replay (full log).
      setElapsedMinute(120);
      return undefined;
    }

    // SELF-TERMINATING INTERVAL: this effect's deps never change as the
    // wall clock advances, so without an internal `clearInterval` the
    // setInterval would keep firing every second forever once the page
    // sits past `endAtMs` — React would bail out of the duplicate
    // setState updates but the timer itself would leak for the entire
    // tab lifetime, burning CPU + battery on long-lived sessions.  The
    // tick function self-clears the moment wall-clock crosses endAtMs,
    // emits one final `setElapsedMinute(120)` to flip the section into
    // its replay state, and then returns.
    let interval: ReturnType<typeof setInterval> | null = null;
    const tick = (): void => {
      if (Date.now() >= endAtMs) {
        setElapsedMinute(120);
        if (interval !== null) {
          clearInterval(interval);
          interval = null;
        }
        return;
      }
      setElapsedMinute(computeElapsedGameMinute(kickoff, new Date(), duration));
    };
    tick();
    interval = setInterval(tick, LIVE_TICK_MS);
    return () => {
      if (interval !== null) clearInterval(interval);
    };
  }, [status, match?.scheduled_at, duration]);

  // ── Realtime subscription (whenever new events may still arrive) ──────────
  // Worker writes events as it simulates; without this a viewer who landed
  // on the page mid-simulation would miss everything written after fetch.
  //
  // We keep the subscription open whenever the paced window is still open
  // (not just for `status='in_progress'` as the old code did) because the
  // worker may flip a match to `completed` within seconds of kickoff while
  // the viewer is still pacing through minutes 1–89.  Closed after the
  // window because no further events can arrive then.  De-dupe by id —
  // Realtime payloads can arrive while the initial fetch is still in flight.
  useEffect(() => {
    // showSection mirrors the render-side guard so we don't open a WebSocket
    // channel for cancelled / not-yet-kicked-off matches — those branches
    // return null below and would never display anything the subscription
    // delivered anyway.
    if (!showSection || !livePacingWindowOpen || !match?.id) return undefined;
    return subscribeToMatchEvents(db, match.id, (row) => {
      setEvents((prev) => mergeAndSortEvents(prev, [row]));
    });
  }, [db, match?.id, showSection, livePacingWindowOpen]);

  // ── Visible-event derivation ─────────────────────────────────────────────
  // Recomputed only when events / elapsedMinute change.  Memoised to avoid
  // re-running filterEventsByElapsedMinute on every parent render (cheap
  // today but the list can grow to ~150 rows per match).
  //
  // No special-case for completed matches: the elapsed-minute effect above
  // already jumps elapsedMinute → 120 once the paced window closes, which
  // makes filterEventsByElapsedMinute return everything anyway.
  const visibleEvents = useMemo(
    () => filterEventsByElapsedMinute(events, elapsedMinute),
    [events, elapsedMinute],
  );

  if (!showSection) return null;

  // ── Section copy ──────────────────────────────────────────────────────────
  // The kicker / label / subtitle differ by status so the section reads as
  // either "the match is happening right now" or "here's what happened".
  // Kept inline (not extracted) because each status branch only ever appears
  // once per page render and pulling it out adds indirection without reuse.
  const heading = livePacingWindowOpen
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
      {livePacingWindowOpen && loaded && (
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
          {livePacingWindowOpen
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
