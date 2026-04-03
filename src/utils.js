// ── utils.js ──────────────────────────────────────────────────────────────────
// Tiny math/random helpers used everywhere in the game engine.
//
// These three functions are the only source of randomness in the entire
// simulation, so every dice roll, player pick, and outcome probability
// flows through here.

/** Returns a random float between min (inclusive) and max (exclusive). */
export const rnd  = (min, max) => Math.random() * (max - min) + min;

/**
 * Returns a random integer between min and max, both inclusive.
 * e.g. rndI(1, 6) simulates a six-sided die.
 */
export const rndI = (min, max) => Math.floor(rnd(min, max + 1));

/**
 * Picks one element at random from an array.
 * Used constantly throughout the engine to choose commentary lines,
 * random players, tactics, stadiums, etc.
 */
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];
