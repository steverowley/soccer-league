// ── random.ts ────────────────────────────────────────────────────────────────
// WHY: These three functions are the *only* source of randomness in the entire
// ISL simulation. Every dice roll, player contest, commentary pick, weather
// event, and outcome probability flows through one of them. Centralising
// randomness here means:
//   1. Tests can monkey-patch Math.random once and control the whole engine.
//   2. A future seeded-PRNG swap (for replays or deterministic seeds) touches
//      exactly one file.
//   3. TypeScript generics on `pick()` eliminate the `as T` casts that were
//      scattered across the old JS callers.
//
// This is a direct TypeScript port of `src/utils.js`. The JS original is kept
// intact during the Phase -1 migration window (allowJs: true) so existing
// callers compile without changes. Once every caller has been moved to a
// TypeScript file importing from `@shared/utils/random`, the JS original
// can be deleted.
//
// PURE MODULE — no React, no Supabase, no side effects.
// Every export here must remain unit-testable with plain `vitest`.

/**
 * Returns a random floating-point number in the range [min, max).
 *
 * The lower bound is inclusive; the upper bound is exclusive — the same
 * convention used by Math.random() itself, which makes it composable.
 *
 * Used in the engine for probability rolls where fractional precision matters,
 * e.g. comparing `rnd(0, 1)` against a computed contest probability.
 *
 * @param min - Inclusive lower bound.
 * @param max - Exclusive upper bound.
 * @returns A float: min ≤ result < max.
 *
 * @example
 * rnd(0, 1)      // random probability, e.g. 0.7341
 * rnd(60, 90)    // random minute in the second half
 */
export const rnd = (min: number, max: number): number =>
  Math.random() * (max - min) + min;

/**
 * Returns a random integer in the range [min, max], both bounds inclusive.
 *
 * The +1 on the upper bound before flooring is what makes `max` inclusive —
 * without it, `rndI(1, 6)` would never return 6 because Math.random() is
 * strictly less than 1.0.
 *
 * Used for discrete outcomes: card severity, goal minute (as an integer),
 * substitution window, injury duration in matches, etc.
 *
 * @param min - Inclusive lower bound (integer).
 * @param max - Inclusive upper bound (integer).
 * @returns An integer: min ≤ result ≤ max.
 *
 * @example
 * rndI(1, 6)     // simulates a six-sided die: returns 1, 2, 3, 4, 5, or 6
 * rndI(45, 90)   // random match minute in the second half
 * rndI(1, 3)     // pick one of three severity levels
 */
export const rndI = (min: number, max: number): number =>
  Math.floor(rnd(min, max + 1));

/**
 * Picks one element uniformly at random from an array.
 *
 * The generic type parameter T is inferred from the array's element type, so
 * callers get a properly typed return value without casting:
 *   pick(['a', 'b', 'c'])  // → string
 *   pick([1, 2, 3])        // → number
 *   pick(commentaryLines)  // → CommentaryLine (whatever T is)
 *
 * Used constantly throughout the engine: choosing commentary lines, picking a
 * random player for a foul, selecting weather conditions, tactics decisions, etc.
 *
 * @param arr - Non-empty array of elements to choose from.
 * @returns One element chosen uniformly at random.
 *
 * @example
 * pick(['dust_storm', 'clear', 'high_winds'])  // → one of the three strings
 * pick(squad)                                  // → one Player object
 *
 * @remarks
 * Passing an empty array returns `undefined` (typed as `T`). The engine
 * never calls pick() on an empty array in practice — it would indicate a
 * roster or commentary configuration bug, not a recoverable error.
 */
export const pick = <T>(arr: readonly T[]): T =>
  // Flooring `Math.random() * arr.length` gives a uniform index in [0, length-1].
  arr[Math.floor(Math.random() * arr.length)] as T;
