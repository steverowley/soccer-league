// ── features/match/logic/spatial/traitModifiers.ts ───────────────────────────
// The entities → engine bridge: turns a player's narrative `personality` trait
// into a small, deterministic nudge on the sim stats the spatial engine reads.
//
// WHY THIS EXISTS
//   The spatial engine is deterministic and validated — we never touch its core.
//   Instead we adjust its INPUTS: an archetype shifts a few of the nine sim
//   stats by a couple of points before kickoff, so a `selfish` striker shoots
//   more and shares less, a `workhorse` covers more ground, and so on.  The
//   match itself stays seeded and reproducible — this runs entirely before
//   simulateSpatialMatch, so it cannot add or reorder a single RNG draw.
//
//   Because it is a pure function of the trait value, an absent or unknown
//   personality is a strict no-op: the stats come out value-equal to the input,
//   so a roster with no personalities reproduces today's matches byte-for-byte.
//
//   This is also the Cosmic Architect's newest lever — writing a player's
//   `entity_traits` personality before a match biases that player's inputs
//   without ever rewriting an outcome.
//
// The delta table is keyed by plain archetype strings (not the PERS constant)
// so this module stays importable by the Deno worker twin, which cannot reach
// into src/constants.ts.

import type { SimPlayerStats } from './types';
import type { SpatialTeamInput } from './simulateSpatialMatch';

/** The narrative traits the engine input layer currently consults. */
export interface PlayerTraits {
  /** One of the eight personality archetypes; unknown / null values no-op. */
  personality?: string | null;
}

/**
 * Additive deltas on the nine sim stats, keyed by personality archetype.
 * Magnitudes are deliberately small (±2–3) — subtle-to-moderate, so league-wide
 * scoring stays inside the engine-calibration bands while individual players
 * still feel like their archetype.  Directions mirror the behaviour each
 * personality is already documented to have in constants.ts.
 */
const PERSONALITY_DELTAS: Record<string, Partial<SimPlayerStats>> = {
  balanced:    {},                                       // reliable all-rounder — no nudge
  selfish:     { shooting: 3, passing: -3, vision: -2 }, // shoots from anywhere, shares less
  team_player: { passing: 3, vision: 3, shooting: -2 },  // creates for others
  aggressive:  { tackling: 3, positioning: -2 },         // wins the ball, over-commits
  cautious:    { positioning: 3, shooting: -2 },         // snuffs out danger, rarely forward
  creative:    { dribbling: 3, vision: 3, stamina: -2 }, // audacious skill on the ball
  lazy:        { stamina: -3, speed: -2 },               // drops work rate
  workhorse:   { stamina: 3, positioning: 2 },           // covers ground all match
};

/** Sim stats stay in [1, 99] — the band deriveSimStats and the engine assume. */
const STAT_MIN = 1;
const STAT_MAX = 99;

/**
 * Apply a player's personality nudge to their derived sim stats.
 *
 * Pure and deterministic — no RNG, no clock, no iteration-order dependence (the
 * keys come from the fixed `stats` object).  An absent or unrecognised
 * personality returns a value-equal copy, so callers without trait data behave
 * exactly as before.
 */
export function applyTraitModifiers(stats: SimPlayerStats, traits: PlayerTraits): SimPlayerStats {
  const deltas = traits.personality ? (PERSONALITY_DELTAS[traits.personality] ?? {}) : {};
  const out = { ...stats };
  for (const key of Object.keys(out) as (keyof SimPlayerStats)[]) {
    const delta = deltas[key] ?? 0;
    out[key] = Math.max(STAT_MIN, Math.min(STAT_MAX, out[key] + delta));
  }
  return out;
}

/**
 * Apply per-player personality nudges across a whole built team input.  Keeps
 * the call sites (the worker and the browser preview) to a single line: they
 * pass the SpatialTeamInput straight from toSpatialTeamInput plus a
 * player-id → personality map resolved from the entities layer.
 *
 * Players missing from the map (or with a null value) are left untouched.
 */
export function applyTeamTraits(
  team: SpatialTeamInput,
  personalityById: ReadonlyMap<string, string | null | undefined>,
): SpatialTeamInput {
  return {
    ...team,
    players: team.players.map((player) => ({
      ...player,
      stats: applyTraitModifiers(player.stats, { personality: personalityById.get(player.id) ?? null }),
    })),
  };
}
