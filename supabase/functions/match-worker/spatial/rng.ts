// ── features/match/logic/spatial/rng.ts ──────────────────────────────────────
// Seeded, deterministic pseudo-random number generator for the spatial engine.
//
// WHY DETERMINISM IS NON-NEGOTIABLE
//   The whole game rests on reproducible matches: the same fixture simulated
//   twice must produce the identical match so the live viewer, the stored
//   position frames, and the score all agree.  The legacy dice-roller engine
//   achieved this via a seeded `Math.random` spy in tests; the spatial engine
//   instead threads an explicit `Rng` function everywhere, which is cleaner
//   (no global state) and lets two independent matches run in the same process
//   without their random streams interfering.
//
// ALGORITHM
//   mulberry32 — a tiny, fast, well-distributed 32-bit generator.  The same
//   algorithm already used by the pitch choreographer (choreographer.ts), so
//   the codebase has one RNG idiom rather than two.

/** A seeded random source returning a float in [0, 1).  Call it to advance. */
export type Rng = () => number;

/**
 * Build a deterministic RNG from an integer seed.
 *
 * mulberry32: one multiply-xorshift round per call.  Period 2^32, which is far
 * more than the ~50k draws a single match consumes.  Two RNGs built from the
 * same seed emit byte-identical sequences.
 *
 * @param seed  Any 32-bit integer.  Different seeds → different matches.
 * @returns     A function that returns the next float in [0, 1) on each call.
 */
export function makeRng(seed: number): Rng {
  // `a` holds the generator state; `>>> 0` keeps it an unsigned 32-bit int.
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Uniform float in [min, max).
 *
 * @param rng  The seeded source.
 * @param min  Lower bound (inclusive).
 * @param max  Upper bound (exclusive).
 */
export function rngRange(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng();
}

/**
 * Uniform integer in [minInclusive, maxInclusive].
 * Both ends are reachable — handy for picking discrete options.
 */
export function rngInt(rng: Rng, minInclusive: number, maxInclusive: number): number {
  return minInclusive + Math.floor(rng() * (maxInclusive - minInclusive + 1));
}

/**
 * Bernoulli trial: true with probability `p`.
 *
 * @param rng  The seeded source.
 * @param p    Probability of `true` in [0, 1].  p≤0 → never, p≥1 → always.
 */
export function rngChance(rng: Rng, p: number): boolean {
  return rng() < p;
}

/**
 * Uniformly pick one element of a non-empty array.
 * Returns `undefined` for an empty array so callers can guard cleanly.
 */
export function rngPick<T>(rng: Rng, arr: readonly T[]): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * Approximately Gaussian (normal) sample via the central-limit trick:
 * the mean of 3 uniforms is bell-shaped enough for adding natural "error" to
 * passes and shots without the cost of a Box–Muller transform.
 *
 * Used so a player's pass/shot lands NEAR the intended target with a spread
 * inversely proportional to their skill — most attempts cluster on target,
 * a few stray wide.
 *
 * @param rng     The seeded source.
 * @param mean    Centre of the distribution (default 0).
 * @param stddev  Approximate standard deviation (default 1).
 */
export function rngGaussian(rng: Rng, mean = 0, stddev = 1): number {
  // Mean of 3 uniforms has mean 0.5 and variance 1/36; subtract 0.5 to centre,
  // multiply by sqrt(12) ≈ 3.464 so the result has unit variance before scaling.
  const u = (rng() + rng() + rng()) / 3 - 0.5;
  return mean + u * 3.4641016 * stddev;
}
