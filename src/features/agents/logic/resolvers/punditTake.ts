// ── resolvers/punditTake.ts ────────────────────────────────────────────────
// Reflection-tier resolver: given a pundit persona + the pundit's recent
// memories + a slate of candidate subjects, decide which subject the
// pundit's next take should land on.
//
// WHY THIS RESOLVER EXISTS
//   Today's pundit takes are evenly distributed in `architect-galaxy-tick`.
//   Phase 6 picks subjects with personality: every pundit has a
//   `specialty` in entities.meta (tactics, transfers, goalkeeping, etc.)
//   and recent memories surface entities they've recently named.  This
//   resolver picks the candidate subject with the highest fit so Rex
//   Valorum (tactics specialist) keeps gravitating toward tactics
//   stories, Crag Montoya (defending specialist) keeps eyeing
//   defensive performances, etc.
//
// PURE MODULE — no React, no Supabase, no LLM, no Math.random.
//
// DESIGN ALIGNMENT
//   Mirrors `journalistStoryPick.ts` deliberately so both reflection-
//   tier resolvers share scoring vocabulary and feel like the same
//   system to anyone reading the code.  The differences:
//     - Pundits work over SUBJECTS (entities, storylines), not stories.
//     - Specialty replaces "beat" as the primary fit signal.
//     - "Memory" overlap measures how often this pundit has already
//       opined about the subject (negative weighting — pundits don't
//       want to repeat themselves on consecutive days).

import type { MemoryRow, PersonaRow } from '../../types';

// ── Tuning constants ────────────────────────────────────────────────────────

/** Score added when the candidate matches the pundit's specialty. */
const SPECIALTY_BONUS = 18;

/** Score added per recent memory linking this pundit to the subject. */
const FAMILIARITY_BONUS = 3;

/** Score SUBTRACTED per recent take this pundit has already given on the subject. */
const REPETITION_PENALTY = 8;

/** Memory fact_kind that records the pundit's own past takes. */
const TAKE_FACT_KIND = 'gave_take_on';

/** Score added per candidate based on recency of the underlying event. */
const RECENCY_BONUS = 5;

/** Half-life in days for the recency boost (7 days). */
const RECENCY_DAYS = 7;

// ── Types ──────────────────────────────────────────────────────────────────

/** A single candidate subject the pundit could opine on. */
export interface PunditTakeCandidate {
  /** Stable identifier for the subject — entity_id, match id, storyline tag. */
  id: string;
  /** Specialty tag of the subject (e.g. 'tactics', 'goalkeeping'). */
  specialty: string;
  /** ISO timestamp the underlying event occurred. */
  occurredAt: string;
  /** Entity ids the subject involves; drives familiarity / repetition scoring. */
  involvedEntityIds: readonly string[];
  /** Optional label for the result.reason; unused for scoring. */
  label?: string;
}

/** Inputs to the pundit take-pick decision. */
export interface PunditTakeContext {
  /** Candidate subjects from which the pundit will pick one. */
  candidates: readonly PunditTakeCandidate[];
  /** Wall clock used by recency decay; injectable for tests. */
  now?: Date;
}

/** Outputs of the decision. */
export interface PunditTakeResult {
  /** The chosen subject; null if no candidates were supplied. */
  chosen: PunditTakeCandidate | null;
  /** Score the chosen candidate received (debugging + telemetry). */
  score: number;
  /** Short explanation suitable for the narrative feed. */
  reason: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolve the pundit's specialty from the persona's goals — Phase 3
 * factory stores `kind: 'defend_specialty', target: 'self'` as a generic
 * marker.  The actual specialty string is held in entities.meta and is
 * expected to land in the persona via a future migration; for v1 we
 * accept it via a goal of kind `specialty:<name>` when present.
 *
 * @param persona  The pundit's persona row.
 * @returns        Specialty string or null when no goal carries it.
 */
function readSpecialty(persona: PersonaRow): string | null {
  const goals = persona.goals as Array<{ kind?: string; target?: string }> | null;
  if (!Array.isArray(goals)) return null;
  for (const g of goals) {
    if (typeof g.kind === 'string' && g.kind.startsWith('specialty:')) {
      return g.kind.slice('specialty:'.length);
    }
  }
  return null;
}

/**
 * Count familiarity — memories whose subjects overlap the candidate's
 * involved entities AND are NOT past-take rows (those count against,
 * see {@link repetitionCount}).
 *
 * @param memories                Pundit's memory rows.
 * @param involvedEntityIds       Entity ids the candidate references.
 * @returns                       Non-negative integer (capped at 5).
 */
function familiarityCount(
  memories: readonly MemoryRow[],
  involvedEntityIds: readonly string[],
): number {
  if (involvedEntityIds.length === 0) return 0;
  const involvedSet = new Set(involvedEntityIds);
  let count = 0;
  for (const m of memories) {
    if (m.fact_kind === TAKE_FACT_KIND) continue;
    if (m.subjects.some((s) => involvedSet.has(s))) {
      count += 1;
      if (count >= 5) return 5;
    }
  }
  return count;
}

/**
 * Count repetition — memories of kind `gave_take_on` whose subjects
 * overlap the candidate.  Each prior take incurs REPETITION_PENALTY so
 * a pundit who already opined on a subject today is unlikely to repeat.
 *
 * @param memories                Pundit's memory rows.
 * @param involvedEntityIds       Entity ids the candidate references.
 * @returns                       Non-negative integer (capped at 3).
 */
function repetitionCount(
  memories: readonly MemoryRow[],
  involvedEntityIds: readonly string[],
): number {
  if (involvedEntityIds.length === 0) return 0;
  const involvedSet = new Set(involvedEntityIds);
  let count = 0;
  for (const m of memories) {
    if (m.fact_kind !== TAKE_FACT_KIND) continue;
    if (m.subjects.some((s) => involvedSet.has(s))) {
      count += 1;
      if (count >= 3) return 3;
    }
  }
  return count;
}

/**
 * Same recency function used by `journalistStoryPick.ts`.  Duplicated
 * deliberately rather than shared — the resolvers stay self-contained
 * so each can be unit-tested in isolation.  If a third resolver also
 * needs this, hoist it into a shared `resolvers/util.ts`.
 *
 * @param occurredAt  Candidate's event timestamp (ISO string).
 * @param now         Wall clock.
 * @returns           Float in [0,1].
 */
function recencyWeight(occurredAt: string, now: Date): number {
  const occurredMs = Date.parse(occurredAt);
  if (!Number.isFinite(occurredMs)) return 0;
  const ageDays = Math.max(0, (now.getTime() - occurredMs) / (1000 * 60 * 60 * 24));
  return Math.exp(-ageDays / RECENCY_DAYS);
}

// ── Resolver ───────────────────────────────────────────────────────────────

/**
 * Pick the candidate subject that best fits this pundit's persona +
 * recent take history.  Specialty match dominates; familiarity boosts
 * subjects the pundit has been tracking; repetition penalises subjects
 * they've already covered.
 *
 * @param persona   Pundit's persona row.
 * @param memories  Pundit's recent memory rows.
 * @param context   Slate of candidate subjects + wall clock.
 * @returns         Best-fit chosen subject + score + reason text.
 */
export function resolvePunditTake(
  persona: PersonaRow,
  memories: readonly MemoryRow[],
  context: PunditTakeContext,
): PunditTakeResult {
  if (context.candidates.length === 0) {
    return { chosen: null, score: 0, reason: 'No subjects on the radar today.' };
  }
  const now = context.now ?? new Date();
  const specialty = readSpecialty(persona);

  let best: PunditTakeCandidate | null = null;
  let bestScore = -Infinity;
  let bestReason = '';

  for (const candidate of context.candidates) {
    let score = 0;
    const reasons: string[] = [];

    if (specialty && candidate.specialty === specialty) {
      score += SPECIALTY_BONUS;
      reasons.push(`right in their wheelhouse (${specialty})`);
    }

    const familiarity = familiarityCount(memories, candidate.involvedEntityIds);
    if (familiarity > 0) {
      score += familiarity * FAMILIARITY_BONUS;
      reasons.push(`${familiarity} prior touchpoint${familiarity === 1 ? '' : 's'}`);
    }

    const repetition = repetitionCount(memories, candidate.involvedEntityIds);
    if (repetition > 0) {
      score -= repetition * REPETITION_PENALTY;
      reasons.push(`already opined ${repetition} time${repetition === 1 ? '' : 's'}`);
    }

    const recency = recencyWeight(candidate.occurredAt, now);
    score += recency * RECENCY_BONUS;
    if (recency > 0.7) reasons.push('fresh');

    if (score > bestScore) {
      best = candidate;
      bestScore = score;
      bestReason = reasons.length === 0
        ? 'no strong angle; took the first decent storyline'
        : reasons.join('; ');
    }
  }

  return {
    chosen: best,
    score: best ? bestScore : 0,
    reason: bestReason || 'no strong angle; took the first decent storyline',
  };
}
