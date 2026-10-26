/**
 * subminute.ts: the one place a `match_events.subminute` value is made legal.
 *
 * The column is `numeric(4,3) CHECK (subminute >= 0 AND subminute < 1)`
 * (migration 0013). Several producers derive a subminute by offsetting
 * another event's (an Architect line lands `+0.005` after the goal that
 * triggered it), and with the emergent engine's continuous clock a goal can
 * sit at 0.996 of its minute, so the offset reaches 1.001. Postgres rejects
 * the whole batch, the worker requeues the match, and because a retry reuses
 * the stored seed it fails identically forever (2026-10-26: 664 failed
 * attempts that starved the database overnight).
 *
 * Rounding matters too: numeric(4,3) rounds 0.9996 UP to 1.000, which also
 * violates the check, so clamp AFTER rounding to three places.
 */

/** Largest value the column accepts. */
export const MAX_SUBMINUTE = 0.999;

/**
 * Coerce any number into a legal subminute: finite, three decimal places,
 * within [0, 0.999]. NaN and non-finite values become 0.
 */
export function legalSubminute(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value * 1000) / 1000;
  return Math.min(MAX_SUBMINUTE, Math.max(0, rounded));
}

/**
 * A subminute just after `base`, for an event that reacts to another one.
 * Never crosses into the next minute: at the end of a minute it shares the
 * last slot, and the caller's stable sort keeps the reaction after its trigger
 * because reactions are appended after the event they follow.
 */
export function subminuteAfter(base: number, offset = 0.005): number {
  return legalSubminute(base + offset);
}
