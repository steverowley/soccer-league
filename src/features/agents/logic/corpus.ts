// ── features/agents/logic/corpus.ts ─────────────────────────────────────────
// Pure retrieval engine for the voice corpus.  Given a candidate pool of
// snippets (already loaded by `api/snippets.listSnippetsForEntity`), this
// module filters and scores them to choose the best match for a request.
//
// PURE MODULE — no React, no Supabase, no I/O.  The DB read happens in
// api/snippets.ts; the picker takes the resulting array and does the
// scoring math.  Keeping the scoring pure means it's trivially testable
// with hand-built snippet arrays and the entire match hot-path (Phase 8)
// can call this synchronously after `prepareCorpusForMatch()` hydration.
//
// SCORING MODEL
//   Score = (tag_overlap × W_TAG)
//         + (recency_boost × W_RECENCY)
//         + (novelty_boost × W_NOVELTY)
//         + (valence_match × W_VALENCE)
//         + (pinned ? PIN_BONUS : 0)
//
//   The W_* weights below are tuned so:
//     - A snippet that matches every requested tag dominates one that
//       matches none.
//     - Two snippets that match the same tags fall back to recency +
//       novelty to break the tie (fresh, rarely-used snippets win).
//     - Pinned snippets get a small boost so hand-curated lines surface
//       when nothing better exists.
//
// FALLBACK
//   When NO snippet passes the entity+kind filter, return null.  The
//   caller decides whether to (a) emit a `corpus_miss` to `agent_runs`
//   and trigger enrichment, or (b) fall back to a template.

import type {
  PickSnippetArgs,
  PickSnippetResult,
  SnippetRow,
} from '../types';

// ── Scoring weights ─────────────────────────────────────────────────────────
// All weights are in arbitrary units — only their RELATIVE magnitudes
// matter.  The values below produce a sensible ordering for the seeded
// corpus tested in corpus.test.ts.  If the picker starts favouring stale
// snippets in production, raise W_RECENCY; if it gets stuck repeating
// the same line, raise W_NOVELTY.

/** Tag-overlap weight.  One matching tag adds W_TAG; two add 2×W_TAG. */
const W_TAG = 10;

/** Recency-boost weight.  Multiplied by an exponential decay over days. */
const W_RECENCY = 4;

/** Novelty-boost weight.  Multiplied by 1/(1+usage_count). */
const W_NOVELTY = 5;

/** Valence-match weight.  Awarded only when `preferValence` is set + matches. */
const W_VALENCE = 3;

/** Flat bonus for `pinned=true` snippets. */
const PIN_BONUS = 2;

/**
 * Days after which the recency boost decays to ~37% (1/e).  Picked at 30
 * so a snippet from "last month" still has appreciable recency weight; a
 * snippet from a year ago is effectively recency-neutral.
 */
const RECENCY_HALF_LIFE_DAYS = 30;

// ── Pure scoring ────────────────────────────────────────────────────────────

/**
 * Compute the picker score for one snippet against a request.  Exported
 * for unit testing the scoring math directly; production callers should
 * use {@link pickSnippet} which filters + scores in one pass.
 *
 * @param snippet  The candidate snippet row.
 * @param args     The request the snippet is being scored for.
 * @param now      Wall-clock to compare against `last_used_at` / `created_at`.
 *                 Injected so tests can pin time.
 * @returns        Numeric score; higher is better.
 */
export function scoreSnippet(
  snippet: SnippetRow,
  args: PickSnippetArgs,
  now: Date = new Date(),
): number {
  let score = 0;

  // ── Tag overlap ────────────────────────────────────────────────────────
  // Each requested tag found in the snippet's context_tags adds W_TAG.
  // No requested tags → no tag score contribution (neutral, not negative).
  if (args.contextTags && args.contextTags.length > 0) {
    const snippetTagSet = new Set(snippet.context_tags);
    for (const tag of args.contextTags) {
      if (snippetTagSet.has(tag)) score += W_TAG;
    }
  }

  // ── Recency boost ──────────────────────────────────────────────────────
  // Use `last_used_at` if present (we'd rather not re-serve a fresh pick),
  // else `created_at` (so freshly-generated snippets surface first).
  // Decay is exponential: score = W_RECENCY * exp(-ageDays / HALF_LIFE).
  const referenceISO = snippet.last_used_at ?? snippet.created_at;
  const referenceMs = Date.parse(referenceISO);
  if (Number.isFinite(referenceMs)) {
    const ageDays = (now.getTime() - referenceMs) / (1000 * 60 * 60 * 24);
    if (ageDays >= 0) {
      score += W_RECENCY * Math.exp(-ageDays / RECENCY_HALF_LIFE_DAYS);
    }
  }

  // ── Novelty boost ──────────────────────────────────────────────────────
  // Inverse usage count: never-used = +W_NOVELTY, used 9 times = +W_NOVELTY/10.
  score += W_NOVELTY / (1 + snippet.usage_count);

  // ── Valence preference ────────────────────────────────────────────────
  // Only awarded when caller explicitly opted in via `preferValence` and
  // the snippet matches.  Mismatches don't subtract — they're neutral, so
  // a positive-valence snippet can still be served when negative was
  // preferred but none existed.
  if (typeof args.preferValence === 'number' && snippet.valence === args.preferValence) {
    score += W_VALENCE;
  }

  // ── Pinned bonus ──────────────────────────────────────────────────────
  if (snippet.pinned) score += PIN_BONUS;

  return score;
}

// ── Filtering + selection ───────────────────────────────────────────────────

/**
 * Pure picker: takes the entity's full snippet pool plus the request, and
 * returns the highest-scoring snippet that survives the filters, or null
 * when none does.
 *
 * Filters (all AND-combined):
 *   1. `entity_id` must match `args.entityId`.
 *   2. `kind` must match `args.kind`.
 *   3. If `args.excludeIds` set, the snippet's id must not appear in it.
 *   4. If `args.excludeSubjects` set, none of the snippet's `subjects`
 *      may appear in the exclude list.  Used for session-scope dedup.
 *
 * Snippets that pass the filters are scored via {@link scoreSnippet} and
 * the highest is returned along with its score.  Ties are broken by
 * insertion order (i.e. whichever survives in the natural pool order).
 *
 * @param pool  All snippets the caller has loaded for this entity (typically
 *              from `listSnippetsForEntity`).  Filtering on `entity_id` is
 *              still performed defensively so callers can pass a mixed pool
 *              if needed.
 * @param args  Request parameters.
 * @param now   Wall-clock for recency math (defaults to `new Date()`).
 * @returns     `{snippet, score}` of the best candidate, or null on miss.
 */
export function pickSnippet(
  pool: readonly SnippetRow[],
  args: PickSnippetArgs,
  now: Date = new Date(),
): PickSnippetResult | null {
  const excludeIdSet = new Set(args.excludeIds ?? []);
  const excludeSubjectSet = new Set(args.excludeSubjects ?? []);

  let best: PickSnippetResult | null = null;

  for (const snippet of pool) {
    // Filter — fail fast on cheap checks first.
    if (snippet.entity_id !== args.entityId) continue;
    if (snippet.kind !== args.kind) continue;
    if (excludeIdSet.has(snippet.id)) continue;
    if (excludeSubjectSet.size > 0) {
      const subjectClash = snippet.subjects.some((s) => excludeSubjectSet.has(s));
      if (subjectClash) continue;
    }

    // Score + maybe-promote.
    const score = scoreSnippet(snippet, args, now);
    if (best === null || score > best.score) {
      best = { snippet, score };
    }
  }

  return best;
}
