// ── resolvers/journalistStoryPick.ts ───────────────────────────────────────
// Reflection-tier resolver: given a journalist persona + the journalist's
// recent memories + a slate of candidate stories, decide which story is
// the best fit for THIS reporter to cover.
//
// WHY THIS RESOLVER EXISTS
//   Today's Galaxy Dispatch picks journalists round-robin and assigns
//   them arbitrary recent matches.  Phase 6 layers personality on top:
//   each journalist has a `beat` in entities.meta (e.g. 'rocky-inner',
//   'transfers', 'referee_controversy') and their recent memories
//   surface sources they're cultivating.  This resolver picks the
//   candidate story with the highest fit score so coverage starts to
//   feel like real journalism — Iris Volkov covers Mars matches, Sol
//   Petrov chases Architect rumours, etc.
//
// PURE MODULE — no React, no Supabase, no LLM, no Math.random.
//
// SCORING
//   For each candidate story, score = BEAT_BONUS (if the story matches
//   the journalist's beat) + SOURCE_BONUS (per relevant memory subject)
//   + RECENCY_BONUS (newer stories preferred).  The highest-scoring
//   candidate wins; ties broken by candidate order.

import type { MemoryRow, PersonaRow } from '../../types';

// ── Tuning constants ────────────────────────────────────────────────────────
// Weights are arbitrary but tuned so:
//   - A beat match dominates a generic recency boost (a Mars journalist
//     prefers a Mars match even if the only Mars story is from yesterday).
//   - Per-source-match (memory references an entity in the candidate) is
//     worth ~half a beat match — sources matter but beat matters more.
//   - Recency is a tiebreaker, not the main signal.

/** Score added when the candidate's beat tag matches the journalist's beat. */
const BEAT_BONUS = 20;

/** Score added per memory whose subjects overlap the candidate's involved entities. */
const SOURCE_BONUS = 4;

/** Score added per candidate based on recency (exponential decay over RECENCY_DAYS). */
const RECENCY_BONUS = 6;

/** Half-life in days for the recency boost — 7 means a week-old story scores ~50% recency. */
const RECENCY_DAYS = 7;

// ── Types ──────────────────────────────────────────────────────────────────

/** One candidate story the dispatcher offers for selection. */
export interface JournalistStoryCandidate {
  /** Stable identifier — match UUID, narrative UUID, etc. */
  id: string;
  /** Beat tag of the story (e.g. 'rocky-inner', 'transfers', 'general'). */
  beat: string;
  /** ISO timestamp the underlying event occurred. */
  occurredAt: string;
  /** Entity ids the story already mentions — drives source-bonus matching. */
  involvedEntityIds: readonly string[];
  /** Optional human label for the result.reason; unused for scoring. */
  label?: string;
}

/** Inputs to the journalist story-pick decision. */
export interface JournalistStoryPickContext {
  /** Candidate stories from which the journalist will pick one. */
  candidates: readonly JournalistStoryCandidate[];
  /** Wall clock used by recency decay; injectable for tests. */
  now?: Date;
}

/** Outputs of the decision. */
export interface JournalistStoryPickResult {
  /** The chosen candidate; null if the candidate list was empty. */
  chosen: JournalistStoryCandidate | null;
  /** Score the chosen candidate received (debugging + telemetry). */
  score: number;
  /** Short explanation suitable for the narrative feed. */
  reason: string;
}

// ── Score helpers ──────────────────────────────────────────────────────────

/**
 * Resolve the journalist's beat from the persona's goals (where the
 * Phase 3 factory stores `kind: 'break_story', target: 'self'`) plus
 * the entity-meta fallback the dispatcher passes in via persona.goals
 * — for now we read goals and fall back to a generic beat.
 *
 * Phase 6 limitation: the Phase 3 factory doesn't record the journalist's
 * beat into the persona row (it's still in entities.meta).  The caller
 * passes the beat via a goal of kind `beat:<name>` when one exists.
 *
 * @param persona  The journalist's persona row.
 * @returns        The beat string, or null when no beat goal is found.
 */
function readBeat(persona: PersonaRow): string | null {
  const goals = persona.goals as Array<{ kind?: string; target?: string }> | null;
  if (!Array.isArray(goals)) return null;
  for (const g of goals) {
    if (typeof g.kind === 'string' && g.kind.startsWith('beat:')) {
      return g.kind.slice('beat:'.length);
    }
  }
  return null;
}

/**
 * Count memories whose subjects overlap the candidate's involved
 * entities.  Each overlap counts ONCE per memory regardless of how
 * many subject ids overlap — keeps the bonus linear in memory count.
 *
 * @param memories                Journalist's memories.
 * @param involvedEntityIds       Entity ids the candidate already mentions.
 * @returns                       Non-negative integer; capped at 5.
 */
function sourceOverlapCount(
  memories: readonly MemoryRow[],
  involvedEntityIds: readonly string[],
): number {
  if (involvedEntityIds.length === 0) return 0;
  const involvedSet = new Set(involvedEntityIds);
  let count = 0;
  for (const m of memories) {
    if (m.subjects.some((s) => involvedSet.has(s))) {
      count += 1;
      if (count >= 5) return 5;
    }
  }
  return count;
}

/**
 * Exponential recency decay using the configured RECENCY_DAYS half-life.
 * Older-than-now timestamps decay; future timestamps score 1 (defensive).
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
 * Choose the candidate story that best fits this journalist's persona +
 * memory state.
 *
 * @param persona   Journalist's persona row.
 * @param memories  Journalist's recent memories.
 * @param context   Slate of candidate stories.
 * @returns         Best-fit chosen story + score + reason text.
 */
export function resolveJournalistStoryPick(
  persona: PersonaRow,
  memories: readonly MemoryRow[],
  context: JournalistStoryPickContext,
): JournalistStoryPickResult {
  if (context.candidates.length === 0) {
    return { chosen: null, score: 0, reason: 'No candidate stories on the wire.' };
  }
  const now = context.now ?? new Date();
  const beat = readBeat(persona);

  let best: JournalistStoryCandidate | null = null;
  let bestScore = -Infinity;
  let bestReason = '';

  for (const candidate of context.candidates) {
    let score = 0;
    const reasons: string[] = [];

    if (beat && candidate.beat === beat) {
      score += BEAT_BONUS;
      reasons.push(`on-beat (${beat})`);
    }

    const sources = sourceOverlapCount(memories, candidate.involvedEntityIds);
    if (sources > 0) {
      score += sources * SOURCE_BONUS;
      reasons.push(`${sources} cultivated source${sources === 1 ? '' : 's'}`);
    }

    const recency = recencyWeight(candidate.occurredAt, now);
    score += recency * RECENCY_BONUS;
    if (recency > 0.7) reasons.push('still fresh');

    if (score > bestScore) {
      best = candidate;
      bestScore = score;
      bestReason = reasons.length === 0
        ? 'slow news day; took what the wire offered'
        : reasons.join('; ');
    }
  }

  return {
    chosen: best,
    score: best ? bestScore : 0,
    reason: bestReason || 'slow news day; took what the wire offered',
  };
}
