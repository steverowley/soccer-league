// ── features/match/logic/elapsedMinute.ts ────────────────────────────────────
// Pure helpers that translate wall-clock timestamps into the live-viewer's
// "current game minute" counter.
//
// WHY THIS LIVES IN logic/ (no React, no Supabase)
//   The live viewer (MatchLivePage) ticks a setInterval every second and asks
//   "what game minute are we on?".  Keeping the math in a pure function lets
//   us unit-test every edge case (kickoff in the future, kickoff in the past,
//   ridiculous duration values, etc.) without spinning up React or vi.useFakeTimers.
//
// THE FORMULA
//   elapsedRealSeconds = (now - kickoffAt) / 1000
//   gameMinute         = (elapsedRealSeconds / matchDurationSeconds) × 90
//
//   matchDurationSeconds is the season_config.match_duration_seconds knob —
//   how long it takes the live viewer to reveal a 90-minute simulated match
//   in real time.  Production default is 600 s (10 minutes real time → 90 game
//   minutes ≈ 6.7 real seconds per game minute).  Test seasons may use 180 s
//   (2 real seconds per game minute) so a full match plays out in 3 minutes.
//
// CLAMP STRATEGY
//   • Pre-kickoff (now < kickoffAt) → 0          (no events visible yet)
//   • Mid-match (0 ≤ minute ≤ 90)   → floor(min) (events at the integer
//                                                 boundary appear when their
//                                                 minute is fully reached)
//   • Post-full-time (> 90)         → 90+        (caller decides whether to
//                                                 cap; we return the raw
//                                                 over-90 value so a future
//                                                 stoppage-time feature has
//                                                 the data it needs).

/**
 * Compute the current game minute for a live match given a wall-clock now.
 *
 * @param kickoffAt           ISO 8601 timestamp of the simulated match's
 *                            scheduled kickoff (matches.scheduled_at).
 * @param now                 Current wall-clock instant.  Inject `Date.now()`
 *                            in production; the live viewer does so once per
 *                            tick so each render gets a fresh value.
 * @param matchDurationSeconds  How long the viewer should take to reveal the
 *                            full 90-minute match in real time.  From
 *                            season_config.match_duration_seconds.
 * @returns                   The integer game minute the caller should reveal
 *                            events up to (inclusive).  0 before kickoff;
 *                            grows to 90 over `matchDurationSeconds`; may
 *                            exceed 90 if the caller doesn't cap.
 *
 * @example
 *   // Kickoff was 60s ago; 600s (10min) duration → 9 game minutes elapsed
 *   computeElapsedGameMinute('2026-04-01T12:00:00Z',
 *                            new Date('2026-04-01T12:01:00Z'),
 *                            600)
 *   // → 9
 */
export function computeElapsedGameMinute(
  kickoffAt:           string,
  now:                 Date,
  matchDurationSeconds: number,
): number {
  // Defensive: a 0/negative duration would divide-by-zero or invert time.
  // Treat as "match has not started" and return 0.
  if (matchDurationSeconds <= 0) return 0;

  const kickoffMs    = new Date(kickoffAt).getTime();
  const elapsedMs    = now.getTime() - kickoffMs;

  // Pre-kickoff: nothing is revealed yet.
  if (elapsedMs <= 0) return 0;

  const elapsedSeconds = elapsedMs / 1000;
  const gameMinute     = (elapsedSeconds / matchDurationSeconds) * 90;

  // Floor so that minute-N events only appear once minute N has been fully
  // reached on the wall clock — a half-minute through is not "minute N+1 yet".
  return Math.floor(gameMinute);
}

/**
 * Convenience wrapper: filter a list of pre-fetched match events down to
 * those whose minute is ≤ the elapsed game minute.  This is the exact filter
 * the live viewer applies on every tick to decide which events to show.
 *
 * Kept as a pure helper so consumers don't repeat the comparison everywhere.
 *
 * @param events           The full list of events returned from match_events
 *                         (minute, subminute, type, payload).
 * @param elapsedMinute    The current elapsed game minute (from
 *                         computeElapsedGameMinute).
 * @returns                Subset of `events` whose minute ≤ elapsedMinute.
 *                         Order is preserved — caller is responsible for
 *                         providing a sorted input.
 */
export function filterEventsByElapsedMinute<E extends { minute: number }>(
  events:        E[],
  elapsedMinute: number,
): E[] {
  return events.filter((e) => e.minute <= elapsedMinute);
}
