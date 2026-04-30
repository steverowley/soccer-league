// ── features/match/ui/MatchLivePage.tsx ──────────────────────────────────────
// The live match viewer page (Package 11).  Mounted at /matches/:matchId/live.
//
// HOW IT REVEALS A MATCH
// ──────────────────────
// On page mount we fetch:
//   1. The match row + both team metadata blocks (LiveMatchRow).
//   2. The full pre-simulated event log (match_events).
//   3. The season's match_duration_seconds knob (how long to take to reveal).
//
// We also subscribe to Realtime INSERTs on match_events so a viewer who
// loads the page *while the worker is still writing* picks up new rows
// without polling.  Late-joiners are handled implicitly: the initial
// fetch returns whatever is in the DB so far; Realtime fills in the rest.
//
// A 1-second setInterval ticks `now`, which drives a re-render that
// recomputes elapsedGameMinute via computeElapsedGameMinute() and filters
// the events with minute ≤ elapsedGameMinute.  The score is derived from
// the filtered events (counting goals scored by each team), so the
// scoreline appears to climb naturally as goals are revealed.
//
// CSS FADE-IN
//   Each event row gets a `.match-live__event--fade-in` class that
//   triggers a 400 ms opacity/transform transition.  The class is applied
//   based on the row's React `key` mounting, so already-shown rows don't
//   re-animate on every tick.

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useSupabase } from '@shared/supabase/SupabaseProvider';
import { useAuth } from '@features/auth';
import { getUserWagerForMatch } from '@features/betting';
import type { Wager } from '@features/betting';
import {
  computeElapsedGameMinute,
  filterEventsByElapsedMinute,
} from '../logic/elapsedMinute';
import {
  getLiveMatch,
  getMatchEvents,
  getMatchDurationSeconds,
  subscribeToMatchEvents,
  DEFAULT_MATCH_DURATION_SECONDS,
  type MatchEventRow,
  type LiveMatchRow,
} from '../api/matchEvents';

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Wall-clock tick interval, in milliseconds.  1 second is fine-grained enough
 * that game-minute transitions feel instantaneous (at the production duration
 * of 600 s real / 90 game minutes ≈ 6.7 s per game minute).  Lowering it
 * further gives no perceptible benefit but increases re-render churn.
 */
const TICK_INTERVAL_MS = 1_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Tally goals from a list of revealed events.  Each event's payload may
 * carry an `isGoal` flag plus a `team` short_name; we attribute it to
 * home or away by comparing the team string to the match's team short_names.
 *
 * @param events       Events visible to the viewer right now (post-filter).
 * @param homeShort    home_team.short_name from the match row.
 * @param awayShort    away_team.short_name from the match row.
 * @returns            [home, away] running goal tally.
 */
function tallyScore(
  events: MatchEventRow[],
  homeShort: string | null,
  awayShort: string | null,
): [number, number] {
  let home = 0;
  let away = 0;
  for (const ev of events) {
    const payload = ev.payload as Record<string, unknown> | null;
    if (!payload || !payload['isGoal']) continue;
    const team = payload['team'] as string | undefined;
    if (team === homeShort) home++;
    else if (team === awayShort) away++;
  }
  return [home, away];
}

/**
 * Render-friendly label for a TeamChoice in the context of this match. We
 * resolve `'home'` / `'away'` to the actual team name so a reader doesn't
 * have to mentally cross-reference; `'draw'` is a fixed string. Falls back
 * to the raw choice when names aren't available (defensive, should not fire
 * because the live page only renders after the match row has loaded).
 *
 * @param choice    The TeamChoice the user bet on.
 * @param homeName  Friendly name of the home team.
 * @param awayName  Friendly name of the away team.
 * @returns         Display string suitable for a status sentence.
 */
function wagerChoiceLabel(
  choice:   'home' | 'draw' | 'away',
  homeName: string | undefined,
  awayName: string | undefined,
): string {
  if (choice === 'home') return homeName ?? 'home win';
  if (choice === 'away') return awayName ?? 'away win';
  return 'a draw';
}

/**
 * Pick a human-readable line from an event's payload.  The engine writes
 * `commentary` (free-form sentence) for most events and a `text` field for
 * lower-fidelity ones.  Falling back to the event type ensures we never
 * show an empty row.
 */
function eventLine(ev: MatchEventRow): string {
  const payload = ev.payload as Record<string, unknown> | null;
  const commentary = payload?.['commentary'];
  const text       = payload?.['text'];
  if (typeof commentary === 'string' && commentary.length > 0) return commentary;
  if (typeof text === 'string' && text.length > 0)             return text;
  return ev.type;
}

// ── Page component ────────────────────────────────────────────────────────────

/**
 * Live match viewer page.  Reads `:matchId` from the URL and renders the
 * pre-simulated event stream, filtered by wall-clock elapsed time.
 *
 * Three render branches based on data state:
 *   • Loading:  initial fetch in flight, blank skeleton.
 *   • Missing:  match not found — show a helpful link back.
 *   • Loaded:   scoreline + event feed + status badge.
 */
export function MatchLivePage(): JSX.Element {
  const { matchId } = useParams<{ matchId: string }>();
  const db          = useSupabase();
  const { user }    = useAuth();

  const [match,            setMatch]            = useState<LiveMatchRow | null>(null);
  const [events,           setEvents]           = useState<MatchEventRow[]>([]);
  const [durationSeconds,  setDurationSeconds]  = useState(DEFAULT_MATCH_DURATION_SECONDS);
  const [loading,          setLoading]          = useState(true);
  const [now,              setNow]              = useState<Date>(() => new Date());
  // User's own wager on this match. null = not loaded / no bet placed; the
  // shape carries everything we need (status, payout, choice, stake) so the
  // status line can derive its content without a second query.
  const [wager,            setWager]            = useState<Wager | null>(null);

  // ── Initial data fetch ─────────────────────────────────────────────────────
  // Fires once on mount (and again if the route's :matchId changes).  All
  // three queries run in parallel since they're independent — saves a round
  // trip on the first paint.
  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;

    (async () => {
      const [matchRow, evs, dur] = await Promise.all([
        getLiveMatch(db, matchId),
        getMatchEvents(db, matchId),
        getMatchDurationSeconds(db, matchId),
      ]);
      if (cancelled) return;
      setMatch(matchRow);
      setEvents(evs);
      setDurationSeconds(dur);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [db, matchId]);

  // ── Realtime subscription ─────────────────────────────────────────────────
  // Append new events as the worker writes them.  Deduping on id guards
  // against the rare double-delivery a Realtime reconnect can cause.
  useEffect(() => {
    if (!matchId) return;
    const unsub = subscribeToMatchEvents(db, matchId, (ev) => {
      setEvents((prev) => {
        if (prev.some((p) => p.id === ev.id)) return prev;
        // Insert in sorted position so the feed stays ordered without a
        // post-fetch sort.  match_events arrives in chronological order,
        // but a slow client could interleave realtime + initial-fetch.
        const next = [...prev, ev];
        next.sort((a, b) =>
          a.minute - b.minute || a.subminute - b.subminute,
        );
        return next;
      });
    });
    return unsub;
  }, [db, matchId]);

  // ── Wall-clock tick ────────────────────────────────────────────────────────
  // setInterval is fine here — drift over the 10-minute duration is well
  // under one game minute, which is invisible at this temporal resolution.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // ── User's wager (Package 12) ─────────────────────────────────────────────
  // Fetches the viewer's wager on mount, then re-fetches when the match
  // completes so the panel transitions from "your bet is open" to "you won
  // / lost / void" without requiring a manual page refresh.
  //
  // The dependency on `match?.status` is what triggers the post-settlement
  // refetch: the worker flips status='completed' → settleMatchWagers updates
  // the wager row → the next page interaction (or the match becoming
  // 'completed' via Realtime in a future iteration) will pick up the new
  // payout. Today the status flip arrives only on a fresh getLiveMatch
  // call, but wiring the dep keeps us forward-compatible with a future
  // status subscription.
  useEffect(() => {
    // Anonymous viewers and missing route params skip the fetch entirely.
    // We don't reset `wager` synchronously here because the render path
    // already gates on `user` — keeping setState out of the effect body
    // satisfies the React Compiler / react-hooks lint rule.
    if (!matchId || !user) return;
    let cancelled = false;
    (async () => {
      const w = await getUserWagerForMatch(db, user.id, matchId);
      if (!cancelled) setWager(w);
    })();
    return () => { cancelled = true; };
  }, [db, matchId, user, match?.status]);

  // ── Derived state ──────────────────────────────────────────────────────────
  // Plain expressions — re-evaluating these once per second is cheap and the
  // React Compiler handles memoization automatically when stable.
  const elapsedMinute = match?.scheduled_at
    ? computeElapsedGameMinute(match.scheduled_at, now, durationSeconds)
    : 0;

  const visibleEvents = filterEventsByElapsedMinute(events, elapsedMinute);

  const [homeScore, awayScore] = tallyScore(
    visibleEvents,
    match?.home_team?.short_name ?? null,
    match?.away_team?.short_name ?? null,
  );

  // ── Render branches ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="match-live" data-testid="match-live-loading">
        <p>Loading match…</p>
      </div>
    );
  }

  if (!match) {
    return (
      <div className="match-live" data-testid="match-live-missing">
        <p>Match not found.</p>
        <Link to="/matches">← All matches</Link>
      </div>
    );
  }

  // Cap displayed minute at 90 in the meta — events past 90 still render but
  // we don't want a clock reading "minute 137".
  const displayMinute = Math.min(elapsedMinute, 90);

  // Pre-kickoff banner is the most user-friendly state for a match the
  // viewer loaded too early (worker hasn't written yet, or the user clicked
  // the link 5 minutes before kickoff).
  const preKickoff = elapsedMinute === 0 && visibleEvents.length === 0;

  return (
    <div className="match-live" data-testid="match-live">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="match-live__header">
        <span className="match-live__team match-live__team--home">{match.home_team.name}</span>
        <span className="match-live__score" data-testid="match-live-score">
          {homeScore} – {awayScore}
        </span>
        <span className="match-live__team match-live__team--away">{match.away_team.name}</span>
      </header>

      {/* ── Status line ────────────────────────────────────────────────── */}
      <p className="match-live__status" data-testid="match-live-status">
        {preKickoff
          ? 'Awaiting kickoff…'
          : match.status === 'completed' && elapsedMinute >= 90
            ? 'Full time'
            : `Minute ${displayMinute}`}
      </p>

      {/* ── Your wager panel (Package 12) ──────────────────────────────── */}
      {/* Only renders when the viewer has a wager on this match. Three
          visible states:
            • status='open'  → "You bet X on Y" (still pending settlement).
            • status='won'   → "You won — payout Z credits".
            • status='lost'  → "You lost X credits."
            • status='void'  → "Wager voided — stake refunded."
          The settlement-listener / worker pipeline keeps the row in sync;
          the useEffect above re-fetches when match.status flips to picks
          up the resolved row. */}
      {user && wager && (
        <p className="match-live__wager" data-testid="match-live-wager">
          {wager.status === 'open' && (
            <>
              You bet <strong>{wager.stake}</strong> credits on{' '}
              <strong>{wagerChoiceLabel(wager.team_choice, match.home_team?.name, match.away_team?.name)}</strong>
              {' '}@ {wager.odds_snapshot.toFixed(2)}.
            </>
          )}
          {wager.status === 'won' && (
            <>
              You won — payout <strong>{wager.payout ?? 0}</strong> credits.
            </>
          )}
          {wager.status === 'lost' && (
            <>
              You lost <strong>{wager.stake}</strong> credits.
            </>
          )}
          {wager.status === 'void' && (
            <>
              Wager voided — stake refunded.
            </>
          )}
        </p>
      )}

      {/* ── Event feed ─────────────────────────────────────────────────── */}
      <ol className="match-live__feed" data-testid="match-live-feed">
        {visibleEvents.map((ev) => (
          <li
            key={ev.id}
            className="match-live__event match-live__event--fade-in"
            data-testid="match-live-event"
            data-minute={ev.minute}
          >
            <span className="match-live__event-minute">{ev.minute}&apos;</span>
            <span className="match-live__event-text">{eventLine(ev)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
