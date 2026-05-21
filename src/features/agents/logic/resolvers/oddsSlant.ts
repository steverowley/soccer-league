// ── resolvers/oddsSlant.ts ──────────────────────────────────────────────────
// Reflection-tier resolver: given a bookie persona, decide how to slant
// the canonical odds for a specific match.
//
// WHY THIS RESOLVER EXISTS
//   Today's odds come from a pure mathematical function in
//   `src/features/betting/logic/odds.ts`.  Phase 6 of the agent plan
//   layers personality on top: the same canonical mathematical odds
//   get *nudged* by the bookie's mood (personality_vec.bigFive.openness
//   for risk appetite, .neuroticism for caution) and by grudges against
//   specific teams encoded in entity_memories.  The result feels alive —
//   "Crooked-Eye Otho is short on Vesta; he doesn't like the way the
//   rocks were rolling this morning" — without abandoning the math
//   anchor.
//
// PURE MODULE — no React, no Supabase, no Math.random.  Deterministic
// given the inputs.  Caller is responsible for loading persona +
// memories.
//
// COST DISCIPLINE
//   The slant is bounded by MAX_SLANT_FRACTION so a bookie's mood
//   can never invert the favourite/underdog relationship — just shift
//   it within a believable band.

import type { MemoryRow, PersonaRow } from '../../types';

// ── Tuning constants ────────────────────────────────────────────────────────
// All values are arbitrary but tuned so a "moodiest possible" bookie
// slants the home implied probability by at most 8 percentage points.
// Each input contributes a fraction of that band.

/** Maximum delta applied to the home implied probability (8 percentage points). */
const MAX_SLANT_FRACTION = 0.08;

/** Fraction of MAX_SLANT_FRACTION contributed by the bookie's mood axes. */
const MOOD_CONTRIBUTION = 0.5;

/** Fraction of MAX_SLANT_FRACTION contributed by team-specific memory grudges. */
const GRUDGE_CONTRIBUTION = 0.5;

/**
 * Memory fact_kinds that count as a grudge signal toward a team.  Each
 * matching memory adds 1 to the team's grudge score before scaling.
 */
const GRUDGE_FACT_KINDS = new Set([
  'wager_lost_on_them', // bookie remembers paying out heavily on this team
  'price_crashed',      // odds collapsed unexpectedly — heavy money moved
  'inside_money',       // suspected informed bets on this team
]);

// ── Context type ────────────────────────────────────────────────────────────

/**
 * Inputs to the odds-slant decision: the canonical odds the mathematical
 * pipeline produced + the two team ids in the match.  Caller passes the
 * already-computed home/draw/away implied probabilities (which sum to 1
 * before margin) so the resolver only deals with the slant delta.
 */
export interface OddsSlantContext {
  /** Slug of the home team. */
  homeTeamId: string;
  /** Slug of the away team. */
  awayTeamId: string;
  /** Canonical home implied probability before personality slant (0..1). */
  canonicalHomeProb: number;
  /** Canonical draw implied probability before personality slant (0..1). */
  canonicalDrawProb: number;
  /** Canonical away implied probability before personality slant (0..1). */
  canonicalAwayProb: number;
}

/**
 * Output of the odds-slant decision: the slanted implied probabilities
 * (still summing to the same total as input — slants redistribute
 * between home and away, never altering the draw band) and a short
 * explanation suitable for use in a narrative.
 */
export interface OddsSlantResult {
  /** Slanted home implied probability. */
  homeProb: number;
  /** Draw probability — passed through unchanged in v1. */
  drawProb: number;
  /** Slanted away implied probability. */
  awayProb: number;
  /** Net slant in home's favour (positive = bookie favoured home). */
  homeDelta: number;
  /** Human-readable summary suitable for the narrative feed. */
  reason: string;
}

// ── Pure helpers ────────────────────────────────────────────────────────────

/**
 * Read a Big-Five axis from the persona's personality_vec.  Defensive
 * about shape since the column is jsonb — anything that isn't a number
 * falls back to the neutral 0.5 default.
 *
 * @param persona  The persona row whose vector to inspect.
 * @param axis     The Big-Five axis name (e.g. 'openness').
 * @returns        Float in [0,1].
 */
function bigFive(persona: PersonaRow, axis: string): number {
  const vec = persona.personality_vec as { bigFive?: Record<string, unknown> } | null;
  const value = vec?.bigFive?.[axis];
  return typeof value === 'number' ? Math.max(0, Math.min(1, value)) : 0.5;
}

/**
 * Count grudge-relevant memories the bookie holds about a specific team.
 * "About" here means the team_id appears in the memory's payload (since
 * subjects holds entity_id UUIDs while team identifiers are slugs).
 *
 * @param memories  The bookie's relevant memory rows.
 * @param teamId    Team slug to count grudges against.
 * @returns         Non-negative integer; capped at 5 to bound the slant.
 */
function grudgeCount(memories: readonly MemoryRow[], teamId: string): number {
  let count = 0;
  for (const m of memories) {
    if (!GRUDGE_FACT_KINDS.has(m.fact_kind)) continue;
    const payload = m.payload as { homeTeamId?: string; awayTeamId?: string; teamId?: string } | null;
    if (!payload) continue;
    if (
      payload.teamId === teamId ||
      payload.homeTeamId === teamId ||
      payload.awayTeamId === teamId
    ) {
      count += 1;
    }
  }
  return Math.min(5, count);
}

// ── Resolver ────────────────────────────────────────────────────────────────

/**
 * Compute the bookie's personality-shaded odds slant.
 *
 * Mood logic (MOOD_CONTRIBUTION of total slant):
 *   - High openness (>0.5)   → bookie is risk-tolerant; slants AGAINST
 *                              the home team (giving the longer odds the
 *                              friendlier price).
 *   - Low openness (<0.5)    → risk-averse; slants TOWARD home (protects
 *                              the side the public is more likely to back).
 *   - Neuroticism amplifies whichever direction the openness implies.
 *
 * Grudge logic (GRUDGE_CONTRIBUTION):
 *   - Every grudge memory against the home team adds a small negative
 *     slant to home's probability (bookie distrusts the side, lengthens
 *     their price).  Mirror for away.
 *
 * The final home delta is clamped to ±MAX_SLANT_FRACTION so a single
 * persona can't invert the favourite/underdog relationship.
 *
 * @param persona   The bookie's persona row.
 * @param memories  Memories the bookie holds.
 * @param context   Match identifiers + canonical odds.
 * @returns         Slanted odds + a short reason for narrative use.
 */
export function resolveOddsSlant(
  persona: PersonaRow,
  memories: readonly MemoryRow[],
  context: OddsSlantContext,
): OddsSlantResult {
  // Mood-driven slant.  Openness maps to risk appetite; neuroticism
  // amplifies the magnitude.  Both centred on 0.5 so a neutral persona
  // produces zero slant.
  const openness = bigFive(persona, 'openness');
  const neuroticism = bigFive(persona, 'neuroticism');
  const moodSign = openness > 0.5 ? -1 : openness < 0.5 ? 1 : 0;
  const moodMagnitude = Math.abs(openness - 0.5) * 2 * (0.5 + neuroticism / 2);
  const moodSlant = moodSign * moodMagnitude * MAX_SLANT_FRACTION * MOOD_CONTRIBUTION;

  // Grudge-driven slant.  Each side gets counted independently; the net
  // delta is awayGrudges - homeGrudges (more grudge against home = home
  // probability drops).
  const homeGrudge = grudgeCount(memories, context.homeTeamId);
  const awayGrudge = grudgeCount(memories, context.awayTeamId);
  // Each grudge contributes 1/5 of the GRUDGE_CONTRIBUTION cap (since
  // grudgeCount is bounded at 5).  Signed: +ve = bookie favours home.
  const grudgeSlant =
    ((awayGrudge - homeGrudge) / 5) * MAX_SLANT_FRACTION * GRUDGE_CONTRIBUTION;

  // Combine + clamp.  We move probability between home and away; draw
  // stays untouched in v1 (most bookie moods don't change the draw line).
  let homeDelta = moodSlant + grudgeSlant;
  if (homeDelta > MAX_SLANT_FRACTION) homeDelta = MAX_SLANT_FRACTION;
  if (homeDelta < -MAX_SLANT_FRACTION) homeDelta = -MAX_SLANT_FRACTION;

  const homeProb = Math.max(0.01, Math.min(0.99, context.canonicalHomeProb + homeDelta));
  const awayProb = Math.max(0.01, Math.min(0.99, context.canonicalAwayProb - homeDelta));
  const drawProb = context.canonicalDrawProb; // pass-through

  const reason = buildReason(context, homeDelta, openness, homeGrudge, awayGrudge);

  return {
    homeProb,
    drawProb,
    awayProb,
    homeDelta,
    reason,
  };
}

/**
 * Compose a short English explanation of why the slant was applied.
 * Kept tiny so the caller can drop it into a narrative line without
 * post-processing.
 *
 * @param context     Match identifiers + canonical odds.
 * @param homeDelta   Signed slant magnitude.
 * @param openness    Bookie's openness axis (mood proxy).
 * @param homeGrudge  Grudge count against the home team.
 * @param awayGrudge  Grudge count against the away team.
 * @returns           One-line summary.
 */
function buildReason(
  context: OddsSlantContext,
  homeDelta: number,
  openness: number,
  homeGrudge: number,
  awayGrudge: number,
): string {
  const direction = homeDelta > 0.005 ? 'home' : homeDelta < -0.005 ? 'away' : 'neutral';
  const moodLabel = openness > 0.5 ? 'risk-tolerant' : openness < 0.5 ? 'cautious' : 'level';

  if (direction === 'neutral') {
    return `Bookie ${moodLabel} on this fixture; the price holds.`;
  }
  const grudgeText =
    homeGrudge > awayGrudge
      ? `recent results against ${context.homeTeamId} have left a mark`
      : awayGrudge > homeGrudge
        ? `the book is short on ${context.awayTeamId} from earlier business`
        : `the mood says so`;
  return `Bookie ${moodLabel}; the price leans ${direction} — ${grudgeText}.`;
}
