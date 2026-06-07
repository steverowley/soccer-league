// ── voting/logic/enactmentSchedule.ts ────────────────────────────────────────
// Pure predicate for the server-side enactment scheduler (#529): decide whether
// a season in the 'voting' phase has had its voting window elapse and is
// therefore due for focus enactment.  Kept here (pure, unit-tested) so the
// scheduled runner — scripts/enact-due-seasons.ts, invoked by a GitHub Action —
// stays thin glue around the already-tested enactSeasonFocuses.

/** Minimal season shape the scheduler reasons about. */
export interface SchedulableSeason {
  id: string;
  status: string;
  /**
   * When the voting window opened.  The admin path stamps `election_opens_at`;
   * the match-worker's active→voting transition stamps `ended_at`.  We anchor on
   * whichever is present so both kinds of season are schedulable.
   */
  election_opens_at: string | null;
  ended_at: string | null;
}

/** Default voting window, in hours, before enactment fires (design: 48h). */
export const DEFAULT_ENACTMENT_WINDOW_HOURS = 48;

/**
 * True when `season` is in the 'voting' phase AND its voting window has fully
 * elapsed as of `nowMs`.
 *
 * Anchors on `election_opens_at`, falling back to `ended_at` (the worker
 * transition stamps the latter, not the former).  A season with neither
 * timestamp — or an unparseable one — is never due: we can't tell when its
 * window opened, so we wait rather than enact prematurely.
 *
 * @param season       Season row (status + the two anchor timestamps).
 * @param nowMs        Current time in epoch ms (injected so callers/tests pin it).
 * @param windowHours  Voting window length in hours (default 48).
 * @returns            Whether enactment should fire for this season now.
 */
export function isSeasonDueForEnactment(
  season: SchedulableSeason,
  nowMs: number,
  windowHours: number = DEFAULT_ENACTMENT_WINDOW_HOURS,
): boolean {
  if (season.status !== 'voting') return false;

  const anchor = season.election_opens_at ?? season.ended_at;
  if (!anchor) return false;

  const openedMs = Date.parse(anchor);
  if (Number.isNaN(openedMs)) return false;

  return nowMs - openedMs >= windowHours * 3_600_000;
}
