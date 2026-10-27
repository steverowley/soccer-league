// ── MatchDetail.tsx ─────────────────────────────────────────────────────────
// Single-match page, `/matches/:matchId`. On the design language since the
// group 2 migration (docs/design-language.md): PageShell + PageHeader, then
// numbered sections, and no raw style values (scripts/designTokens.test.ts).
//
// Layout (top to bottom):
//   PageHeader   back link "All matches", eyebrow "Matches", the fixture as
//                the page's h1 ("Earth United v Mars Athletic"), and a meta
//                row: competition, matchday, ground, kickoff, attendance.
//                Every state has exactly one h1: loading and error read
//                "Match", an unknown id reads "Unknown match"
//                (MatchDetail.headings.test.tsx checks each state at runtime).
//   Scoreboard   a Card, toned `live` while the match is revealing: the
//                status cue (red-dot LiveBadge "Live · 37'", then "Full
//                time"; a neutral tag for scheduled and cancelled), crests,
//                names and the score.
//   Meet the booth   dismissible teaching strip, default tone (purple is
//                only for the Architect).
//   I.  The match    two columns, `1fr 380px`, one column under 900 px:
//                left: the 2D pitch (MatchViewer), the booth (commentary
//                feed) and the match record; right: the stake rail
//                (betting strip + WagerWidget).
//   II. Stats        per-player tables, hidden while the match is revealing.
//
// Colour by meaning (spec section 4): red is live (the badge dot, the live
// card border) and red cards; purple is the Architect and the two cosmic
// voices (Balance, Chaos) only; commentators are told apart by name and
// role in the text tones, never by colour.
//
// Data sources (unchanged):
//   - getMatch(db, matchId): joins home_team, away_team, competitions,
//     and match_player_stats (with player meta)
//   - getMatchEvents(db, matchId): full pre-simulated event log
//   - getMatchDurationSeconds(db, matchId): season pacing knob
//   - getMatchEvents polled every 15 s while the paced window is open (the
//     read cache replaced the Realtime stream, docs/read-cache.md)
//   - getMatchPositions(db, matchId): spatial frames for the 2D viewer
//     (the per-match replay file in Storage, frame tables as fallback)
//
// 404 case: matchId returns no row → renders an "Unknown match" page.

import { useEffect, useMemo, useState, type ComponentProps, type CSSProperties } from 'react';
import { Link, useParams } from 'react-router-dom';
import WagerWidget from '../components/WagerWidget';
import { useSupabase, usePublicReadClient } from '../shared/supabase/SupabaseProvider';
import { getActiveWatcherCount } from '../features/auth';
import {
  getMatch,
  computeElapsedGameMinute,
  filterEventsByElapsedMinute,
  getMatchEvents,
  getMatchDurationSeconds,
  DEFAULT_MATCH_DURATION_SECONDS,
  MatchViewer,
  computeLiveScore,
  competitionLabel,
  isRevealing,
  roundLabel,
  type Scoreline,
  type MatchViewerPlayer,
  type MatchEventRow,
} from '../features/match';
import { getMatchPositions, type PositionSnapshot } from '@features/match';
import TeachingStrip from '../components/TeachingStrip';
import {
  Card,
  Crest,
  EmptyState,
  ErrorState,
  LiveBadge,
  LoadingState,
  PageHeader,
  PageShell,
  SectionHeader,
  StatBlock,
  Tag,
} from '../shared/ui';
import { color, glyph, hairline, numeric, space, tone, type } from '../shared/design';
import { useAsyncData, withTimeout, isTimeoutError } from '../shared/hooks/useAsyncData';
import { LIVE_POLL_MS, useVisibleInterval } from '../shared/hooks/useVisibleInterval';

/** Back link shared by every state of the page. */
const BACK = { to: '/matches', label: 'All matches' } as const;

/**
 * The elapsed-minute sentinel LiveCommentary sets once the paced window
 * has closed (the whole match has been revealed).
 */
const REVEAL_DONE_MINUTE = 120;

// ── Loose match row ─────────────────────────────────────────────────────────
// getMatch() returns a deeply-nested join (home_team / away_team / managers /
// players / competitions / match_player_stats) the page reads defensively. The
// page-level state stays `any` (the pre-existing pattern), but the section
// components below take this index-signature alias instead of a fresh `any`
// per component: the same loose-but-named shape, with no net-new `no-explicit-
// any`. Reads are still per-field, so nothing here is type-checked beyond
// "this is an object", but it keeps the lint surface flat.
type MatchRow = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// The exact match-row shape WagerWidget consumes (id / status / team refs),
// derived from its prop type so the cast at the call site stays in sync if the
// widget's contract changes. We never reshape the row: the cast only narrows
// the loose MatchRow to the typed boundary WagerWidget already enforces.
type WagerMatch = ComponentProps<typeof WagerWidget>['match'];

/** What the live feed has revealed so far, reported up to the scoreboard. */
interface RevealedView {
  /** Goals among the events revealed so far. */
  score: Scoreline;
  /** Elapsed game minute; REVEAL_DONE_MINUTE once the window has closed. */
  minute: number;
}

/**
 * Match detail page.
 *
 * Fires a single `getMatch(db, matchId)` fetch on mount through
 * useAsyncData (10 s timeout, retry). Every state renders a PageHeader, so
 * the page always has exactly one h1: the fixture once loaded, "Match"
 * while loading or after an error, "Unknown match" for a bad id.
 *
 * @returns The page.
 */
export default function MatchDetail() {
  const { matchId } = useParams();
  const publicDb = usePublicReadClient();

  // One read for the whole page. useAsyncData turns a hang into a visible
  // timeout after 10 s and gives the error state a retry.
  const matchState = useAsyncData(
    () => (matchId ? getMatch(publicDb, matchId) : Promise.resolve(null)) as Promise<MatchRow | null>,
    [publicDb, matchId],
  );
  const match: MatchRow | null = matchState.status === 'success' ? (matchState.data ?? null) : null;
  // Cosmos-wide watcher count for the live presence line (#382). 0 means
  // no watchers OR a fetch error; both render the same (no line).
  // Refreshed on a 60-second interval so it stays roughly in sync with the
  // 5-min server-side presence window without hammering the DB. 60s is the
  // smallest interval that won't compete with the 90s heartbeat in
  // AuthProvider.
  const [watcherCount, setWatcherCount] = useState<number>(0);

  // Score and minute derived from the events revealed so far, reported up by
  // the live feed (which owns the event log and the wall clock).  While a
  // match is `live` its published `home_score` is deliberately NULL (see
  // logic/liveScore.ts), so this is the only scoreline the board can
  // honestly show mid-reveal.
  const [revealed, setRevealed] = useState<RevealedView | null>(null);

  // Live presence count: fetch immediately + on a 60s interval. The count
  // is cosmos-wide rather than per-match because the `active_watchers_v`
  // view aggregates against last_seen_at; a per-match count would need a
  // separate aggregate. The audit's framing is "the game feels alive",
  // which a cosmos number already conveys.
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      getActiveWatcherCount(publicDb).then((n) => {
        if (!cancelled) setWatcherCount(n);
      });
    };
    tick();
    /** Interval in ms between live-presence polls. 60s sits inside the
        5-min server window so the line never goes stale. */
    const PRESENCE_POLL_MS = 60_000;
    const id = window.setInterval(tick, PRESENCE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [publicDb]);

  if (matchState.status === 'success' && !match) return <UnknownMatch matchId={matchId} />;

  if (!match) {
    // Loading, error or timeout: the header still names the page.
    return (
      <PageShell>
        <PageHeader eyebrow="Matches" title="Match" back={BACK} />
        {matchState.status === 'loading' && <LoadingState label="Loading match" />}
        {(matchState.status === 'error' || matchState.status === 'timeout') && (
          <ErrorState
            what="this match"
            timedOut={matchState.status === 'timeout'}
            onRetry={matchState.retry}
          />
        )}
      </PageShell>
    );
  }

  const status: string = match.status ?? 'scheduled';
  const homeName: string = match.home_team?.name ?? '?';
  const awayName: string = match.away_team?.name ?? '?';

  return (
    <PageShell>
      <PageHeader
        eyebrow="Matches"
        title={`${homeName} v ${awayName}`}
        back={BACK}
        meta={<MatchMeta match={match} />}
      />

      {/* The scoreboard and the booth intro read as one block, so they sit
          closer than the section gap. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: space[24] }}>
        <Scoreboard match={match} watcherCount={watcherCount} revealed={revealed} />

        {/* First-match teaching strip, "Meet the booth" (#379). One-time
            dismissible strip that introduces the three commentators and the
            two cosmic voices: hide the mechanics, but introduce the cast.
            Default tone: it is about the booth, not the Architect. */}
        <TeachingStrip
          storageKey="match_meet_the_booth"
          title="Meet the booth"
          body={
            <>
              <strong style={tone.primary}>Vox</strong> calls the play-by-play.{' '}
              <strong style={tone.primary}>Nexus-7</strong> breaks down what just
              happened. <strong style={tone.primary}>Zara</strong> watches for the
              unusual. The cosmos itself (
              <strong style={tone.primary}>Balance</strong> and{' '}
              <strong style={tone.primary}>Chaos</strong>) speaks only when the match
              deserves it.
            </>
          }
        />
      </div>

      {/* Section I: the match. Pitch, booth and record on the left, the
          stake rail on the right. */}
      <section>
        <SectionHeader index="I" {...theatreCopy(status)} />
        <div
          className="match-main"
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) 380px',
            gap: space[24],
            alignItems: 'start',
          }}
        >
          <div
            className="match-col-l"
            style={{ display: 'flex', flexDirection: 'column', gap: space[24], minWidth: 0 }}
          >
            {status === 'cancelled' ? (
              <EmptyState centred={false}>
                This match was cancelled and will not be played. Any open wagers were voided.
              </EmptyState>
            ) : (
              <MatchTheatre match={match} onRevealed={setRevealed} />
            )}
          </div>

          {/* Sticky stake rail. WagerWidget owns its odds fetch and placement. */}
          <aside
            className="match-rail"
            aria-label="Wager"
            style={{
              position: 'sticky',
              top: space[24],
              display: 'flex',
              flexDirection: 'column',
              gap: space[24],
              minWidth: 0,
            }}
          >
            {/* First-time betting intro strip (#379). Brief reminder that
                stakes lock at placement and the minimum bet is 10 IC; the
                wager widget itself enforces both. */}
            <TeachingStrip
              storageKey="match_betting_intro"
              title="How betting works"
              body={
                <>
                  Pick an outcome (home, draw, or away) and stake at least 10 IC. The odds you
                  see lock the moment you place: the bookie&apos;s later re-pricing won&apos;t
                  claw your potential payout back.
                </>
              }
            />
            {/* The loose MatchRow is the real getMatch() row: it carries the
                id / status / team refs WagerWidget needs at runtime; the cast
                just re-states that to the typed prop boundary. */}
            <WagerWidget match={match as WagerMatch} />
          </aside>
        </div>
      </section>

      {/* Section II: player stats.
          HIDDEN WHILE THE MATCH IS REVEALING.  `match_player_stats` is
          written in full the moment the match is simulated, so these rows
          already hold every goal and card.  Rendering them during the
          reveal would let a spectator scroll past the paced commentary and
          read the result off the table, defeating the whole point of
          withholding the score.  They appear at full time. */}
      {!isRevealing(status) && status !== 'cancelled' && (
        <section>
          <SectionHeader
            index="II"
            label="Stats"
            title="Player performance"
            subtitle="Match stats per player. Ratings are the engine's assessment: read them as the booth would."
          />
          <PlayerStats
            homeTeam={match.home_team}
            awayTeam={match.away_team}
            stats={match.match_player_stats ?? []}
          />
        </section>
      )}

      {/* The `.main` grid collapses to a single column on tablet/mobile; the
          stake rail drops below the theatre and stops sticking. */}
      <style>{`
        @media (max-width: 899px) {
          .match-main { grid-template-columns: minmax(0, 1fr) !important; }
          .match-rail { position: static !important; }
        }
      `}</style>
    </PageShell>
  );
}

/**
 * Section I's label, title and subtitle for the match's state.
 *
 * @param status  The match row's status.
 * @returns       SectionHeader props (without the index).
 */
function theatreCopy(status: string): { label: string; title: string; subtitle: string } {
  if (isRevealing(status)) {
    return {
      label: 'Live',
      title: 'The match',
      subtitle: 'The pitch and the booth follow the match as it is played. Goals reach the scoreboard as they happen.',
    };
  }
  if (status === 'completed') {
    return {
      label: 'Replay',
      title: 'The match',
      subtitle: "The booth's call of the whole match, and every goal, card and substitution on the record.",
    };
  }
  if (status === 'cancelled') {
    return { label: 'Cancelled', title: 'The match', subtitle: 'No ball was kicked.' };
  }
  return {
    label: 'Preview',
    title: 'The match',
    subtitle: 'The teams line up on the pitch. The booth goes live with the first whistle.',
  };
}

/**
 * The header's meta row: competition, matchday, ground, kickoff and (when
 * a real count exists) attendance. Items with no value are left out rather
 * than rendered blank.
 *
 * @param props.match  The match row.
 * @returns            StatBlocks for PageHeader's `meta` slot.
 */
function MatchMeta({ match }: { match: MatchRow }) {
  const competition = competitionLabel(match.competitions?.name);
  const round = roundLabel(match.round);
  const matchday = /^Matchday (\d+)$/.exec(round);
  const ground = matchGroundName(match);
  const kickoff = formatKickoff(match.scheduled_at);
  const attendance = typeof match.attendance === 'number' ? match.attendance : null;
  return (
    <>
      <StatBlock label="Competition" value={competition} />
      {matchday ? (
        <StatBlock label="Matchday" value={matchday[1]} />
      ) : round ? (
        <StatBlock label="Round" value={round} />
      ) : null}
      {ground && <StatBlock label="Ground" value={ground} />}
      {kickoff && <StatBlock label="Kickoff" value={kickoff} />}
      {attendance != null && <StatBlock label="Attendance" value={attendance.toLocaleString()} />}
    </>
  );
}

/**
 * Kickoff as a short local date and time ("Tue 27 Oct, 19:30"), or null.
 *
 * @param iso  The match's scheduled_at.
 * @returns    Display string, or null when missing or invalid.
 */
function formatKickoff(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * The ground a match is played at, or null when nothing is known.
 *
 * `matches.stadium` exists in the schema but no fixture generator writes
 * it, so the page always fell back to "Unknown Ground". The ground is the
 * home side's stadium: its `entities` row (kind 'stadium', joined in
 * getMatch through teams.stadium_entity_id), else teams.home_ground.
 */
export function matchGroundName(match: MatchRow): string | null {
  const pick = (v: unknown): string | null =>
    typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
  return (
    pick(match.stadium) ??
    pick(match.home_team?.stadium?.name) ??
    pick(match.home_team?.home_ground) ??
    null
  );
}

/**
 * Scoreboard: a Card with the status cue, then crest, name and side for
 * each club around the score. Toned `live` (red border) while the match is
 * revealing; the status cue is the red-dot LiveBadge, which turns to "Full
 * time" when the reveal ends. There is no momentum bar: no momentum signal
 * exists in the data, and a made-up bar would fabricate it.
 *
 * @param props.match         The match row.
 * @param props.watcherCount  Cosmos-wide watchers (shown while live).
 * @param props.revealed      Score and minute revealed by the live feed.
 */
function Scoreboard({
  match,
  watcherCount,
  revealed,
}: {
  match: MatchRow;
  watcherCount: number;
  revealed: RevealedView | null;
}) {
  // `matches.status` is authoritative about liveness: the worker holds a
  // match at `live` for its whole real-time reveal window and only
  // publishes `completed` at full time (migration 0081).
  const status = match.status ?? 'scheduled';
  const live = isRevealing(status);
  const revealDone = live && revealed != null && revealed.minute >= REVEAL_DONE_MINUTE;

  // Mid-reveal the published score is NULL by design, so count the goals the
  // spectator has actually seen.  Falling back to `?? 0` on the raw columns
  // would show 0-0 for ten minutes and then snap to the final score.
  const [homeScore, awayScore] = live
    ? (revealed?.score ?? [0, 0])
    : [match.home_score ?? 0, match.away_score ?? 0];

  return (
    <Card
      tone={live && !revealDone ? 'live' : 'default'}
      className="match-board"
      style={{ display: 'flex', flexDirection: 'column', gap: space[24] }}
    >
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <StatusCue status={status} revealed={revealed} />
      </div>

      {/* minmax(0, 1fr): the name columns may shrink below their content
          width, so a long name wraps instead of being clipped (390 px). */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
          alignItems: 'start',
          gap: space[16],
        }}
      >
        <TeamScoreBlock
          side="Home"
          name={match.home_team?.name ?? '?'}
          location={match.home_team?.location ?? ''}
          crestColor={match.home_team?.color ?? null}
        />
        <ScoreDisplay status={status} home={homeScore} away={awayScore} />
        <TeamScoreBlock
          side="Away"
          name={match.away_team?.name ?? '?'}
          location={match.away_team?.location ?? ''}
          crestColor={match.away_team?.color ?? null}
        />
      </div>

      {/* Live presence (#382): only while the match is live, counting
          cosmos-wide active users. Neutral text: live itself is the badge. */}
      {live && watcherCount > 0 && (
        <p style={{ ...type.label, ...tone.secondary, margin: 0, textAlign: 'center' }}>
          <span style={{ ...tone.primary, ...numeric }}>{watcherCount}</span>{' '}
          {watcherCount === 1 ? 'fan' : 'fans'} watching now
        </p>
      )}
    </Card>
  );
}

/**
 * The scoreboard's status cue. Live: the red-dot LiveBadge with the minute
 * ("Live · 37'"), then "Full time" once the reveal has ended. Completed:
 * "Full time". Scheduled and cancelled: a neutral tag.
 *
 * @param props.status    The match row's status.
 * @param props.revealed  Minute revealed by the live feed (live only).
 */
function StatusCue({ status, revealed }: { status: string; revealed: RevealedView | null }) {
  if (isRevealing(status)) {
    const done = revealed != null && revealed.minute >= REVEAL_DONE_MINUTE;
    const minute = revealed != null && revealed.minute > 0 && !done ? revealed.minute : null;
    return <LiveBadge minute={minute} fullTime={done} />;
  }
  if (status === 'completed') return <LiveBadge fullTime />;
  if (status === 'cancelled') return <Tag>Cancelled</Tag>;
  return <Tag>Scheduled</Tag>;
}

/**
 * Centred score. The score in the score type (tabular figures) for live
 * and completed matches; a quiet "v" for scheduled and cancelled ones.
 *
 * @param props.status  The match row's status.
 * @param props.home    Home goals.
 * @param props.away    Away goals.
 */
function ScoreDisplay({ status, home, away }: { status: string; home: number; away: number }) {
  const box: CSSProperties = { paddingTop: space[16], textAlign: 'center', whiteSpace: 'nowrap' };
  if (status === 'scheduled' || status === 'cancelled') {
    return <div style={{ ...type.heading, ...tone.tertiary, ...box }}>v</div>;
  }
  return (
    <div style={{ ...type.score, ...box }}>
      {home} <span style={tone.tertiary}>{glyph.middot}</span> {away}
    </div>
  );
}

/**
 * One club on the scoreboard: crest, name, "Home · location".
 *
 * @param props.side        'Home' or 'Away'.
 * @param props.name        Club name.
 * @param props.location    The club's home world.
 * @param props.crestColor  Club colour for the crest.
 */
function TeamScoreBlock({
  side,
  name,
  location,
  crestColor,
}: {
  side: 'Home' | 'Away';
  name: string;
  location: string;
  crestColor: string | null;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: space[12], minWidth: 0 }}>
      <Crest color={crestColor} size={40} />
      <p
        lang="en"
        style={{
          ...type.subheading,
          margin: 0,
          maxWidth: '100%',
          textAlign: 'center',
          overflowWrap: 'anywhere',
          hyphens: 'auto',
        }}
      >
        {name}
      </p>
      <p style={{ ...type.label, ...tone.secondary, margin: 0, textAlign: 'center' }}>
        {side}
        {location && <> {glyph.middot} {location}</>}
      </p>
    </div>
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

/** Minimal team reference the stats tables read (id for bucketing, name and colour for the header). */
interface TeamRef {
  id?: string | null;
  name?: string | null;
  color?: string | null;
}

/**
 * Player stats section.  Splits the match_player_stats array by team
 * (home vs away based on team_id) and renders each side as its own
 * table, sorted by rating DESC then by goals DESC.
 *
 * @param props.homeTeam  Home team reference (id + name).
 * @param props.awayTeam  Away team reference (id + name).
 * @param props.stats     The flat match_player_stats array for both sides.
 */
function PlayerStats({
  homeTeam,
  awayTeam,
  stats,
}: {
  homeTeam: TeamRef | null;
  awayTeam: TeamRef | null;
  stats: PlayerStatRow[];
}) {
  if (stats.length === 0) {
    return <EmptyState centred={false}>Player stats are not available for this match.</EmptyState>;
  }

  // Bucket by team_id so home / away tables render side-by-side.  The
  // sort is stable (rating DESC → goals DESC) so the best performers
  // surface at the top of each list.
  const sortStats = (a: PlayerStatRow, b: PlayerStatRow) =>
    (b.rating ?? 0) - (a.rating ?? 0) || (b.goals ?? 0) - (a.goals ?? 0);
  const homeStats = stats.filter((s) => s.team_id === homeTeam?.id).sort(sortStats);
  const awayStats = stats.filter((s) => s.team_id === awayTeam?.id).sort(sortStats);

  return (
    <div
      className="isl-stats-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gap: space[24],
      }}
    >
      <StatsTable team={homeTeam} rows={homeStats} />
      <StatsTable team={awayTeam} rows={awayStats} />

      <style>{`
        @media (max-width: 899px) {
          .isl-stats-grid { grid-template-columns: minmax(0, 1fr) !important; }
        }
      `}</style>
    </div>
  );
}

/** Table header cell: label type, secondary tone. */
const statsTh = (align: 'left' | 'right' = 'right'): CSSProperties => ({
  ...type.label,
  ...tone.secondary,
  textAlign: align,
  paddingTop: space[12],
  paddingBottom: space[12],
  paddingLeft: space[8],
  paddingRight: space[8],
});

/** Table body cell: small type, tabular figures. */
const statsTd = (align: 'left' | 'right' = 'right'): CSSProperties => ({
  ...type.small,
  ...numeric,
  textAlign: align,
  paddingTop: space[8],
  paddingBottom: space[8],
  paddingLeft: space[8],
  paddingRight: space[8],
});

/**
 * One club's stats table (spec DataTable styles): label headers, small
 * cells, faint row rules, tabular figures, the club's crest in the header.
 * Columns: Player / G / A / Y / R / Min / Rating.
 *
 * @param props.team  Home or away team reference.
 * @param props.rows  The team's player-stat rows, pre-sorted by rating.
 */
function StatsTable({ team, rows }: { team: TeamRef | null; rows: PlayerStatRow[] }) {
  return (
    <Card padding={0} style={{ minWidth: 0, overflowX: 'auto' }}>
      <header
        style={{
          ...type.subheading,
          display: 'flex',
          alignItems: 'center',
          gap: space[12],
          padding: `${space[16]}px ${space[16]}px`,
          borderBottom: `1px solid ${color.line}`,
          overflowWrap: 'anywhere',
        }}
      >
        <Crest color={team?.color ?? null} size={16} />
        {team?.name ?? '?'}
      </header>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${color.line}` }}>
            <th style={statsTh('left')}>Player</th>
            <th style={statsTh()} title="Goals">G</th>
            <th style={statsTh()} title="Assists">A</th>
            <th style={statsTh()} title="Yellow cards">Y</th>
            <th style={statsTh()} title="Red cards">R</th>
            <th style={statsTh()}>Min</th>
            <th style={statsTh()}>Rating</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id} style={{ borderBottom: `1px solid ${color.lineFaint}` }}>
              <td style={{ ...statsTd('left'), overflowWrap: 'anywhere' }}>
                <Link to={`/players/${s.player_id}`} style={{ ...tone.primary, textDecoration: 'none' }}>
                  {s.players?.name ?? '—'}
                </Link>
              </td>
              <td style={statsTd()}>{s.goals ?? 0}</td>
              <td style={statsTd()}>{s.assists ?? 0}</td>
              <td style={statsTd()}>{s.yellow_cards ?? 0}</td>
              <td style={statsTd()}>{s.red_cards ?? 0}</td>
              <td style={{ ...statsTd(), ...tone.secondary }}>{s.minutes_played ?? 0}</td>
              <td style={{ ...statsTd(), fontWeight: 700 }}>{formatRating(s.rating)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

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
 * Unknown-match page: the page header plus a short message, no router
 * redirect, so a bad URL stays the user's URL.
 *
 * @param props.matchId  The id from the URL.
 */
function UnknownMatch({ matchId }: { matchId?: string | undefined }) {
  return (
    <PageShell>
      <PageHeader eyebrow="Matches" title="Unknown match" back={BACK} />
      <p style={{ ...type.body, ...tone.secondary, margin: 0, maxWidth: '60ch' }}>
        No match is registered under{' '}
        <code
          style={{
            ...tone.primary,
            ...hairline(color.line),
            fontFamily: 'inherit',
            paddingLeft: space[4],
            paddingRight: space[4],
            overflowWrap: 'anywhere',
          }}
        >
          {matchId ?? '—'}
        </code>
        . Try the{' '}
        <Link to="/matches" style={tone.primary}>
          full fixture list
        </Link>{' '}
        to find the result you were after.
      </p>
    </PageShell>
  );
}

// ── Match theatre (left column: pitch + commentary feed + timeline) ──────────
//
// MatchTheatre owns the wall-clock window decision (is the pitch on screen?)
// and threads the SAME `match_events` stream LiveCommentary already holds into
// the "Match record" timeline, so the timeline needs no extra fetch.
//
// The match worker pre-simulates a fixture at its kickoff_at instant, writing
// every notable beat into `match_events` with a monotone (minute, subminute)
// ordering.  LiveCommentary reads that pre-simulated stream and reveals it
// client-side via two complementary mechanisms:
//
//   1. computeElapsedGameMinute(kickoff, now, durationSeconds): pure helper
//      from features/match/logic that maps wall-clock seconds onto the
//      simulated 0–90 minute axis.  A setInterval re-runs the helper once
//      per second so freshly-elapsed events appear without a page refresh.
//
//   2. A poll of getMatchEvents every 15 s (LIVE_POLL_MS) while the paced
//      window is open, so a viewer who opened the page before the worker
//      published the events still gets them.  It reads through the cached
//      proxy (match_events TTL 10 s), so every viewer of a match shares one
//      database query per TTL; it pauses while the tab is hidden.  This
//      replaced a Realtime postgres_changes subscription, which cost the
//      database work per subscriber (docs/read-cache.md, "As built").
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
 * The pitch shows for any match that is revealing (`live` / `in_progress`)
 * or scheduled. The wall-clock pacing-window check is kept as a
 * belt-and-braces fallback for rows finalised by a path other than the
 * worker (e.g. the admin `admin_complete_match` RPC), which can reach
 * `completed` without ever passing through `live`.
 *
 * @param props.match       Full match row from getMatch().
 * @param props.onRevealed  Receives the revealed score and minute.
 */
function MatchTheatre({
  match,
  onRevealed,
}: {
  match: MatchRow;
  onRevealed: (view: RevealedView) => void;
}) {
  const kickoffMs = match.scheduled_at ? new Date(match.scheduled_at).getTime() : null;
  // eslint-disable-next-line react-hooks/purity -- wall-clock read; a stale value only mis-decides the pitch near the window edge and self-corrects on the next render / nav
  const nowMs = Date.now();
  const withinPacingWindow =
    kickoffMs != null &&
    nowMs >= kickoffMs &&
    nowMs < kickoffMs + DEFAULT_MATCH_DURATION_SECONDS * 1000;
  const showPitch = isRevealing(match.status) || match.status === 'scheduled' || withinPacingWindow;

  return (
    <>
      {showPitch &&
        (() => {
          // Pull team names + scores defensively from the (loosely typed) match
          // row so the canvas aria-label reads the scoreline for screen readers.
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

      <LiveCommentary match={match} onRevealed={onRevealed} />
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
 * BOTH the initial `getMatchEvents()` fetch and the live poll
 * pass: that uniformity is what makes `filterEventsByElapsedMinute` correct
 * regardless of which source delivered a given row first.
 *
 * @param existing  The current event list held in React state.
 * @param incoming  Newly arrived events from either the initial fetch or the
 *                  live poll.
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
  return merged.sort((a, b) => a.minute - b.minute || Number(a.subminute) - Number(b.subminute));
}

/**
 * Subset of the matches row this component actually reads.  Declared loosely
 * because `getMatch()` returns the full joined row with many more fields the
 * commentary feed doesn't need.
 */
interface LiveCommentaryMatch {
  id?: string;
  status?: string;
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
 * The live poll only runs while the paced window is open;
 * completed-and-past matches have no further events incoming.
 *
 * @param props.match       Match row from getMatch(): needs id, status, and
 *                          scheduled_at (the kickoff anchor for elapsed math).
 * @param props.onRevealed  Optional: receives the revealed score and the
 *                          elapsed minute whenever either changes.
 */
export function LiveCommentary({
  match,
  onRevealed,
}: {
  match: LiveCommentaryMatch;
  onRevealed?: (view: RevealedView) => void;
}) {
  const publicDb = usePublicReadClient();

  // The "live experience" anchors on wall-clock vs scheduled_at, NOT on the
  // match's row status.  STATUS still gates a few things:
  //   • Cancelled matches never render this section (no events to show).
  //   • Pre-kickoff scheduled matches in the *future* don't render either.
  const status = match?.status ?? 'scheduled';
  const isCancelled = status === 'cancelled';
  const kickoffMs = match?.scheduled_at ? new Date(match.scheduled_at).getTime() : null;
  // eslint-disable-next-line react-hooks/purity -- intentional wall-clock read; re-renders are driven by the per-second elapsedMinute tick below
  const kickoffPassed = kickoffMs != null && kickoffMs <= Date.now();

  const showSection = !isCancelled && (kickoffPassed || status === 'completed');

  const [events, setEvents] = useState<MatchEventRow[]>([]);
  const [duration, setDuration] = useState<number>(DEFAULT_MATCH_DURATION_SECONDS);
  const [elapsedMinute, setElapsedMinute] = useState<number>(0);
  const [loaded, setLoaded] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  // Bumped by the error state's retry button to re-run the initial fetch.
  const [attempt, setAttempt] = useState(0);

  // Derived "is the viewer still inside the paced window?": true while
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
    // withTimeout: a hung read becomes a visible error after 10 s.
    withTimeout(Promise.all([getMatchEvents(publicDb, match.id), getMatchDurationSeconds(publicDb, match.id)]))
      .then(([evRows, durSeconds]) => {
        if (cancelled) return;
        // Merge against current state (not []) so a polled row that landed
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
    return () => {
      cancelled = true;
    };
  }, [publicDb, match?.id, showSection, attempt]);

  // ── Elapsed-minute clock ──────────────────────────────────────────────────
  useEffect(() => {
    const kickoff = match?.scheduled_at;
    if (!kickoff) {
      if (status === 'completed') setElapsedMinute(REVEAL_DONE_MINUTE);
      return undefined;
    }

    const kickoffAtMs = new Date(kickoff).getTime();
    const endAtMs = kickoffAtMs + duration * 1000;

    if (Date.now() >= endAtMs) {
      setElapsedMinute(REVEAL_DONE_MINUTE);
      return undefined;
    }

    // SELF-TERMINATING INTERVAL: the tick self-clears the moment wall-clock
    // crosses endAtMs, emits one final setElapsedMinute(REVEAL_DONE_MINUTE)
    // to flip the section into its replay state, and then returns.
    let interval: ReturnType<typeof setInterval> | null = null;
    const tick = (): void => {
      if (Date.now() >= endAtMs) {
        setElapsedMinute(REVEAL_DONE_MINUTE);
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

  // ── Live poll (whenever new events may still arrive) ──────────────────────
  // Polls the cached read proxy instead of holding a Realtime channel: the
  // events of a match are published in one batch, so a 15 s poll is plenty,
  // and it stops while the tab is hidden (useVisibleInterval).
  const liveMatchId = showSection && livePacingWindowOpen ? match?.id ?? null : null;
  useVisibleInterval(
    () => {
      if (!liveMatchId) return;
      getMatchEvents(publicDb, liveMatchId)
        .then((rows) => {
          if (rows.length > 0) setEvents((prev) => mergeAndSortEvents(prev, rows));
        })
        .catch(() => {
          /* transient: the next poll retries */
        });
    },
    LIVE_POLL_MS,
    liveMatchId !== null,
  );

  // ── Visible-event derivation ─────────────────────────────────────────────
  const visibleEvents = useMemo(
    () => filterEventsByElapsedMinute(events, elapsedMinute),
    [events, elapsedMinute],
  );

  // ── Report the revealed scoreline and minute up to the scoreboard ─────────
  // This component owns the event log and the wall clock, so it is the only
  // place that knows what the spectator has actually seen.  The scoreboard
  // sits above it in the tree and cannot read `home_score` while a match is
  // `live` (it is NULL by design until full time), so it receives the count
  // from here.
  const revealedScore = useMemo(() => computeLiveScore(visibleEvents), [visibleEvents]);
  useEffect(() => {
    onRevealed?.({ score: revealedScore, minute: elapsedMinute });
  }, [onRevealed, revealedScore, elapsedMinute]);

  if (!showSection) return null;

  // ── Feed copy ─────────────────────────────────────────────────────────────
  // "Live Feed" / "The Replay" are kept: the commentary tests assert on them.
  const heading = livePacingWindowOpen
    ? {
        empty: 'The void is silent. Awaiting the first whistle…',
        stateTag: 'Live Feed',
      }
    : {
        empty: 'No events were recorded for this match.',
        stateTag: 'The Replay',
      };

  return (
    <>
      {/* COMMENTARY FEED. */}
      <Card>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: space[16],
            flexWrap: 'wrap',
          }}
        >
          <h3 style={{ ...type.subheading, margin: 0 }}>The booth</h3>
          <span style={{ ...type.label, ...tone.secondary }}>
            Vox {glyph.middot} Nexus-7 {glyph.middot} Zara
          </span>
        </div>

        {/* State line: "Live Feed" plus the minute, or "The Replay". Neutral
            text: the scoreboard's LiveBadge is the page's live cue. */}
        <p style={{ ...type.label, ...tone.secondary, ...numeric, margin: 0, marginTop: space[8], marginBottom: space[16] }}>
          {heading.stateTag}
          {livePacingWindowOpen && loaded && (
            <>
              {' '}{glyph.middot} Minute {Math.min(elapsedMinute, 90)}
              {elapsedMinute > 90 && <> + {elapsedMinute - 90}</>}
            </>
          )}
        </p>

        {loadError != null && (
          <ErrorState
            bare
            what="the commentary"
            timedOut={isTimeoutError(loadError)}
            onRetry={() => setAttempt((n) => n + 1)}
          />
        )}

        {!loadError && !loaded && <LoadingState label="Tuning into the broadcast" style={{ padding: 0 }} />}

        {!loadError && loaded && visibleEvents.length === 0 && (
          <p style={{ ...type.small, ...tone.secondary, fontStyle: 'italic', margin: 0 }}>
            {heading.empty}
          </p>
        )}

        {!loadError && loaded && visibleEvents.length > 0 && (
          <CommentaryFeed events={visibleEvents} />
        )}
      </Card>

      {/* MATCH RECORD TIMELINE: derived from the same paced events the feed
          shows, so it never spoils beats the viewer hasn't reached and
          needs no extra fetch. */}
      {!loadError && loaded && <MatchTimeline events={visibleEvents} />}
    </>
  );
}

/**
 * Vertical feed of pre-simulated match events, rendered most-recent-first.
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
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: space[24],
        maxHeight: 432,
        overflowY: 'auto',
        paddingRight: space[8],
      }}
    >
      {ordered.map((ev) => (
        <CommentaryRow key={ev.id} event={ev} />
      ))}
    </div>
  );
}

// ── Commentator voices ──────────────────────────────────────────────────────
// The match worker attributes each commentary line to one of the three
// commentators (`payload.voice`), generated deterministically rather than by
// a model. The design language tells them apart by name and role, never by
// colour (spec section 4): the old gold and cyan accents are retired, and
// every commentator line uses the text tones.
/** A booth voice: the byline name and the role beside it. */
export interface BoothVoice {
  name: string;
  role: string;
}

const VOICES: Record<string, BoothVoice> = {
  vox: { name: 'Captain Vox', role: 'Play-by-play' },
  nexus: { name: 'Nexus-7', role: 'AI analyst' },
  zara: { name: 'Zara Bloom', role: 'Colour analyst' },
};

// The two cosmic voices. Since the design language they are bylined like
// the booth (name and role) and set in the Architect tone, as the spec and
// its specimen show ("Chaos · Cosmic voice"). Colour alone used to tell
// them apart (slate and amber); with both in the one Architect purple, the
// name is what separates them, and the "Meet the booth" strip already
// introduces both by name.
const COSMIC_VOICES: Record<string, BoothVoice> = {
  balance: { name: 'Balance', role: 'Cosmic voice' },
  chaos: { name: 'Chaos', role: 'Cosmic voice' },
};

/**
 * The cosmic voice (Balance or Chaos) behind this row, when it is one.
 *
 * @param event  A match_events row.
 * @returns      Name and role, or null for every other row.
 */
export function cosmicVoice(event: MatchEventRow): BoothVoice | null {
  if (event.type !== 'cosmic_voice') return null;
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const key = typeof payload['voice'] === 'string' ? payload['voice'] : null;
  return key ? (COSMIC_VOICES[key] ?? null) : null;
}

/**
 * The commentator who spoke this line, when the worker attributed one.
 *
 * @param event  A match_events row.
 * @returns      Name and role, or null for an unvoiced or unknown voice.
 */
export function eventVoice(event: MatchEventRow): BoothVoice | null {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const key = typeof payload['voice'] === 'string' ? payload['voice'] : null;
  return key ? (VOICES[key] ?? null) : null;
}

/**
 * Single event entry in the commentary feed.
 *
 * A row with a 1 px left rule: a byline (name, role and minute in label
 * type) over the line itself. Commentator lines are quotes: italic body
 * type, sentence case, in curly quotes, with a neutral rule. The Architect
 * and the cosmic voices take the Architect tone on the rule and the byline
 * so the cosmic interference is visible without explaining the mechanic;
 * their words stay in the primary text tone for legibility.
 *
 * @param props.event  One row from match_events.  Payload is jsonb so we
 *                     defensively destructure.
 */
function CommentaryRow({ event }: { event: MatchEventRow }) {
  const text = eventProse(event) ?? prettifyEventType(event.type);
  const isArchitect = isArchitectEvent(event);
  const cosmic = isArchitect ? null : cosmicVoice(event);
  const voice = isArchitect || cosmic ? null : eventVoice(event);
  const role = isArchitect ? 'Intervention' : (cosmic?.role ?? voice?.role ?? null);
  const cosmicTone = isArchitect || cosmic != null;
  const isQuote = !cosmicTone && event.type !== 'mvp';

  return (
    <div
      data-voice-tone={cosmicTone ? 'architect' : 'text'}
      style={{
        borderLeftWidth: 1,
        borderLeftStyle: 'solid',
        borderLeftColor: cosmicTone ? color.architect : color.line,
        paddingLeft: space[16],
        display: 'flex',
        flexDirection: 'column',
        gap: space[8],
      }}
    >
      <div style={{ ...type.label, display: 'flex', gap: space[8], alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ color: cosmicTone ? color.architect : color.text }}>{eventHeading(event)}</span>
        {role && (
          <span style={tone.tertiary}>
            {glyph.middot} {role}
          </span>
        )}
        <span style={{ ...tone.tertiary, ...numeric, marginLeft: 'auto' }}>
          {event.minute}
          {event.minute > 90 ? '+' : "'"}
        </span>
      </div>
      <p
        style={{
          ...type.body,
          ...tone.primary,
          margin: 0,
          fontStyle: isQuote ? 'italic' : 'normal',
          fontWeight: event.type === 'mvp' ? 700 : 400,
        }}
      >
        {isQuote ? `“${text}”` : text}
      </p>
    </div>
  );
}

// ── Match record timeline ────────────────────────────────────────────────────

/** Per-row classification for the timeline. Drives glyph + colour. */
type TimelineKind = 'goal' | 'card' | 'arch' | 'other';

/**
 * Glyphs per kind:
 *   goal ▲  card ■  architect ◆  other ·
 */
const TIMELINE_GLYPH: Record<TimelineKind, string> = {
  goal: '▲',
  card: '■',
  arch: '◆',
  other: '·',
};

/**
 * True when an event is an Architect beat: either a first-class
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
    payload.architectForced === true ||
    payload.architectConjured === true ||
    payload.architectStolen === true ||
    payload.architectEcho === true
  );
}

/**
 * The human prose for an event row, or null when it carries none.  Booth events
 * keep their line in `payload.commentary`; Architect-interference beats keep
 * theirs in `payload.proclamation`: surface whichever is present so the
 * cosmos's own words reach the feed instead of a bare type label (#570).
 */
export function eventProse(event: MatchEventRow): string | null {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  // The worker's full-time 'mvp' event carries only the player's name.
  if (event.type === 'mvp') {
    return typeof payload.player === 'string' && payload.player.length > 0 ? payload.player : null;
  }
  if (typeof payload.commentary === 'string' && payload.commentary.length > 0)
    return payload.commentary;
  if (typeof payload.proclamation === 'string' && payload.proclamation.length > 0)
    return payload.proclamation;
  return null;
}

/**
 * Heading label for an event row.  Architect beats read as the cast name,
 * "The Architect", never the interference mechanic, matching the /news feed's
 * treatment and preserving the mystery. Cosmic voices and commentators are
 * bylined by name.
 */
export function eventHeading(event: MatchEventRow): string {
  if (event.type === 'architect_interference') return 'The Architect';
  // The full-time award. Was rendered as the raw type label "Mvp." at 91'.
  if (event.type === 'mvp') return 'Player of the Match';
  const cosmic = cosmicVoice(event);
  if (cosmic) return cosmic.name;
  // A voiced line is bylined by whoever said it. Falling through to the event
  // type here would label a Captain Vox goal call "Goal", which tells the fan
  // nothing they cannot already see on the scoreboard.
  const voice = eventVoice(event);
  if (voice) return voice.name;
  return prettifyEventType(event.type);
}

/**
 * Classify one `match_events` row into a timeline kind.  Priority:
 * architect > goal > card > other: a cosmic-touched goal is more narratively
 * significant than an ordinary goal, and purple is the Architect's cue.
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
    typeof payload.cardType === 'string' || /card|yellow|red|booking|sending/i.test(event.type);
  if (isCard) return 'card';
  return 'other';
}

/**
 * True when a card event is a red card (a sending-off), so its glyph takes
 * the red the spec allows for red cards; any other card is yellow.
 */
function isRedCard(event: MatchEventRow): boolean {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  if (typeof payload.cardType === 'string') return payload.cardType === 'red';
  return /red|sending/i.test(event.type);
}

/**
 * "Match record" timeline.  One row per notable event in `48px 24px 1fr`
 * (minute / glyph / description), derived from the SAME paced events the
 * commentary feed shows, so it stays a real record and never spoils a beat
 * the viewer hasn't reached.  Glyph colours by meaning: goals success,
 * yellow cards the card yellow, red cards red, Architect beats purple,
 * everything else tertiary.
 *
 * @param props.events  Visible (paced) events, chronological.
 */
function MatchTimeline({ events }: { events: MatchEventRow[] }) {
  return (
    <Card>
      <h3 style={{ ...type.subheading, margin: 0, marginBottom: space[16] }}>Match record</h3>
      {events.length === 0 ? (
        <p style={{ ...type.small, ...tone.secondary, fontStyle: 'italic', margin: 0 }}>
          No beats recorded yet.
        </p>
      ) : (
        events.map((ev, idx) => (
          <TimelineRow key={ev.id} event={ev} last={idx === events.length - 1} />
        ))
      )}
    </Card>
  );
}

/**
 * One timeline row: minute · glyph · description.  Description leads with a
 * bold heading (byline or event label), then the commentary text.
 *
 * @param props.event  The event row.
 * @param props.last   True for the final row (drops the bottom rule).
 */
function TimelineRow({ event, last }: { event: MatchEventRow; last: boolean }) {
  const kind = classifyTimelineEvent(event);
  const text = eventProse(event) ?? '';

  const isArch = kind === 'arch';
  const glyphColour =
    kind === 'goal' ? color.success
      : kind === 'card' ? (isRedCard(event) ? color.live : color.cardYellow)
        : isArch ? color.architect
          : color.textTertiary;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '48px 24px minmax(0, 1fr)',
        gap: space[12],
        alignItems: 'baseline',
        paddingTop: space[8],
        paddingBottom: space[8],
        borderBottom: last ? 0 : `1px solid ${color.lineFaint}`,
      }}
    >
      <span style={{ ...type.small, ...numeric, fontWeight: 700 }}>
        {event.minute}
        {event.minute > 90 ? '+' : "'"}
      </span>
      <span aria-hidden="true" style={{ ...type.small, fontWeight: 700, textAlign: 'center', color: glyphColour }}>
        {TIMELINE_GLYPH[kind]}
      </span>
      <span style={{ ...type.small, ...tone.primary, overflowWrap: 'anywhere' }}>
        <b style={{ fontWeight: 700, color: isArch ? color.architect : color.text }}>{eventHeading(event)}.</b>
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
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
}

// ── MatchPitchPanel ─────────────────────────────────────────────────────────
// Fetches a single match's metadata + spatial position frames and feeds them to
// the canvas <MatchViewer>.  It owns NO event subscription: the viewer is
// position-driven (the replay file holds every player + ball position), so the
// play-by-play feed remains LiveCommentary's job.

/**
 * One player row from getMatch's nested `teams.players` join.  Narrow on purpose
 * so the loose (Json-nested) `getMatch` return narrows cleanly at this seam:
 * only the viewer's needs (id + position) and the engine-aligned ordering keys
 * (starter, overall_rating) are modelled.
 */
interface MatchPlayerRow {
  id: string;
  position: string;
  starter: boolean;
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
 * substitute once they come on.  Teams with fewer than 11 return what they have:
 * the viewer pads missing slots with synthetic ids so the pitch is full.
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
  homeScore?: number;
  awayScore?: number;
}) {
  const db = useSupabase();
  const publicDb = usePublicReadClient();
  /**
   * Match metadata that drives the viewer: per-side formation, kit colour (the
   * sprite shirt accent), and the starting XI (id + position).  One state slot
   * avoids multiple ping-pongs.
   */
  const [meta, setMeta] = useState<{
    homeFormation: SupportedFormation;
    awayFormation: SupportedFormation;
    homeColor: string | null;
    awayColor: string | null;
    homePlayers: MatchViewerPlayer[];
    awayPlayers: MatchViewerPlayer[];
  }>({
    homeFormation: '4-4-2',
    awayFormation: '4-4-2',
    homeColor: null,
    awayColor: null,
    homePlayers: [],
    awayPlayers: [],
  });

  // ── Spatial position frames + pacing ───────────────────────────────────────
  // Pre-loaded from the match's replay file (frame tables as a fallback);
  // empty until the worker has simulated the match (or for a legacy match
  // that never gets frames).  `scheduledAt` is the real-time pacing anchor and
  // `duration` the season window: together they map wall-clock time onto the
  // 90-minute replay, the same mapping the feed uses.
  const [positionFrames, setPositionFrames] = useState<PositionSnapshot[]>([]);
  const [scheduledAt, setScheduledAt] = useState<string | null>(null);
  const [duration, setDuration] = useState<number>(DEFAULT_MATCH_DURATION_SECONDS);

  // ── Initial fetch ─────────────────────────────────────────────────────────
  // Match row (formation + roster + colour), position snapshots, and the season
  // pacing knob in parallel.  Errors are logged + swallowed: the formation rest
  // state is a usable fallback whenever anything is missing.
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard async data-load pattern: clear stale frames before re-fetching for the new matchId
    setPositionFrames([]);
    setScheduledAt(null);
    Promise.all([
      getMatch(publicDb, matchId),
      getMatchPositions(db, matchId),
      getMatchDurationSeconds(publicDb, matchId),
    ])
      .then(([m, posRows, durSeconds]) => {
        if (cancelled) return;
        setPositionFrames(posRows);
        setDuration(durSeconds);

        // Narrow the loose getMatch return; each branch is independently optional
        // so a half-joined row still produces a renderable rest state.
        const matchRow = (m ?? {}) as {
          scheduled_at?: string | null;
          home_team?: {
            color?: string | null;
            managers?: Array<{ preferred_formation?: string | null }> | null;
            players?: MatchPlayerRow[] | null;
          } | null;
          away_team?: {
            color?: string | null;
            managers?: Array<{ preferred_formation?: string | null }> | null;
            players?: MatchPlayerRow[] | null;
          } | null;
        };
        const homeTeam = matchRow.home_team ?? null;
        const awayTeam = matchRow.away_team ?? null;

        setScheduledAt(matchRow.scheduled_at ?? null);
        setMeta({
          // Manager formation: first manager row (a team has at most one; the
          // join embeds 1:N relations as an array).
          homeFormation: narrowFormation(homeTeam?.managers?.[0]?.preferred_formation),
          awayFormation: narrowFormation(awayTeam?.managers?.[0]?.preferred_formation),
          homeColor: homeTeam?.color ?? null,
          awayColor: awayTeam?.color ?? null,
          // Engine-aligned ordering so commentary + viewer name the same XI.
          homePlayers: pickSquad(homeTeam?.players ?? []).map(toViewerPlayer),
          awayPlayers: pickSquad(awayTeam?.players ?? []).map(toViewerPlayer),
        });
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[MatchPitchPanel] fetch failed:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [publicDb, db, matchId]);

  // ── Late-arriving frames (open-before-kickoff) ─────────────────────────
  // The worker publishes the replay at kickoff, and there is no Realtime
  // channel for it.  So a viewer who opened the match BEFORE kickoff got an
  // empty array from the initial fetch and would otherwise watch the
  // formation rest state for the whole match.
  //
  // The effect's deps don't change as the wall clock crosses kickoff, so the
  // polling loop has to schedule ITSELF to begin at kickoff: we must not poll
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
    let interval: ReturnType<typeof setInterval> | null = null;
    let startTimeout: ReturnType<typeof setTimeout> | null = null;
    const stop = () => {
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
      if (startTimeout !== null) {
        clearTimeout(startTimeout);
        startTimeout = null;
      }
    };

    const poll = () => {
      // Window closed → give up (covers legacy matches that never get frames).
      if (Date.now() >= windowEndMs) {
        stop();
        return;
      }
      getMatchPositions(db, matchId)
        .then((rows) => {
          if (cancelled || rows.length === 0) return;
          setPositionFrames(rows);
          stop();
        })
        .catch(() => {
          /* transient: the next tick retries */
        });
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
      return undefined; // window already closed
    } else if (now < kickoffMs) {
      startTimeout = setTimeout(begin, kickoffMs - now); // defer until kickoff
    } else {
      begin(); // already in-window
    }
    return () => {
      cancelled = true;
      stop();
    };
  }, [db, matchId, scheduledAt, duration, positionFrames.length]);

  return (
    <MatchViewer
      frames={positionFrames}
      scheduledAt={scheduledAt}
      durationSeconds={duration}
      // Tactical shape per team (falls back to 4-4-2 via narrowFormation), the
      // starting XI (id + position), and kit colours.  Empty rosters are fine:
      // <MatchViewer> pads with synthetic ids so the pitch stays full.
      homeFormation={meta.homeFormation}
      awayFormation={meta.awayFormation}
      homePlayers={meta.homePlayers}
      awayPlayers={meta.awayPlayers}
      homeColor={meta.homeColor}
      awayColor={meta.awayColor}
      {...(homeTeamName !== undefined && { homeTeamName })}
      {...(awayTeamName !== undefined && { awayTeamName })}
      {...(homeScore !== undefined && { homeScore })}
      {...(awayScore !== undefined && { awayScore })}
    />
  );
}
