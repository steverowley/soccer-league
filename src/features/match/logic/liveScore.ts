// ── features/match/logic/liveScore.ts ────────────────────────────────────────
// Derives the scoreline a spectator should see RIGHT NOW from the events that
// have actually been revealed on the wall clock.
//
// WHY THIS EXISTS
//   `matches.home_score` is the PUBLISHED result and stays NULL until real full
//   time (migration 0081 — the worker parks the simulated score in `sim_*` and
//   the finalizer publishes it once the reveal window closes).  Before that the
//   only truth about "what has happened so far" is the revealed slice of
//   `match_events`, so the scoreboard counts goals in that slice instead.
//
//   This is what makes a live match actually live: previously the viewer read
//   `home_score` directly, so the FINAL score was on screen from minute 0 while
//   the commentary feed was still pacing minute 3.
//
// PURE LOGIC — no React, no Supabase.  Callers pass the already-filtered event
// list (see filterEventsByElapsedMinute in logic/elapsedMinute.ts).

/** The minimum shape this module needs from a match event row. */
export interface ScorableEvent {
  type:     string;
  payload?: unknown;
}

/** A scoreline as [home, away]. */
export type Scoreline = [number, number];

/**
 * Read the home/away attribution off an event payload.
 *
 * `side` is written by the spatial adapter (`spatialEventAdapter.ts`) and is the
 * only trustworthy attribution on the row: the sibling `team` field is a display
 * short-name that the adapter omits entirely when the scorer can't be resolved.
 *
 * @param payload  The event's raw `payload` jsonb (untyped at the DB boundary).
 * @returns        'home' | 'away', or null when the event carries no side.
 */
function readSide(payload: unknown): 'home' | 'away' | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const side = (payload as { side?: unknown }).side;
  return side === 'home' || side === 'away' ? side : null;
}

/**
 * Count the goals among the revealed events.
 *
 * Only events of type `goal` that carry a `side` are counted.  A goal with no
 * side is skipped rather than guessed — inventing an attribution would show a
 * spectator a scoreline that never happened.  (Every match simulated since the
 * adapter started emitting `side` carries it; older matches are already
 * `completed` and render their published score instead of this.)
 *
 * @param revealedEvents  Events already revealed on the wall clock, i.e. the
 *                        output of `filterEventsByElapsedMinute`.  Passing the
 *                        UNFILTERED list would spoil the match.
 * @returns               `[home, away]` goals so far.  `[0, 0]` for an empty
 *                        list, so a match that has kicked off but revealed
 *                        nothing yet correctly reads 0-0.
 *
 * @example
 *   computeLiveScore([
 *     { type: 'goal', payload: { side: 'home' } },
 *     { type: 'shot', payload: { side: 'away' } },
 *   ])
 *   // → [1, 0]
 */
export function computeLiveScore(revealedEvents: readonly ScorableEvent[]): Scoreline {
  let home = 0;
  let away = 0;
  for (const ev of revealedEvents) {
    if (ev.type !== 'goal') continue;
    const side = readSide(ev.payload);
    if (side === 'home') home++;
    else if (side === 'away') away++;
  }
  return [home, away];
}

/**
 * Whether a match's result should be hidden from the spectator.
 *
 * True while the match is still revealing (`live`) or being simulated
 * (`in_progress`) — in both cases the published score is either NULL or not yet
 * meaningful, and the scoreboard must fall back to `computeLiveScore`.
 *
 * @param status  The raw `matches.status` value.
 * @returns       True when the caller must derive the score from revealed events.
 */
export function isRevealing(status: string | null | undefined): boolean {
  return status === 'live' || status === 'in_progress';
}
