// ── resolvers/cardSeverity.ts ───────────────────────────────────────────────
// Reflex-tier resolver: in-match, sub-second.  Given a referee's persona
// + their memories of the offending player and the current incident
// severity floor (0..1, what gameEngine already computed for the foul),
// returns the *card-severity weight* the engine should use to decide
// no-card / yellow / red.
//
// WHY THIS RESOLVER EXISTS
//   gameEngine.js already maps a foul's raw severity into a card via
//   simple thresholds.  Phase 8 of the agent plan lets each referee
//   shade that threshold by personality and by their *memories of this
//   specific player*: a ref who's had multiple flare-ups with a player
//   reaches for the card faster; a ref who's enjoyed a clean match with
//   them grants the benefit of the doubt.  Names matter; reputations
//   matter; the league starts to feel officiated by people.
//
// PURE MODULE — no React, no Supabase, no LLM, NO Math.random.  Returns
// a weight; the caller compares it against existing engine thresholds.
//
// HOT PATH SAFETY
//   This resolver is designed for the sub-second in-match decision
//   cadence.  The caller pre-hydrates referee persona + relevant memories
//   via `prepareCorpusForMatch` (follow-up to this PR) — the resolver
//   itself does no I/O.

import type { MemoryRow, PersonaRow } from '../../types';

// ── Tuning constants ────────────────────────────────────────────────────────

/** Floor of the engine's incident severity scale (clean play). */
const SEVERITY_FLOOR = 0;

/** Ceiling of the engine's incident severity scale (straight red territory). */
const SEVERITY_CEIL = 1;

/**
 * Maximum signed delta the resolver may apply to the engine's incident
 * severity.  0.2 of the [0,1] scale = up to 20pp shift either way — large
 * enough to flip a borderline tackle into a yellow, but never enough to
 * fabricate a red where the engine saw nothing.
 */
const MAX_DELTA = 0.20;

/** Fraction of MAX_DELTA driven by Big-Five conscientiousness (strictness proxy). */
const STRICTNESS_CONTRIBUTION = 0.5;

/** Fraction of MAX_DELTA driven by per-player memory grudges. */
const MEMORY_CONTRIBUTION = 0.5;

/**
 * Memory fact_kinds that count as *flare-ups* the ref remembers against
 * THIS player.  Each match builds the grudge; the resolver scales the
 * impact down per memory so a 10-grudge stack doesn't run away.
 */
const FLAREUP_FACT_KINDS = new Set([
  'argued_with_ref',  // player was vocal in dissent
  'dive_simulated',   // ref logged a simulation suspicion
  'second_yellow',    // ref already shown the player two yellows
]);

/**
 * Memory fact_kinds that act as *goodwill* — clean matches with this
 * player.  Each reduces the effective severity slightly, modelling the
 * ref's instinct to give a benefit of the doubt to a known clean player.
 */
const GOODWILL_FACT_KINDS = new Set(['clean_match_with']);

/** Per-memory weight before clamp.  ±0.05 per memory feels right at v1. */
const MEMORY_PER_HIT = 0.05;

// ── Context type ────────────────────────────────────────────────────────────

/**
 * Inputs to the card-severity decision.  Caller passes the offending
 * player's entity_id (to filter memories) and the engine's baseline
 * incident severity ∈ [0,1] (this is what the resolver shades).
 */
export interface CardSeverityContext {
  /** Entity id of the player who committed the offence. */
  playerEntityId: string;
  /** Baseline severity from the engine's incident roll, in [0,1]. */
  baseSeverity: number;
}

/** Result: the shaded severity + the component contributions. */
export interface CardSeverityResult {
  /** Final severity ∈ [0,1] after personality + memory shading. */
  shadedSeverity: number;
  /** Component from the ref's strictness (Big-Five conscientiousness). */
  strictnessDelta: number;
  /** Component from accumulated flare-up memories. */
  memoryDelta: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Safely read a Big-Five axis float from the persona's JSONB vector.
 * Falls back to 0.5 when the shape isn't what we expect.
 *
 * @param persona  Persona row to inspect.
 * @param axis     Big-Five axis key.
 * @returns        Float in [0,1].
 */
function bigFive(persona: PersonaRow, axis: string): number {
  const vec = persona.personality_vec as { bigFive?: Record<string, unknown> } | null;
  const value = vec?.bigFive?.[axis];
  return typeof value === 'number' ? Math.max(0, Math.min(1, value)) : 0.5;
}

/**
 * Compute the signed memory contribution: flare-ups − goodwill, each
 * counted only when the memory's subjects include this player.  Capped
 * at ±5 so the term saturates rather than running away.
 *
 * @param memories         Referee's memory rows.
 * @param playerEntityId   Offender's entity id.
 * @returns                Signed delta in [-1,1].
 */
function memoryTally(
  memories: readonly MemoryRow[],
  playerEntityId: string,
): number {
  let flareups = 0;
  let goodwill = 0;
  for (const m of memories) {
    if (!m.subjects.includes(playerEntityId)) continue;
    if (FLAREUP_FACT_KINDS.has(m.fact_kind)) flareups += 1;
    if (GOODWILL_FACT_KINDS.has(m.fact_kind)) goodwill += 1;
  }
  flareups = Math.min(5, flareups);
  goodwill = Math.min(5, goodwill);
  return (flareups - goodwill) * MEMORY_PER_HIT;
}

// ── Resolver ───────────────────────────────────────────────────────────────

/**
 * Shade the engine's baseline incident severity by the referee's
 * personality and per-player memory tally.
 *
 *   - Strictness (conscientiousness): >0.5 → stricter ref, raises the
 *     effective severity; <0.5 → lenient, lowers it.  Centred on 0.5 so
 *     a neutral persona contributes zero delta.
 *   - Memory: flare-ups raise effective severity, goodwill lowers it.
 *     Saturates at ±0.25 (5 memories × MEMORY_PER_HIT × MEMORY_CONTRIBUTION).
 *
 * Final severity is clamped to [0,1] so the resolver can never
 * fabricate a card out of clean play — it shifts a tackle that was
 * already borderline.
 *
 * @param persona  The referee's persona row.
 * @param memories  Referee's memory rows (1-hop subjects only).
 * @param context  Match-time context — the offender and base severity.
 * @returns        Shaded severity + the two component deltas.
 */
export function resolveCardSeverity(
  persona: PersonaRow,
  memories: readonly MemoryRow[],
  context: CardSeverityContext,
): CardSeverityResult {
  // ── Strictness delta ─────────────────────────────────────────────────
  const conscientiousness = bigFive(persona, 'conscientiousness');
  const strictnessDelta =
    (conscientiousness - 0.5) * 2 * MAX_DELTA * STRICTNESS_CONTRIBUTION;

  // ── Memory delta ─────────────────────────────────────────────────────
  const memoryRaw = memoryTally(memories, context.playerEntityId);
  const memoryDelta = memoryRaw * MAX_DELTA * MEMORY_CONTRIBUTION;

  // ── Combine + clamp ──────────────────────────────────────────────────
  let severity = context.baseSeverity + strictnessDelta + memoryDelta;
  if (severity < SEVERITY_FLOOR) severity = SEVERITY_FLOOR;
  if (severity > SEVERITY_CEIL) severity = SEVERITY_CEIL;

  return {
    shadedSeverity: severity,
    strictnessDelta,
    memoryDelta,
  };
}
