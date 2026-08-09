// ── match-worker/matchRng.ts ─────────────────────────────────────────────────
// Per-match deterministic random sources, all derived from the match UUID.
//
// WHY THIS EXISTS
//   The spatial engine is seeded from the match UUID, so re-simulating a
//   fixture reproduces it exactly.  The Architect's post-simulation passes did
//   not share that guarantee: they ran on the global `Math.random`, and two of
//   them (annul_goal, curse_player) can strike goals off the stream.  A worker
//   retry on the same match could therefore persist a DIFFERENT final score
//   from the same seeded simulation — after wagers had been placed on it.
//
//   Routing those passes through a seeded stream closes that hole: the same
//   match id resolves the same Architect intents the same way, every run.
//
// TWO STREAMS, ONE SEED
//   The narrative stream is offset from the simulation seed so the two never
//   correlate — the Architect's rolls must not be a function of where the
//   engine happened to leave its own generator.  The offset is the golden-ratio
//   constant used by mulberry32 itself; any fixed odd constant would do.
//
//   The LLM half of the Architect stays non-deterministic by nature (the model
//   picks the intents).  What this makes reproducible is the MECHANICAL
//   resolution of whatever intents came back.

import { makeRng, type Rng } from './spatial/rng.ts';

/** Offset between the simulation stream and the narrative stream. */
const NARRATIVE_SEED_OFFSET = 0x9e3779b9;

/**
 * Derive the engine's 32-bit simulation seed from a match UUID.
 *
 * The first 8 hex digits of the UUID (dashes stripped) are read as an integer.
 * This is the exact expression the worker has always used — keep it byte-stable
 * or every future fixture simulates differently.
 *
 * @param matchId  The match UUID.
 * @returns        A 32-bit integer seed.
 */
export function seedFromMatchId(matchId: string): number {
  return parseInt(matchId.replace(/-/g, '').slice(0, 8), 16);
}

/**
 * Build the narrative RNG for a match — the source the Architect's post-passes
 * roll against.  Two calls with the same match id emit identical sequences.
 *
 * @param matchId  The match UUID.
 * @returns        A seeded `Rng` independent of the simulation stream.
 */
export function narrativeRngForMatch(matchId: string): Rng {
  return makeRng((seedFromMatchId(matchId) ^ NARRATIVE_SEED_OFFSET) >>> 0);
}
