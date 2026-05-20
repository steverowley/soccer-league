// ── random.ts ────────────────────────────────────────────────────────────────
// Centralized randomness source for the match simulation engine.
// All dice rolls, probabilities, and random selections flow through these
// functions so the simulation is testable and future-proof for seeded PRNGs.

/**
 * Returns a random floating-point number in the range [min, max).
 *
 * The lower bound is inclusive; the upper bound is exclusive — matching the
 * convention used by Math.random() itself, which makes it composable.
 *
 * @param min - Inclusive lower bound.
 * @param max - Exclusive upper bound.
 * @returns A float: min ≤ result < max.
 */
export const rnd = (min: number, max: number): number =>
  Math.random() * (max - min) + min;

/**
 * Returns a random integer in the range [min, max], both bounds inclusive.
 *
 * The +1 on the upper bound before flooring makes `max` inclusive — without it,
 * `rndI(1, 6)` would never return 6 because Math.random() is strictly < 1.0.
 *
 * @param min - Inclusive lower bound (integer).
 * @param max - Inclusive upper bound (integer).
 * @returns An integer: min ≤ result ≤ max.
 */
export const rndI = (min: number, max: number): number =>
  Math.floor(rnd(min, max + 1));

/**
 * Picks one element uniformly at random from an array.
 *
 * The generic type parameter T is inferred from the array's element type, so
 * callers get a properly typed return value without casting.
 *
 * @param arr - Non-empty array of elements to choose from.
 * @returns One element chosen uniformly at random.
 */
export const pick = <T>(arr: readonly T[]): T =>
  arr[Math.floor(Math.random() * arr.length)] as T;
