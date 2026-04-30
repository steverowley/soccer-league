// ── features/match/logic/seasonLifecycle.ts ──────────────────────────────────
// Pure helpers for the season-lifecycle state machine introduced in
// Package 13 / migration 0014.  No React, no Supabase — the worker and
// any tests inject fixture data directly.
//
// WHAT BELONGS HERE
//   • `isSeasonComplete()` — given a tally of league-fixture statuses,
//     decide whether the season has finished.  Centralised so the worker,
//     admin tooling, and tests all agree on the rule.
//   • `nextStatus()` — the lifecycle transition table as a pure function
//     so the same enum-style flow is exercised everywhere it's referenced.
//
// WHAT DOES NOT BELONG HERE
//   • Database queries — those live in api/seasons.ts.
//   • Cup-status logic — cups are knockout rounds whose completion is
//     orthogonal to league completion (a season can transition to 'voting'
//     while a cup final is still pending; the cup advancer keeps running
//     post-season).

// ── Public types ─────────────────────────────────────────────────────────────

/**
 * Per-status counts of league fixtures within one season.  Cup matches are
 * intentionally excluded — they do not gate the season transition.
 */
export interface LeagueFixtureCounts {
  /** Matches still waiting to be picked up by the worker. */
  scheduled:   number;
  /** Matches the worker is currently simulating. */
  inProgress:  number;
  /** Finished matches (final score persisted). */
  completed:   number;
  /** Forfeits / admin-cancelled fixtures.  Treated as terminal for
   *  completion purposes — a cancelled match cannot block the season. */
  cancelled:   number;
}

/** All four lifecycle states the `seasons.status` column can hold. */
export type SeasonStatus = 'active' | 'voting' | 'enacted' | 'archived';

// ── Completion check ─────────────────────────────────────────────────────────

/**
 * Decide whether a season's league phase is complete.  A season counts as
 * complete iff every league fixture has reached a terminal status
 * (`completed` or `cancelled`).  Empty seasons (zero matches) do NOT count
 * as complete — that almost certainly means the worker query is wrong, and
 * we'd rather fail loudly than auto-transition an unseeded season.
 *
 * @param counts  League-fixture status tally for the season.  Cup matches
 *                must be excluded by the caller.
 * @returns       True when scheduled + inProgress = 0 AND at least one
 *                fixture exists overall.
 *
 * @example
 *   isSeasonComplete({ scheduled: 0, inProgress: 0, completed: 224, cancelled: 0 })
 *   // → true  (all 224 league matches finished)
 *
 *   isSeasonComplete({ scheduled: 1, inProgress: 0, completed: 223, cancelled: 0 })
 *   // → false (one match still pending)
 *
 *   isSeasonComplete({ scheduled: 0, inProgress: 0, completed: 0, cancelled: 0 })
 *   // → false (empty season — never auto-transition an unseeded row)
 */
export function isSeasonComplete(counts: LeagueFixtureCounts): boolean {
  if (counts.scheduled > 0 || counts.inProgress > 0) return false;
  return (counts.completed + counts.cancelled) > 0;
}

// ── Transition table ─────────────────────────────────────────────────────────

/**
 * The legal forward-only state transitions for `seasons.status`.  Returning
 * `null` means the proposed transition is invalid from the current state —
 * callers must treat that as a no-op rather than mutating the row.
 *
 * The diagram (matches the issue + migration 0014):
 *
 *   active ──► voting ──► enacted ──► archived
 *
 * No backwards arrows: once a season's league phase is over it stays over;
 * once focuses are enacted they cannot be retracted.  The architect can
 * still write narrative residue forever, but the state machine is closed.
 *
 * @param current  The current `seasons.status` value.
 * @returns        The next legal status, or null if `current === 'archived'`.
 */
export function nextStatus(current: SeasonStatus): SeasonStatus | null {
  switch (current) {
    case 'active':   return 'voting';
    case 'voting':   return 'enacted';
    case 'enacted':  return 'archived';
    case 'archived': return null;
  }
}
