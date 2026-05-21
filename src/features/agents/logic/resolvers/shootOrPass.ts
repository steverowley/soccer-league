// ── resolvers/shootOrPass.ts ────────────────────────────────────────────────
// Reflex-tier resolver: in-match, sub-second.  Given an attacking player's
// persona + their memories of the opposing keeper, returns a probability
// weight for choosing shoot over pass.
//
// WHY THIS RESOLVER EXISTS
//   `gameEngine.js` already chooses between shoot/pass via personality
//   archetypes (PERS.AGG / PERS.CRE etc.).  Phase 8 of the agent plan
//   formalises that decision against the unified persona + memory
//   substrate so a striker who has scored hat-tricks against a specific
//   keeper genuinely *likes* shooting at them — and a striker who has
//   missed twice against the same keeper *hesitates*.
//
// PURE MODULE — no React, no Supabase, no LLM, NO Math.random.  The
// resolver returns a *probability weight* (0..1); the caller (the engine
// or its test harness) combines it with the existing stat-based weights.
// Keeping Math.random in the engine preserves the seeded-LCG smoke test
// in `src/gameEngine.smoke.test.ts`.
//
// IN-MATCH HOT PATH
//   This is the FIRST resolver intentionally designed for the sub-second
//   call cadence the engine demands.  It deliberately runs in-memory:
//   the caller hydrates persona + memories via `prepareCorpusForMatch`
//   (a future Phase 8 helper, scoped to follow this PR) once per match,
//   and the in-match loop calls the resolver synchronously.  No DB
//   reads from this module.

import type { MemoryRow, PersonaRow } from '../../types';

// ── Tuning constants ────────────────────────────────────────────────────────
// All values are arbitrary but tuned so personality + memory together
// can shift the shoot/pass weight by ~30 percentage points around the
// neutral 0.5 anchor — meaningful in-match impact without dominating
// the engine's stat-based math.

/** Neutral anchor — a persona-blind player picks shoot vs pass equally. */
const NEUTRAL_WEIGHT = 0.5;

/** Maximum absolute deviation from neutral the resolver may apply. */
const MAX_DELTA = 0.30;

/** Fraction of MAX_DELTA contributed by Big-Five extraversion (boldness proxy). */
const EXTRAVERSION_CONTRIBUTION = 0.4;

/** Fraction of MAX_DELTA contributed by Big-Five conscientiousness (caution proxy). */
const CONSCIENTIOUSNESS_CONTRIBUTION = 0.2;

/** Fraction of MAX_DELTA contributed by per-keeper memory grudges. */
const MEMORY_CONTRIBUTION = 0.4;

/**
 * Memory fact_kinds that count toward the shooter's confidence against
 * THIS keeper.  Positive memories add to the shoot weight; negative
 * memories subtract.
 */
const POSITIVE_MEMORY_KINDS = new Set(['scored_on', 'saw_keeper_falter']);
const NEGATIVE_MEMORY_KINDS = new Set(['was_saved', 'missed_target']);

/**
 * Per-memory weight before scaling.  Counts are clamped to 5 either way
 * so the memory term saturates rather than running away.
 */
const MEMORY_PER_HIT = 0.2;

// ── Context type ────────────────────────────────────────────────────────────

/**
 * Context for the shoot-or-pass decision.  The caller passes the
 * opposing keeper's entity_id so the resolver can filter memories down
 * to "what does this striker remember about THIS keeper".
 */
export interface ShootOrPassContext {
  /** Entity id of the opposing keeper. */
  keeperEntityId: string;
}

/** Result: a probability weight in [0,1] plus the components for debugging. */
export interface ShootOrPassResult {
  /** Final shoot weight, clamped to [NEUTRAL_WEIGHT-MAX_DELTA, NEUTRAL_WEIGHT+MAX_DELTA]. */
  shootWeight: number;
  /** Component contribution from Big-Five axes (signed). */
  personalityDelta: number;
  /** Component contribution from memory tally (signed). */
  memoryDelta: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Safely read a Big-Five axis float from the persona's JSONB vector.
 * Falls back to 0.5 when the shape isn't what we expect — keeps the
 * resolver well-behaved against legacy / partially-seeded personas.
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
 * Compute the net memory delta for the striker against THIS keeper.
 * Positive memories raise shoot weight; negative memories lower it.
 *
 * @param memories         Striker's memory rows.
 * @param keeperEntityId   Entity id of the opposing keeper.
 * @returns                Signed delta in [-1,1].
 */
function memoryTally(
  memories: readonly MemoryRow[],
  keeperEntityId: string,
): number {
  let net = 0;
  let positives = 0;
  let negatives = 0;
  for (const m of memories) {
    if (!m.subjects.includes(keeperEntityId)) continue;
    if (POSITIVE_MEMORY_KINDS.has(m.fact_kind)) positives += 1;
    if (NEGATIVE_MEMORY_KINDS.has(m.fact_kind)) negatives += 1;
  }
  // Cap each side at 5 before differencing so a 20-memory pile doesn't
  // overwhelm the personality term.
  positives = Math.min(5, positives);
  negatives = Math.min(5, negatives);
  net = (positives - negatives) * MEMORY_PER_HIT;
  return Math.max(-1, Math.min(1, net));
}

// ── Resolver ───────────────────────────────────────────────────────────────

/**
 * Compute the striker's shoot probability weight for an in-match
 * decision against the supplied keeper.
 *
 * Combines two signals into a single weight in
 * `[NEUTRAL_WEIGHT - MAX_DELTA, NEUTRAL_WEIGHT + MAX_DELTA]`:
 *
 *   - Personality: high extraversion pushes toward shoot; high
 *     conscientiousness pulls toward pass (the cautious shot-selector).
 *     Both centred on 0.5 so a neutral persona contributes zero delta.
 *   - Memory: positive memories against this specific keeper add, negative
 *     memories subtract.  Capped via MEMORY_PER_HIT × clamp-5.
 *
 * Returns the final weight + the two component deltas so callers can
 * log "why did this happen" telemetry without rerunning the math.
 *
 * @param persona   The striker's persona row.
 * @param memories  The striker's loaded memory rows (1-hop subjects only).
 * @param context   Match-time context — the opposing keeper id.
 * @returns         Shoot weight in [0.2,0.8] + component contributions.
 */
export function resolveShootOrPass(
  persona: PersonaRow,
  memories: readonly MemoryRow[],
  context: ShootOrPassContext,
): ShootOrPassResult {
  // ── Personality delta ─────────────────────────────────────────────────
  // Extraversion above 0.5 → bold; below → cautious.  Conscientiousness
  // above 0.5 → restrained (pulls toward pass).  Both anchored on 0.5
  // so a fully neutral persona contributes zero.
  const extraversion = bigFive(persona, 'extraversion');
  const conscientiousness = bigFive(persona, 'conscientiousness');

  const extDelta = (extraversion - 0.5) * 2 * MAX_DELTA * EXTRAVERSION_CONTRIBUTION;
  const conDelta = -(conscientiousness - 0.5) * 2 * MAX_DELTA * CONSCIENTIOUSNESS_CONTRIBUTION;
  const personalityDelta = extDelta + conDelta;

  // ── Memory delta ─────────────────────────────────────────────────────
  const memoryRaw = memoryTally(memories, context.keeperEntityId);
  const memoryDelta = memoryRaw * MAX_DELTA * MEMORY_CONTRIBUTION;

  // ── Combine + clamp ──────────────────────────────────────────────────
  let weight = NEUTRAL_WEIGHT + personalityDelta + memoryDelta;
  const lower = NEUTRAL_WEIGHT - MAX_DELTA;
  const upper = NEUTRAL_WEIGHT + MAX_DELTA;
  if (weight < lower) weight = lower;
  if (weight > upper) weight = upper;

  return {
    shootWeight: weight,
    personalityDelta,
    memoryDelta,
  };
}
