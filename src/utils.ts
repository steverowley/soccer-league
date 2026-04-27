// ── utils.ts ──────────────────────────────────────────────────────────────────
// Tiny math/random helpers used everywhere in the game engine.
//
// These three functions are the only source of randomness in the entire
// simulation, so every dice roll, player pick, and outcome probability
// flows through here.  They are pure (no side effects) and stateless.
//
// WHY HERE: Centralising randomness into three named helpers makes the
// simulation easier to reason about and to mock in tests. Any future
// seeded-RNG swap only needs to touch this file.

/**
 * Returns a random float in [min, max).
 *
 * The half-open interval matches `Math.random()` semantics. Used directly
 * when a continuous distribution is needed (e.g. probability comparisons
 * against a 0–1 roll).
 */
export const rnd = (min: number, max: number): number =>
  Math.random() * (max - min) + min;

/**
 * Returns a random integer in [min, max], both inclusive.
 *
 * e.g. `rndI(1, 6)` simulates a six-sided die.
 * Achieved by flooring a half-open float in [min, max+1).
 */
export const rndI = (min: number, max: number): number =>
  Math.floor(rnd(min, max + 1));

/**
 * Picks one element at random from an array using a uniform distribution.
 *
 * Used constantly throughout the engine to choose commentary lines, random
 * players, tactics, stadiums, weather conditions, etc. Caller must guarantee
 * the array is non-empty; passing an empty array returns `undefined` (which
 * TypeScript correctly narrows to `T | undefined` via the generic).
 */
export const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)] as T;
