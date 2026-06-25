// ── MatchDetail.tsx ─────────────────────────────────────────────────────────
// Single-match detail page — `/matches/:matchId` route. Relaid out to match the
// design system's `Match.html` worked screen (the "live match theatre").
//
// Layout (matches the prototype top → bottom):
//   Header (global)
//   I.   Eyebrow head  — backlink + breadcrumb (Matches • competition • round)
//   II.  Scoreboard    — `.board`: stadium + attendance / status clock, a
//                        divider, then a crest-name-score teams row. NO
//                        momentum bar (no momentum data exists — omitted, not
//                        faked).
//   III. `.main` grid  — two columns, `1fr 380px`, collapsing to one under
//                        ~900px:
//          LEFT (`.col-l`):
//            • 2D pitch panel (`MatchPitchPanel`) — rehomed here from the old
//              pitch-grid; the prototype omits it but it's a real feature.
//            • Live commentary feed (`LiveCommentary` → `.feed`) — pre-simulated
//              `match_events` revealed at wall-clock pace.
//            • Match record timeline (`.tl`) — derived from the SAME events the
//              commentary already holds (goals / cards / architect / subs).
//          RIGHT (`.rail`, sticky):
//            • `<WagerWidget/>` — the real credit-betting picker, rendered
//              UNCHANGED. The prop bet ("Will the Architect manifest?") is
//              omitted — there's no backend bet type for it.
//   IV.  Stats         — match_player_stats table grouped by side
//   Footer (shared)
//
// Data sources (all UNCHANGED from the previous build):
//   - getMatch(db, matchId) — joins home_team, away_team, competitions,
//     and match_player_stats (with player meta)
//   - getMatchEvents(db, matchId) — full pre-simulated event log
//   - getMatchDurationSeconds(db, matchId) — season pacing knob
//   - subscribeToMatchEvents(db, matchId, onInsert) — Realtime event stream
//   - getMatchPositions(db, matchId) — spatial frames for the 2D viewer
//
// 404 case: matchId returns no row → renders an "Unknown Match" surface.

import { useEffect, useMemo, useState, type ComponentProps, type CSSProperties } from 'react';
import { Link, useParams } from 'react-router-dom';
import Header from '../components/Header';
import { COLORS, Container, SectionHeader, Footer, BackLink, TeamCrest } from '../components/Layout';
import WagerWidget from '../components/WagerWidget';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import { getActiveWatcherCount } from '../features/auth';
import {
  getMatch,
  computeElapsedGameMinute,
  filterEventsByElapsedMinute,
  getMatchEvents,
  getMatchDurationSeconds,
  subscribeToMatchEvents,
  DEFAULT_MATCH_DURATION_SECONDS,
  MatchViewer,
  type MatchViewerPlayer,
  type MatchEventRow,
} from '../features/match';
import { getMatchPositions, type PositionSnapshot } from '../features/match/api/matchPositions';
import TeachingStrip from '../components/TeachingStrip';

// ── Local aliases for terser inline styles ──────────────────────────────────
// QUANTUM (focus) drives LIVE indicators; FLARE is retained for both
// the genuine fetch-failure error and the Cancelled status pip
// (cancellation is the only match status that genuinely is an error
// outcome — every wager on it gets voided).
const { dust: DUST, abyss: ABYSS, flare: FLARE, quantum: QUANTUM, terraNova: TERRA } = COLORS;
const HAIRLINE = COLORS.hairline;
// border-faint from the design system (0.25) — the brighter inner divider the
// prototype uses inside the scoreboard / feed / timeline.
const BORDER_FAINT = 'rgba(227, 224, 213, 0.25)';
const DUST_50  = COLORS.dust50;
const DUST_70  = COLORS.dust70;

// ── Status mapping ──────────────────────────────────────────────────────────
// STATUS_LABELS — display copy for the status chip on the scoreboard.
// Matches the wording used on the Matches index so the two surfaces
// agree on terminology.
const STATUS_LABELS: Record<string, string> = {
  in_progress: 'Live',
  completed:   'Full Time',
  scheduled:   'Scheduled',
  cancelled:   'Cancelled',
};

// ── Loose match row ─────────────────────────────────────────────────────────
// getMatch() returns a deeply-nested join (home_team / away_team / managers /
// players / competitions / match_player_stats) the page reads defensively. The
// page-level state stays `any` (the pre-existing pattern), but the section
// components below take this index-signature alias instead of a fresh `any`
// per component — the same loose-but-named shape, with no net-new `no-explicit-
// any`. Reads are still per-field, so nothing here is type-checked beyond
// "this is an object" — but it keeps the lint surface flat.
type MatchRow = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// The exact match-row shape WagerWidget consumes (id / status / team refs),
// derived from its prop type so the cast at the call site stays in sync if the
// widget's contract changes. We never reshape the row — the cast only narrows
// the loose MatchRow to the typed boundary WagerWidget already enforces.
type WagerMatch = ComponentProps<typeof WagerWidget>['match'];

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

  const [match,     setMatch]     = useState<MatchRow | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loaded,    setLoaded]    = useState<boolean>(false);
  // Cosmos-wide watcher count for the live presence badge (#382). 0 ≡
  // no watchers OR fetch error — both rendered the same (no badge).
  // Refreshed on a 60-second interval so the badge stays roughly in
  // sync with the 5-min server-side presence window without hammering
  // the DB. 60s is the smallest interval that won't compete with the
  // 90s heartbeat in AuthProvider.
  const [watcherCount, setWatcherCount] = useState<number>(0);

  useEffect(() => {
    if (!matchId) return undefined;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard async data-load pattern: reset error/loading state, fire fetch, settle into match+loaded state once it resolves
    setLoadError(null);
    setLoaded(false);
    getMatch(db, matchId)
      .then((data: MatchRow | null) => {
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

  // Live presence count — fetch immediately + on 60s interval. The
  // count is cosmos-wide today rather than per-match because the
  // `active_watchers_v` view aggregates against last_seen_at; a true
  // per-match watcher count would need a separate aggregate that
  // tracks who's looking at THIS match URL. Acceptable shortcut for
  // v1 — the audit's framing is "the game feels alive", which a
  // cosmos number already conveys.
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      getActiveWatcherCount(db).then((n) => {
        if (!cancelled) setWatcherCount(n);
      });
    };
    tick();
    /** Interval in ms between live-presence polls. 60s sits inside the
        5-min server window so the badge never goes stale. */
    const PRESENCE_POLL_MS = 60_000;
    const id = window.setInterval(tick, PRESENCE_POLL_MS);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [db]);

  if (loaded && !match && !loadError) return <UnknownMatch matchId={matchId} />;

  return (
    <div style={{ background: ABYSS, color: DUST, minHeight: '100vh' }}>
      <Header />

      <Container>
        {/* Section I — eyebrow head: backlink + breadcrumb. */}
        <header style={{ padding: '48px 0 0' }}>
          <BackLink to="/matches">All Matches</BackLink>

          {!loaded && (
            <p style={{ marginTop: 32, color: DUST_50, fontStyle: 'italic', fontSize: 13 }}>
              Loading match…
            </p>
          )}

          {loadError != null && (
            <p style={{ marginTop: 32, color: FLARE, fontStyle: 'italic', fontSize: 13 }}>
              Match data unavailable. The void has swallowed the result.
            </p>
          )}

          {match && !loadError && <MatchBreadcrumb match={match} />}
        </header>

        {match && !loadError && (
          <>
            {/* Section II — scoreboard (the prototype's `.board`). */}
            <Scoreboard match={match} watcherCount={watcherCount} />

            {/* First-match teaching strip — "Meet the booth" (#379).
                One-time dismissible strip that introduces the three
                commentator voices + the two cosmic voices. Vision says
                "hide the mechanics", but the *cast* should still be
                introduced — fans need to know who Vox / Nexus-7 / Zara
                are before they can hear them in the live feed below. */}
            <TeachingStrip
              accent
              storageKey="match_meet_the_booth"
              title="Meet the booth"
              body={<>
                <strong style={{ color: COLORS.dust }}>Vox</strong> calls
                the play-by-play. <strong style={{ color: COLORS.dust }}>Nexus-7</strong>{' '}
                breaks down what just happened. <strong style={{ color: COLORS.dust }}>Zara</strong>{' '}
                watches for the unusual. The cosmos itself —{' '}
                <strong style={{ color: COLORS.dust }}>Balance</strong> and{' '}
                <strong style={{ color: COLORS.dust }}>Chaos</strong> — speaks only when
                the match deserves it.
              </>}
            />

            {/* Section III — two-column `.main` grid: theatre + stake rail. */}
            <div
              className="match-main"
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 380px',
                gap: 24,
                alignItems: 'start',
                padding: '24px 0 64px',
              }}
            >
              {/* LEFT column — pitch + commentary feed + timeline. */}
              <div className="match-col-l" style={{ display: 'flex', flexDirection: 'column', gap: 24, minWidth: 0 }}>
                <MatchTheatre match={match} watcherCount={watcherCount} />
              </div>

              {/* RIGHT column — sticky stake rail. WagerWidget unchanged. */}
              <aside
                className="match-rail"
                style={{ position: 'sticky', top: 24, display: 'flex', flexDirection: 'column', gap: 24 }}
              >
                {/* First-time betting intro strip (#379). Brief reminder
                    that stakes lock at placement and the minimum bet is
                    10 IC — the wager widget itself enforces both. */}
                <TeachingStrip
                  storageKey="match_betting_intro"
                  title="How betting works"
                  body={<>
                    Pick an outcome (home, draw, or away) and stake at least
                    10 IC. The odds you see lock the moment you place — the
                    bookie&apos;s later re-pricing won&apos;t claw your
                    potential payout back.
                  </>}
                />
                {/* The loose MatchRow is the real getMatch() row — it carries
                    the id / status / team refs WagerWidget needs at runtime;
                    the cast just re-states that to the typed prop boundary.
                    WagerWidget + its place_wager logic are unchanged. */}
                <WagerWidget match={match as WagerMatch} />
              </aside>
            </div>

            {/* Section IV — player stats. */}
            <section style={{ padding: '0 0 80px' }}>
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
            </section>
          </>
        )}
      </Container>

      <Footer />

      {/* The `.main` grid collapses to a single column on tablet/mobile; the
          stake rail drops below the theatre and stops sticking. */}
      <style>{`
        @media (max-width: 899px) {
          .match-main { grid-template-columns: 1fr !important; }
          .match-rail { position: static !important; }
        }
      `}</style>
    </div>
  );
}

/**
 * Eyebrow breadcrumb under the backlink: Matches • competition • round.
 * Segments with no real value are omitted rather than rendered blank.
 *
 * @param {{ match: object }} props
 */
function MatchBreadcrumb({ match }: { match: MatchRow }) {
  const competition = match.competitions?.name ?? 'League';
  const round       = match.round ?? '';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        marginTop: 24,
        fontSize: 14,
        fontWeight: 700,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        color: DUST,
      }}
    >
      <Link to="/matches" style={{ color: DUST, textDecoration: 'none' }}>Matches</Link>
      <span style={{ color: DUST_50 }}>•</span>
      <span>{competition}</span>
      {round && (
        <>
          <span style={{ color: DUST_50 }}>•</span>
          <span>{round}</span>
        </>
      )}
    </div>
  );
}

/**
 * Scoreboard block (the prototype's `.board`).
 *
 * A 1px-bordered, 32px-padded panel with:
 *   • head row — "{stadium} • Attendance {n}" on the left, a LIVE/status +
 *     clock chip on the right (uses the same time-based status override the
 *     old hero pip made);
 *   • a faint divider;
 *   • a teams row — crest + uppercase name + "Home/Away • {location}" sub,
 *     flanking a 64px score ("{home} · {away}").
 *
 * NO momentum bar: there is no momentum signal in the data, so the prototype's
 * `.bar` is omitted entirely (rendering a random bar would fabricate data).
 *
 * @param {{ match: object, watcherCount: number }} props
 */
function Scoreboard({ match, watcherCount }: { match: MatchRow; watcherCount: number }) {
  const homeName  = match.home_team?.name     ?? '?';
  const awayName  = match.away_team?.name     ?? '?';
  const homeColor = match.home_team?.color    ?? null;
  const awayColor = match.away_team?.color    ?? null;
  const homeLoc   = match.home_team?.location ?? '';
  const awayLoc   = match.away_team?.location ?? '';
  const homeScore = match.home_score ?? 0;
  const awayScore = match.away_score ?? 0;

  const status = perceivedStatus(match);

  // Attendance — only shown when a real count exists.
  const attendance = typeof match.attendance === 'number' ? match.attendance : null;

  return (
    <div
      style={{
        border: `1px solid ${HAIRLINE}`,
        padding: 32,
        marginTop: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 28,
      }}
    >
      {/* Head row — stadium + attendance / status clock. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.04em', color: DUST_70 }}>
          {match.stadium ?? 'Unknown Ground'}
          {attendance != null && (
            <>
              {' '}<span style={{ color: DUST_50 }}>•</span>{' '}
              Attendance {attendance.toLocaleString()}
            </>
          )}
        </span>
        <StatusChip status={status} />
      </div>

      <div style={{ height: 0, borderTop: `1px solid ${BORDER_FAINT}` }} />

      {/* Teams row — crest / name / sub … score … crest / name / sub. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'flex-start',
          gap: 32,
        }}
      >
        <TeamScoreBlock side="Home" name={homeName} location={homeLoc} color={homeColor} />
        <ScoreDisplay status={status} home={homeScore} away={awayScore} />
        <TeamScoreBlock side="Away" name={awayName} location={awayLoc} color={awayColor} />
      </div>

      {/* Live presence badge (#382) — only while the match is live, counting
          cosmos-wide active users. Kept inside the scoreboard so the "alive"
          cue sits next to the live clock. */}
      {status === 'in_progress' && watcherCount > 0 && (
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <span style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: DUST_50 }}>
            <span aria-hidden="true" style={{ color: QUANTUM }}>●</span>{' '}
            <strong style={{ color: DUST_70 }}>{watcherCount}</strong>{' '}
            {watcherCount === 1 ? 'fan' : 'fans'} watching now
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Perceived status (time-based override of the DB status).
 *
 * The match-worker pre-simulates the entire 90 minutes in ~10–60 s and flips
 * `status` to `completed` long before the viewer is done pacing the event log
 * on the wall clock.  For the status chip and the pulsing score dot we want
 * "is this match live RIGHT NOW from the user's perspective?", not "has the
 * worker finished writing rows?".  A `completed` row inside its pacing window
 * is upgraded to `in_progress`; scheduled / cancelled rows are untouched.
 *
 * PERCEIVED_LIVE_WINDOW_MS mirrors season_config.match_duration_seconds default
 * (600 s); sourcing the real season knob would need an extra round-trip the
 * scoreboard doesn't make, and a mismatch only shows "Full Time" a few minutes
 * early on non-default seasons — acceptable for v1.
 *
 * @param {object} match
 * @returns {string} The status to render the chip / score from.
 */
function perceivedStatus(match: MatchRow): string {
  const rawStatus = match.status ?? 'scheduled';
  const PERCEIVED_LIVE_WINDOW_MS = 600 * 1000;
  const kickoffMs = match.scheduled_at ? new Date(match.scheduled_at).getTime() : null;
  // Wall-clock read in a plain helper (not a component render), so the
  // react-hooks/purity rule doesn't apply here. A stale "Live" past the window
  // is harmless and resolves on the next render / nav.
  const nowMs = Date.now();
  const inPacingWindow = kickoffMs != null
    && nowMs >= kickoffMs
    && nowMs < kickoffMs + PERCEIVED_LIVE_WINDOW_MS;
  return (rawStatus === 'completed' && inPacingWindow) ? 'in_progress' : rawStatus;
}

/**
 * Centred score display.  Two render branches:
 *   in_progress / completed → big bold score with optional live pip
 *   scheduled / cancelled   → faded "v" glyph
 *
 * @param {object} props
 * @param {string} props.status
 * @param {number} props.home
 * @param {number} props.away
 */
function ScoreDisplay({ status, home, away }: { status: string; home: number; away: number }) {
  if (status === 'scheduled' || status === 'cancelled') {
    return (
      <div style={{
        fontSize: 32,
        color: DUST_50,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.14em',
        paddingTop: 30,
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
      fontSize: 64,
      fontWeight: 700,
      fontVariantNumeric: 'tabular-nums',
      lineHeight: 1,
      paddingTop: 30,
    }}>
      {status === 'in_progress' && (
        <span
          aria-hidden="true"
          style={{
            width: 12,
            height: 12,
            borderRadius: '50%',
            background: QUANTUM,
            boxShadow: `0 0 8px ${QUANTUM}`,
          }}
        />
      )}
      <span>
        {home} <span style={{ color: DUST_50, fontSize: 44 }}>·</span> {away}
      </span>
    </div>
  );
}

/**
 * Single-team score block — crest silhouette, uppercase name, side + location.
 *
 * @param {object} props
 * @param {'Home'|'Away'} props.side
 * @param {string} props.name
 * @param {string} props.location
 * @param {string|null} props.color
 */
function TeamScoreBlock(
  { side, name, location, color }: { side: 'Home' | 'Away'; name: string; location: string; color: string | null },
) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      <TeamCrest color={color} />
      <h2 style={{
        fontSize: 26,
        fontWeight: 700,
        textTransform: 'uppercase',
        textAlign: 'center',
        margin: 0,
        lineHeight: 1.1,
      }}>
        {name}
      </h2>
      <div style={{
        fontSize: 13,
        fontWeight: 700,
        color: DUST_70,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        textAlign: 'center',
      }}>
        {side}
        {location && <> <span style={{ color: DUST_50 }}>•</span> {location}</>}
      </div>
    </div>
  );
}

/**
 * Status chip — the prototype's `.isl-live` pill in the scoreboard head.  Live
 * matches get a Quantum pulse dot; cancelled use Solar Flare (the genuine error
 * outcome — every wager voided); others read neutral dust.
 *
 * @param {{ status: string }} props
 */
function StatusChip({ status }: { status: string }) {
  const isLive      = status === 'in_progress';
  const isCancelled = status === 'cancelled';
  const colour      = isLive ? QUANTUM : isCancelled ? FLARE : DUST;
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      padding: '6px 12px',
      border: `1px solid ${colour}`,
      color:  colour,
      fontSize: 11,
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
 * One row of the nested `match_player_stats` join the stats section reads.
 * Loosely modelled (every field optional / nullable) because the row arrives
 * from a deeply-nested Supabase join and the table renders each cell
 * defensively with `?? 0` / `?? '—'` fallbacks.
 */
interface PlayerStatRow {
  id: string;
  team_id?: string | null;
  player_id?: string | null;
  players?: { name?: string | null } | null;
  goals?: number | null;
  assists?: number | null;
  yellow_cards?: number | null;
  red_cards?: number | null;
  minutes_played?: number | null;
  rating?: number | null;
}

/** Minimal team reference the stats tables read (id for bucketing, name for the header). */
interface TeamRef {
  id?: string | null;
  name?: string | null;
}

/**
 * Player stats section.  Splits the match_player_stats array by team
 * (home vs away based on team_id) and renders each side as its own
 * sub-table, sorted by rating DESC then by goals DESC.
 *
 * @param props.homeTeam  Home team reference (id + name).
 * @param props.awayTeam  Away team reference (id + name).
 * @param props.stats     The flat match_player_stats array for both sides.
 */
function PlayerStats(
  { homeTeam, awayTeam, stats }: { homeTeam: TeamRef | null; awayTeam: TeamRef | null; stats: PlayerStatRow[] },
) {
  if (stats.length === 0) {
    return (
      <p style={{ marginTop: 24, color: DUST_50, fontSize: 13, fontStyle: 'italic' }}>
        Player stats unavailable for this match.
      </p>
    );
  }

  // Bucket by team_id so home / away tables render side-by-side.  The
  // sort is stable (rating DESC → goals DESC) so MVPs surface at the
  // top of each list.
  const sortStats = (a: PlayerStatRow, b: PlayerStatRow) =>
    (b.rating ?? 0) - (a.rating ?? 0) || (b.goals ?? 0) - (a.goals ?? 0);
  const homeStats = stats.filter((s) => s.team_id === homeTeam?.id).sort(sortStats);
  const awayStats = stats.filter((s) => s.team_id === awayTeam?.id).sort(sortStats);

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
 * scans as the "MVP" column.
 *
 * @param props.team   Home or away team reference (id + name).
 * @param props.rows   The team's player-stat rows, pre-sorted by rating.
 */
function StatsTable({ team, rows }: { team: TeamRef | null; rows: PlayerStatRow[] }) {
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
          {rows.map((s) => (
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

const statsTd: CSSProperties = { textAlign: 'left', padding: '10px 12px' };
const statsTh = (width?: number | string): CSSProperties => ({
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
function UnknownMatch({ matchId }: { matchId?: string | undefined }) {
  return (
    <div style={{
      background: ABYSS,
      color: DUST,
      minHeight: '100vh',
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

// ── Match theatre (left column: pitch + commentary feed + timeline) ──────────
//
// MatchTheatre owns the wall-clock window decision (is the pitch on screen?)
// and threads the SAME `match_events` stream LiveCommentary already holds into
// the new "Match record" timeline, so the timeline needs no extra fetch.
//
// The match worker pre-simulates a fixture at its kickoff_at instant, writing
// every notable beat into `match_events` with a monotone (minute, subminute)
// ordering.  LiveCommentary reads that pre-simulated stream and reveals it
// client-side via two complementary mechanisms:
//
//   1. computeElapsedGameMinute(kickoff, now, durationSeconds) — pure helper
//      from features/match/logic that maps wall-clock seconds onto the
//      simulated 0–90 minute axis.  A setInterval re-runs the helper once
//      per second so freshly-elapsed events appear without a page refresh.
//
//   2. subscribeToMatchEvents(db, matchId, onInsert) — Supabase Realtime
//      filtered to `match_id=eq.<id>` so a late-joining viewer doesn't miss
//      events the worker writes after the page loaded.
//
// THE FOUR RENDER BRANCHES (driven by match.status):
//   • scheduled  → nothing renders (no events to show pre-kickoff)
//   • cancelled  → nothing renders (the match was never played)
//   • in_progress → ticking commentary feed, capped at elapsedMinute
//   • completed   → the full event log dumped at once

/**
 * Left-column theatre: the 2D pitch panel above the live commentary feed and
 * the derived match-record timeline.
 *
 * The pitch belongs on screen while the match is LIVE from the viewer's
 * perspective — a wall-clock window, NOT the raw DB status.  The worker flips
 * status → 'completed' ~90 s into a 10-minute paced window, so gating on status
 * alone would yank the pitch away mid-match.  Show it for scheduled /
 * in-progress rows AND for any match still inside its pacing window.
 *
 * @param props.match  Full match row from getMatch().
 */
function MatchTheatre({ match }: { match: MatchRow; watcherCount: number }) {
  const kickoffMs = match.scheduled_at ? new Date(match.scheduled_at).getTime() : null;
  // eslint-disable-next-line react-hooks/purity -- wall-clock read; a stale value only mis-decides the pitch near the window edge and self-corrects on the next render / nav
  const nowMs = Date.now();
  const withinPacingWindow = kickoffMs != null
    && nowMs >= kickoffMs
    && nowMs < kickoffMs + DEFAULT_MATCH_DURATION_SECONDS * 1000;
  const showPitch =
    match.status === 'in_progress' || match.status === 'scheduled' || match.status === 'live'
    || withinPacingWindow;

  return (
    <>
      {showPitch && (() => {
        // Pull team names + scores defensively from the (loosely typed) match
        // row so the SVG's aria-label reads the scoreline for screen readers.
        // Conditional spread keeps strict-optional-prop types happy by NOT
        // setting a key when the value would be undefined.
        const homeName = (match.home_team as { name?: string } | null | undefined)?.name;
        const awayName = (match.away_team as { name?: string } | null | undefined)?.name;
        const hs = typeof match.home_score === 'number' ? match.home_score : undefined;
        const as = typeof match.away_score === 'number' ? match.away_score : undefined;
        return (
          <MatchPitchPanel
            matchId={match.id}
            {...(homeName != null && { homeTeamName: homeName })}
            {...(awayName != null && { awayTeamName: awayName })}
            {...(hs != null && { homeScore: hs })}
            {...(as != null && { awayScore: as })}
          />
        );
      })()}

      <LiveCommentary match={match} />
    </>
  );
}

// ── Wall-clock tick rate ────────────────────────────────────────────────────
/**
 * Milliseconds between elapsed-minute recomputations during a live match.
 * 1000 ms = once per real-time second.  Game minutes advance at roughly
 * 6.7 real seconds each (600 s / 90 min) under the production default, so
 * any tick rate ≤ 1 s is fast enough to never miss a minute boundary.
 */
const LIVE_TICK_MS = 1000;

/**
 * Merge two event lists into one, de-duplicating by `id` and re-sorting
 * chronologically by (minute, subminute).  The single funnel through which
 * BOTH the initial `getMatchEvents()` fetch and the Realtime `INSERT` stream
 * pass — that uniformity is what makes `filterEventsByElapsedMinute` correct
 * regardless of which source delivered a given row first.
 *
 * @param existing  The current event list held in React state.
 * @param incoming  Newly arrived events from either the initial fetch or the
 *                  Realtime channel.
 * @returns         A new array (never the same reference as either input)
 *                  containing every unique-by-id event, ordered by (minute
 *                  ASC, subminute ASC).
 */
export function mergeAndSortEvents(
  existing: MatchEventRow[],
  incoming: MatchEventRow[],
): MatchEventRow[] {
  const seen = new Set(existing.map((e) => e.id));
  const merged: MatchEventRow[] = existing.slice();
  for (const row of incoming) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
  }
  return merged.sort(
    (a, b) => a.minute - b.minute || Number(a.subminute) - Number(b.subminute),
  );
}

/**
 * Subset of the matches row this component actually reads.  Declared loosely
 * because `getMatch()` returns the full joined row with many more fields the
 * commentary feed doesn't need.
 */
interface LiveCommentaryMatch {
  id?:           string;
  status?:       string;
  scheduled_at?: string | null;
}

/**
 * Live commentary feed for a single match, plus the derived match-record
 * timeline beneath it.
 *
 * Pulls the full pre-simulated event log on mount, looks up the season's
 * pacing knob, then either ticks once per second (in_progress) or paints
 * the full log immediately (completed).  Scheduled and cancelled matches
 * return null so the section disappears entirely.
 *
 * Realtime subscription is only attached while the paced window is open;
 * completed-and-past matches have no further events incoming.
 *
 * @param props.match  Match row from getMatch() — needs id, status, and
 *                     scheduled_at (the kickoff anchor for elapsed math).
 */
export function LiveCommentary({ match }: { match: LiveCommentaryMatch }) {
  const db = useSupabase();

  // The "live experience" anchors on wall-clock vs scheduled_at, NOT on the
  // match's row status.  STATUS still gates a few things:
  //   • Cancelled matches never render this section (no events to show).
  //   • Pre-kickoff scheduled matches in the *future* don't render either.
  const status      = match?.status ?? 'scheduled';
  const isCancelled = status === 'cancelled';
  const kickoffMs   = match?.scheduled_at ? new Date(match.scheduled_at).getTime() : null;
  // eslint-disable-next-line react-hooks/purity -- intentional wall-clock read; re-renders are driven by the per-second elapsedMinute tick below
  const kickoffPassed = kickoffMs != null && kickoffMs <= Date.now();

  const showSection = !isCancelled && (kickoffPassed || status === 'completed');

  const [events,        setEvents]        = useState<MatchEventRow[]>([]);
  const [duration,      setDuration]      = useState<number>(DEFAULT_MATCH_DURATION_SECONDS);
  const [elapsedMinute, setElapsedMinute] = useState<number>(0);
  const [loaded,        setLoaded]        = useState<boolean>(false);
  const [loadError,     setLoadError]     = useState<unknown>(null);

  // Derived "is the viewer still inside the paced window?" — true while
  // wall-clock elapsed-from-kickoff is < match_duration_seconds.
  const livePacingWindowOpen =
    kickoffMs != null &&
    // eslint-disable-next-line react-hooks/purity -- intentional wall-clock read; the per-second elapsedMinute tick re-renders to keep this fresh
    Date.now() < kickoffMs + duration * 1000;

  // ── Initial fetch: event log + season pacing knob ─────────────────────────
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
  useEffect(() => {
    const kickoff = match?.scheduled_at;
    if (!kickoff) {
      if (status === 'completed') setElapsedMinute(120);
      return undefined;
    }

    const kickoffAtMs = new Date(kickoff).getTime();
    const endAtMs     = kickoffAtMs + duration * 1000;

    if (Date.now() >= endAtMs) {
      setElapsedMinute(120);
      return undefined;
    }

    // SELF-TERMINATING INTERVAL: the tick self-clears the moment wall-clock
    // crosses endAtMs, emits one final setElapsedMinute(120) to flip the
    // section into its replay state, and then returns.
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
  useEffect(() => {
    if (!showSection || !livePacingWindowOpen || !match?.id) return undefined;
    return subscribeToMatchEvents(db, match.id, (row) => {
      setEvents((prev) => mergeAndSortEvents(prev, [row]));
    });
  }, [db, match?.id, showSection, livePacingWindowOpen]);

  // ── Visible-event derivation ─────────────────────────────────────────────
  const visibleEvents = useMemo(
    () => filterEventsByElapsedMinute(events, elapsedMinute),
    [events, elapsedMinute],
  );

  if (!showSection) return null;

  // ── Section copy ──────────────────────────────────────────────────────────
  const heading = livePacingWindowOpen
    ? {
        title:    'The booth',
        sub:      'Vox · Nexus-7 · Zara · live',
        empty:    'The void is silent. Awaiting the first whistle…',
        // Kept verbatim — the commentary tests assert on the "Live Feed" string.
        stateTag: 'Live Feed',
      }
    : {
        title:    'The booth',
        sub:      'Vox · Nexus-7 · Zara · replay',
        empty:    'No events were recorded for this match.',
        // Kept verbatim — the commentary tests assert on the "The Replay" string.
        stateTag: 'The Replay',
      };

  return (
    <>
      {/* COMMENTARY FEED (the prototype's `.feed`). */}
      <div style={feedShellStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: 16, textTransform: 'uppercase' }}>{heading.title}</span>
          <span style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em', color: DUST_70 }}>
            {heading.sub}
          </span>
        </div>

        {/* State tag — preserves the "Live Feed" / "The Replay" copy the
            commentary tests assert on, plus the live minute indicator. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <span style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', fontWeight: 700, color: livePacingWindowOpen ? QUANTUM : DUST_70 }}>
            {heading.stateTag}
          </span>
          {livePacingWindowOpen && loaded && (
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 11,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              fontWeight: 700,
              color: QUANTUM,
            }}>
              <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: QUANTUM, boxShadow: `0 0 4px ${QUANTUM}`, display: 'inline-block' }} />
              Minute {Math.min(elapsedMinute, 90)}
              {elapsedMinute > 90 && <> + {elapsedMinute - 90}</>}
            </span>
          )}
        </div>

        {loadError != null && (
          <p style={{ color: FLARE, fontSize: 13, fontStyle: 'italic', margin: 0 }}>
            Commentary feed unavailable. The cosmic broadcast has cut out.
          </p>
        )}

        {!loadError && !loaded && (
          <p style={{ color: DUST_50, fontSize: 13, fontStyle: 'italic', margin: 0 }}>
            Tuning into the cosmic broadcast…
          </p>
        )}

        {!loadError && loaded && visibleEvents.length === 0 && (
          <p style={{ color: DUST_50, fontSize: 13, fontStyle: 'italic', margin: 0 }}>
            {heading.empty}
          </p>
        )}

        {!loadError && loaded && visibleEvents.length > 0 && (
          <CommentaryFeed events={visibleEvents} />
        )}
      </div>

      {/* MATCH RECORD TIMELINE (the prototype's `.tl`) — derived from the same
          paced events the feed shows, so it never spoils beats the viewer
          hasn't reached and needs no extra fetch. */}
      {!loadError && loaded && (
        <MatchTimeline events={visibleEvents} />
      )}
    </>
  );
}

const feedShellStyle: CSSProperties = {
  border: `1px solid ${HAIRLINE}`,
  padding: 32,
  display: 'flex',
  flexDirection: 'column',
};

/**
 * Vertical feed of pre-simulated match events, rendered most-recent-first
 * (the prototype's scrollable `.entries`).
 *
 * Reverses the chronological input so the latest minute appears at the top.
 * No virtualisation: a 90-minute match yields ~100–150 events which renders
 * fine without windowing.
 *
 * @param props.events  Visible events (already filtered by elapsed minute).
 */
function CommentaryFeed({ events }: { events: MatchEventRow[] }) {
  // Reverse onto a fresh array; mutating the prop array would also reverse
  // the parent's memoised value on every render.
  const ordered = [...events].reverse();
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 22,
      maxHeight: 430,
      overflowY: 'auto',
      paddingRight: 8,
    }}>
      {ordered.map((ev) => (
        <CommentaryRow key={ev.id} event={ev} />
      ))}
    </div>
  );
}

/**
 * Single event entry in the commentary feed (the prototype's `.entry`).
 *
 * A left-bordered card: a byline row (event-type label + minute) over the
 * commentary text.  Architect-touched events get the Quantum-purple left
 * border + uppercase heading treatment so the cosmic interference is visible
 * without explaining the mechanic (per the "hidden mechanics" pillar — the
 * colour cue reads as "something's off" without naming what).
 *
 * @param props.event  One row from match_events.  Payload is jsonb so we
 *                     defensively destructure.
 */
function CommentaryRow({ event }: { event: MatchEventRow }) {
  const text = eventProse(event) ?? prettifyEventType(event.type);
  const isArchitect = isArchitectEvent(event);

  return (
    <div style={{
      borderLeft: `2px solid ${isArchitect ? QUANTUM : BORDER_FAINT}`,
      paddingLeft: 22,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 14 }}>
        <b style={{
          fontWeight: 700,
          fontSize: 15,
          color: isArchitect ? QUANTUM : DUST,
          textShadow: isArchitect ? `0 0 6px rgba(154, 92, 244, 0.8)` : 'none',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}>
          {eventHeading(event)}
        </b>
        <span style={{ marginLeft: 'auto', fontWeight: 700, color: DUST_70, fontVariantNumeric: 'tabular-nums' }}>
          {event.minute}{event.minute > 90 ? '+' : "'"}
        </span>
      </div>
      <p style={{
        margin: 0,
        fontSize: isArchitect ? 14 : 15,
        lineHeight: 1.55,
        color: DUST,
        fontStyle: isArchitect ? 'normal' : 'italic',
        textTransform: isArchitect ? 'uppercase' : 'none',
        fontWeight: isArchitect ? 700 : 400,
        letterSpacing: isArchitect ? '0.04em' : 'normal',
      }}>
        {isArchitect ? text : `“${text}”`}
      </p>
    </div>
  );
}

// ── Match record timeline ────────────────────────────────────────────────────

/** Per-row classification for the timeline. Drives glyph + accent colour. */
type TimelineKind = 'goal' | 'card' | 'arch' | 'other';

/**
 * Glyphs mirror the prototype's `.tl-row` markers:
 *   goal ▲  card ■  architect ◆  substitution ○  other ·
 */
const TIMELINE_GLYPH: Record<TimelineKind, string> = {
  goal:  '▲',
  card:  '■',
  arch:  '◆',
  other: '·',
};

/**
 * True when an event is an Architect beat — either a first-class
 * `architect_interference` event (the cosmos acting in-match, #570) or a regular
 * event the Architect mechanically rewrote (the legacy `architect*` payload
 * flags).  Any match triggers the purple cosmic cue; we never convey *which*
 * interference it was (hidden-mechanics pillar).
 */
export function isArchitectEvent(event: MatchEventRow): boolean {
  if (event.type === 'architect_interference') return true;
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  return (
    payload.architectAnnulled === true ||
    payload.architectForced   === true ||
    payload.architectConjured === true ||
    payload.architectStolen   === true ||
    payload.architectEcho     === true
  );
}

/**
 * The human prose for an event row, or null when it carries none.  Booth events
 * keep their line in `payload.commentary`; Architect-interference beats keep
 * theirs in `payload.proclamation` — surface whichever is present so the
 * cosmos's own words reach the feed instead of a bare type label (#570).
 */
export function eventProse(event: MatchEventRow): string | null {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  if (typeof payload.commentary === 'string' && payload.commentary.length > 0) return payload.commentary;
  if (typeof payload.proclamation === 'string' && payload.proclamation.length > 0) return payload.proclamation;
  return null;
}

/**
 * Heading label for an event row.  Architect beats read as the cast name —
 * "The Architect" — never the interference mechanic, matching the /news feed's
 * treatment and preserving the mystery.
 */
function eventHeading(event: MatchEventRow): string {
  if (event.type === 'architect_interference') return 'The Architect';
  return prettifyEventType(event.type);
}

/**
 * Classify one `match_events` row into a timeline kind.  Priority:
 * architect > goal > card > other — a cosmic-touched goal is more narratively
 * significant than an ordinary goal, and the purple accent is the established
 * "something's off" cue.
 *
 * Event taxonomy (from the spatial engine's adapter): goals are `type==='goal'`
 * or `payload.isGoal`; cards are `type==='foul'` carrying `payload.cardType`,
 * or any type whose key mentions a card; subs / saves fall through to 'other'.
 */
export function classifyTimelineEvent(event: MatchEventRow): TimelineKind {
  if (isArchitectEvent(event)) return 'arch';
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  if (payload.isGoal === true || event.type === 'goal') return 'goal';
  const isCard =
    typeof payload.cardType === 'string' ||
    /card|yellow|red|booking|sending/i.test(event.type);
  if (isCard) return 'card';
  return 'other';
}

/**
 * "Match record" timeline (the prototype's `.tl`).  One `.tl-row` per notable
 * event in `56px 28px 1fr` (minute / glyph / description), derived from the
 * SAME paced events the commentary feed shows — so it stays a real record and
 * never spoils a beat the viewer hasn't reached.  Goals tint Terra-Nova, cards
 * Solar-Flare, architect rows take the Quantum-purple glyph + a faint purple
 * row wash; everything else reads neutral.
 *
 * Subs ('substitution') resolve to 'other' but are first-class timeline beats
 * — they surface with the neutral ○ glyph, matching the prototype's sub row.
 *
 * @param props.events  Visible (paced) events, chronological.
 */
function MatchTimeline({ events }: { events: MatchEventRow[] }) {
  return (
    <div style={{ border: `1px solid ${HAIRLINE}`, padding: 32 }}>
      <div style={{ fontWeight: 700, fontSize: 16, textTransform: 'uppercase', marginBottom: 20 }}>
        Match record
      </div>
      {events.length === 0 ? (
        <p style={{ color: DUST_50, fontSize: 13, fontStyle: 'italic', margin: 0 }}>
          No beats recorded yet.
        </p>
      ) : (
        events.map((ev, idx) => (
          <TimelineRow key={ev.id} event={ev} last={idx === events.length - 1} />
        ))
      )}
    </div>
  );
}

/**
 * One timeline row: minute · glyph · description.  Description leads with a
 * bold prettified event-type label, then the commentary text (matching the
 * prototype's `<b>…</b> …` markup).
 *
 * @param props.event  The event row.
 * @param props.last   True for the final row (drops the bottom hairline).
 */
function TimelineRow({ event, last }: { event: MatchEventRow; last: boolean }) {
  const kind = classifyTimelineEvent(event);
  const text = eventProse(event) ?? '';

  const isArch = kind === 'arch';
  const glyphColour =
    kind === 'goal' ? TERRA :
    kind === 'card' ? FLARE :
    isArch          ? QUANTUM :
    DUST_70;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '56px 28px 1fr',
      gap: 14,
      alignItems: 'baseline',
      padding: '10px 0',
      borderBottom: last ? 0 : `1px solid ${BORDER_FAINT}`,
      // Faint purple row wash for architect beats (the prototype's `.tl-row.arch`).
      background: isArch
        ? 'linear-gradient(90deg, rgba(154,92,244,.10), transparent 70%)'
        : 'transparent',
    }}>
      <span style={{ fontWeight: 700, fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>
        {event.minute}{event.minute > 90 ? '+' : "'"}
      </span>
      <span style={{ fontWeight: 700, fontSize: 15, textAlign: 'center', color: glyphColour }}>
        {TIMELINE_GLYPH[kind]}
      </span>
      <span style={{ fontSize: 15, color: DUST }}>
        <b style={{ fontWeight: 700, color: isArch ? QUANTUM : DUST }}>
          {eventHeading(event)}.
        </b>
        {text && <> {text}</>}
      </span>
    </div>
  );
}

/**
 * Prettify a snake_case event-type key into a Title-Case display label.
 *
 * @param key  Raw event.type string from match_events (e.g. 'penalty_kick').
 * @returns    Title-Case label suitable for display.
 */
function prettifyEventType(key: string): string {
  if (!key) return '—';
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c: string) => c.toUpperCase());
}

// ── MatchPitchPanel ─────────────────────────────────────────────────────────
// Fetches a single match's metadata + spatial position frames and feeds them to
// the canvas <MatchViewer>.  It owns NO event subscription — the viewer is
// position-driven (the match sim writes every player + ball position to
// `match_positions`), so the play-by-play feed remains LiveCommentary's job.

/**
 * One player row from getMatch's nested `teams.players` join.  Narrow on purpose
 * so the loose (Json-nested) `getMatch` return narrows cleanly at this seam —
 * only the viewer's needs (id + position) and the engine-aligned ordering keys
 * (starter, overall_rating) are modelled.
 */
interface MatchPlayerRow {
  id:             string;
  position:       string;
  starter:        boolean;
  overall_rating: number | null;
}

/**
 * Supported formation keys, mirroring the FormationKey union.  The manager
 * column is constrained at the DB layer (migration 0045), but we still narrow
 * at this boundary so a future drift fails loud here, not in the renderer.
 */
const SUPPORTED_FORMATIONS = ['4-4-2', '3-4-3', '4-5-1', '5-4-1'] as const;
type SupportedFormation = (typeof SUPPORTED_FORMATIONS)[number];

/**
 * Narrow a free-text formation column value to a SupportedFormation, defaulting
 * to '4-4-2' so a malformed or future value still paints a sensible shape.
 */
function narrowFormation(raw: unknown): SupportedFormation {
  return typeof raw === 'string' && (SUPPORTED_FORMATIONS as readonly string[]).includes(raw)
    ? (raw as SupportedFormation)
    : '4-4-2';
}

/**
 * Pick the match squad in slot order: the starting XI (GK first) followed by up
 * to five substitutes, mirroring the engine's `ORDER BY starter DESC,
 * overall_rating DESC, id ASC` (and its bench selection).  The first 11 map to
 * the formation slots; the rest are bench labels so <MatchViewer> can draw a
 * substitute once they come on.  Teams with fewer than 11 return what they have
 * — the viewer pads missing slots with synthetic ids so the pitch is full.
 *
 * @param players  Full roster array from getMatch.
 * @returns        Up to 16 players: the XI in slot order, then the bench.
 */
function pickSquad(players: readonly MatchPlayerRow[]): MatchPlayerRow[] {
  // Stable sort: clone first because Array.prototype.sort mutates.
  const sorted = [...players].sort((a, b) => {
    if (a.starter !== b.starter) return a.starter ? -1 : 1;
    const ra = a.overall_rating ?? 0;
    const rb = b.overall_rating ?? 0;
    if (ra !== rb) return rb - ra;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return sorted.slice(0, 16); // 11 starters (slot order) + up to 5 bench
}

/** Map a roster row to the minimal { id, position } shape the viewer consumes. */
function toViewerPlayer(p: MatchPlayerRow): MatchViewerPlayer {
  return { id: p.id, position: p.position };
}

/**
 * Panel that fetches a match's formation/colours/starting-XI + position frames
 * and renders the canvas <MatchViewer>.  Shows a static formation rest state
 * until frames arrive, then replays the simulated match.
 *
 * @param props.matchId       UUID of the match to render.
 * @param props.homeTeamName  Optional home name for the screen-reader label.
 * @param props.awayTeamName  Optional away name for the label.
 * @param props.homeScore     Optional home score for the label.
 * @param props.awayScore     Optional away score for the label.
 * @returns                   The viewer panel subtree.
 */
function MatchPitchPanel({
  matchId,
  homeTeamName,
  awayTeamName,
  homeScore,
  awayScore,
}: {
  matchId: string;
  homeTeamName?: string;
  awayTeamName?: string;
  homeScore?:    number;
  awayScore?:    number;
}) {
  const db = useSupabase();
  /**
   * Match metadata that drives the viewer: per-side formation, kit colour, and
   * the starting XI (id + position).  One state slot avoids multiple ping-pongs.
   */
  const [meta, setMeta] = useState<{
    homeFormation: SupportedFormation;
    awayFormation: SupportedFormation;
    homeColor:     string | null;
    awayColor:     string | null;
    homePlayers:   MatchViewerPlayer[];
    awayPlayers:   MatchViewerPlayer[];
  }>({
    homeFormation: '4-4-2',
    awayFormation: '4-4-2',
    homeColor:     null,
    awayColor:     null,
    homePlayers:   [],
    awayPlayers:   [],
  });

  // ── Spatial position frames + pacing ───────────────────────────────────────
  // Pre-loaded from `match_positions`; empty until the worker has simulated the
  // match (or for a legacy match that never gets frames).  `scheduledAt` is the
  // real-time pacing anchor and `duration` the season window — together they map
  // wall-clock time onto the 90-minute replay, the same mapping the feed uses.
  const [positionFrames, setPositionFrames] = useState<PositionSnapshot[]>([]);
  const [scheduledAt,    setScheduledAt]    = useState<string | null>(null);
  const [duration,       setDuration]       = useState<number>(DEFAULT_MATCH_DURATION_SECONDS);

  // ── Initial fetch ─────────────────────────────────────────────────────────
  // Match row (formation + roster + colour), position snapshots, and the season
  // pacing knob in parallel.  Errors are logged + swallowed — the formation rest
  // state is a usable fallback whenever anything is missing.
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard async data-load pattern: clear stale frames before re-fetching for the new matchId
    setPositionFrames([]);
    setScheduledAt(null);
    Promise.all([
      getMatch(db, matchId),
      getMatchPositions(db, matchId),
      getMatchDurationSeconds(db, matchId),
    ])
      .then(([m, posRows, durSeconds]) => {
        if (cancelled) return;
        setPositionFrames(posRows);
        setDuration(durSeconds);

        // Narrow the loose getMatch return; each branch is independently optional
        // so a half-joined row still produces a renderable rest state.
        const matchRow = (m ?? {}) as {
          scheduled_at?: string | null;
          home_team?: { color?: string | null; managers?: Array<{ preferred_formation?: string | null }> | null; players?: MatchPlayerRow[] | null } | null;
          away_team?: { color?: string | null; managers?: Array<{ preferred_formation?: string | null }> | null; players?: MatchPlayerRow[] | null } | null;
        };
        const homeTeam = matchRow.home_team ?? null;
        const awayTeam = matchRow.away_team ?? null;

        setScheduledAt(matchRow.scheduled_at ?? null);
        setMeta({
          // Manager formation: first manager row (a team has at most one; the
          // join embeds 1:N relations as an array).
          homeFormation: narrowFormation(homeTeam?.managers?.[0]?.preferred_formation),
          awayFormation: narrowFormation(awayTeam?.managers?.[0]?.preferred_formation),
          homeColor:     homeTeam?.color ?? null,
          awayColor:     awayTeam?.color ?? null,
          // Engine-aligned ordering so commentary + viewer name the same XI.
          homePlayers:   pickSquad(homeTeam?.players ?? []).map(toViewerPlayer),
          awayPlayers:   pickSquad(awayTeam?.players ?? []).map(toViewerPlayer),
        });
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[MatchPitchPanel] fetch failed:', err);
      });
    return () => { cancelled = true; };
  }, [db, matchId]);

  // ── Late-arriving frames (open-before-kickoff) ─────────────────────────
  // The worker writes every position frame in a single burst at kickoff, and
  // there is no Realtime channel for `match_positions`.  So a viewer who
  // opened the match BEFORE kickoff got an empty array from the initial fetch
  // and would otherwise watch the choreography fallback for the whole match.
  //
  // The effect's deps don't change as the wall clock crosses kickoff, so the
  // polling loop has to schedule ITSELF to begin at kickoff — we must not poll
  // (or, worse, stop) before then.  Three wall-clock cases when the effect
  // mounts: (a) past the window → nothing to recover, bail; (b) before kickoff
  // → defer the start with a single setTimeout so we don't spin pre-kickoff;
  // (c) already in-window → start immediately.  Once started, poll every 5s
  // until the frames land or the window closes (a legacy match never gets
  // frames, so the window-close guard stops it polling forever).
  useEffect(() => {
    if (positionFrames.length > 0 || !scheduledAt) return undefined;
    const kickoffMs = new Date(scheduledAt).getTime();
    if (Number.isNaN(kickoffMs)) return undefined;
    const windowEndMs = kickoffMs + duration * 1000;

    let cancelled = false;
    let interval:     ReturnType<typeof setInterval> | null = null;
    let startTimeout: ReturnType<typeof setTimeout>  | null = null;
    const stop = () => {
      if (interval     !== null) { clearInterval(interval);  interval = null; }
      if (startTimeout !== null) { clearTimeout(startTimeout); startTimeout = null; }
    };

    const poll = () => {
      // Window closed → give up (covers legacy matches that never get frames).
      if (Date.now() >= windowEndMs) { stop(); return; }
      getMatchPositions(db, matchId)
        .then((rows) => {
          if (cancelled || rows.length === 0) return;
          setPositionFrames(rows);
          stop();
        })
        .catch(() => { /* transient — the next tick retries */ });
    };

    // 5s cadence: the worker lands frames within ~90s of kickoff, so a handful
    // of polls covers it without hammering the table.
    const begin = () => {
      if (cancelled || Date.now() >= windowEndMs) return;
      poll();
      interval = setInterval(poll, 5000);
    };

    const now = Date.now();
    if (now >= windowEndMs) {
      return undefined;                                // window already closed
    } else if (now < kickoffMs) {
      startTimeout = setTimeout(begin, kickoffMs - now); // defer until kickoff
    } else {
      begin();                                         // already in-window
    }
    return () => { cancelled = true; stop(); };
  }, [db, matchId, scheduledAt, duration, positionFrames.length]);

  return (
    <MatchViewer
      frames={positionFrames}
      scheduledAt={scheduledAt}
      durationSeconds={duration}
      // Tactical shape per team (falls back to 4-4-2 via narrowFormation), the
      // starting XI (id + position), and kit colours.  Empty rosters are fine —
      // <MatchViewer> pads with synthetic ids so the pitch stays full.
      homeFormation={meta.homeFormation}
      awayFormation={meta.awayFormation}
      homePlayers={meta.homePlayers}
      awayPlayers={meta.awayPlayers}
      homeColor={meta.homeColor}
      awayColor={meta.awayColor}
      {...(homeTeamName !== undefined && { homeTeamName })}
      {...(awayTeamName !== undefined && { awayTeamName })}
      {...(homeScore    !== undefined && { homeScore })}
      {...(awayScore    !== undefined && { awayScore })}
    />
  );
}
