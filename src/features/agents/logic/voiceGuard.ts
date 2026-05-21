// ── features/agents/logic/voiceGuard.ts ─────────────────────────────────────
// Pure module for ingest-time validation of LLM-generated snippets.
// Phase 10 of the Universal Agent System (bd isl-bqx.11): the corpus
// enricher's hallucination guards already check structure + entity
// references; voiceGuard adds the VOICE-COHERENCE check.
//
// WHY THIS MODULE EXISTS
//   Phase 5's `corpus-enricher` calls Haiku per-entity with a static
//   persona block (voice_paragraph + core_quotes + lexicon + taboos).
//   Even with that block, the LLM can drift: producing a snippet that
//   reads off-voice, or that contains a substring the persona has
//   forbidden via `taboos`.  voiceGuard catches both before insert.
//
// CHEAP DRIFT MEASURE — bag-of-words cosine similarity
//   We deliberately AVOID dependencies on an ML embedding model.  The
//   cheap bag-of-words cosine is good enough at the snippet length we
//   produce (1-3 sentences) and runs entirely in-process.  Score
//   compares the candidate text against a reference corpus assembled
//   from `persona.core_quotes` + `persona.lexicon`.
//
// PURE MODULE — no React, no Supabase, no LLM, no I/O.  Tests directly.

import type { PersonaRow } from '../types';

// ── Tuning constants ────────────────────────────────────────────────────────

/**
 * Minimum cosine similarity (0..1) a candidate must achieve against the
 * persona reference to pass the drift gate.  Tuned at 0.08 — high enough
 * to catch obviously alien outputs (random topic, totally different
 * register) but low enough to admit short snippets that share only a
 * handful of words with the anchor corpus.
 *
 * If the enricher's hit-rate ever climbs to "everything passes", raise
 * this constant.  If post-deploy spot-checks show wrongly-rejected
 * good snippets, lower it (or special-case via a per-persona override).
 */
export const DRIFT_MIN_COSINE = 0.08;

/**
 * Minimum reference token count for a *meaningful* drift check.  When a
 * persona has fewer than this many distinct tokens in core_quotes +
 * lexicon (e.g. fresh-seeded entities), we SKIP the drift check and
 * rely on taboo enforcement alone — otherwise every snippet would fail.
 */
const MIN_REFERENCE_TOKENS = 12;

/**
 * Stopwords excluded from both the candidate's and the reference's
 * token bag.  Keeping the lists short — only the highest-frequency
 * function words — so domain-specific terms always count.
 */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'it', 'in', 'on', 'at',
  'of', 'to', 'for', 'from', 'with', 'by', 'as', 'be', 'been', 'was',
  'were', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she',
  'we', 'they', 'his', 'her', 'their', 'our', 'my', 'your', 'me',
  'us', 'them', 'do', 'does', 'did', 'have', 'has', 'had', 'will',
  'would', 'could', 'should', 'can', 'not', 'no', 'so', 'if', 'then',
  'than', 'too', 'very', 'just', 'only', 'some', 'any', 'all',
]);

// ── Tokenisation ────────────────────────────────────────────────────────────

/**
 * Lower-case, strip punctuation, split on whitespace, drop stopwords +
 * empties.  Deliberately simple — Phase 10 doesn't ship NLP; we want a
 * predictable, fast tokeniser that produces identical output on
 * identical input.
 *
 * @param text  Free-text input.
 * @returns     Array of lowercased content tokens (with duplicates).
 */
function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

/**
 * Build a frequency map (token → count) from a token list.  Used as the
 * vector input to {@link cosineSimilarity}.
 *
 * @param tokens  Token list.
 * @returns       Map of token frequencies.
 */
function termFrequencies(tokens: readonly string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of tokens) {
    map.set(t, (map.get(t) ?? 0) + 1);
  }
  return map;
}

/**
 * Compute the cosine similarity between two term-frequency vectors.
 * Returns 0 when either vector is empty (defensive — prevents a NaN
 * division).
 *
 * @param a  First vector.
 * @param b  Second vector.
 * @returns  Cosine similarity in [0,1].
 */
function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [, freq] of a) normA += freq * freq;
  for (const [, freq] of b) normB += freq * freq;
  if (normA === 0 || normB === 0) return 0;

  // Dot product — iterate the smaller map so the lookup is on the
  // larger.  Constant-factor optimisation; correctness is identical
  // either way.
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const [token, freq] of smaller) {
    const otherFreq = larger.get(token);
    if (otherFreq !== undefined) dot += freq * otherFreq;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ── Reference-corpus assembly ──────────────────────────────────────────────

/**
 * Build the reference token-frequency map for a persona — combines
 * core_quotes + lexicon.  Cached by the caller for the duration of an
 * enrichment pass since the persona doesn't change inside a single
 * enrich call.
 *
 * @param persona  The persona being enriched.
 * @returns        TF map ready for cosine comparison.
 */
export function buildReferenceVector(persona: PersonaRow): Map<string, number> {
  const tokens: string[] = [];
  for (const quote of persona.core_quotes) tokens.push(...tokenise(quote));
  for (const phrase of persona.lexicon) tokens.push(...tokenise(phrase));
  return termFrequencies(tokens);
}

// ── Taboo enforcement ──────────────────────────────────────────────────────

/**
 * Check whether the candidate text contains any of the persona's taboo
 * substrings.  Case-insensitive substring match — taboo entries are
 * already short and well-curated.
 *
 * @param candidate  The candidate snippet text.
 * @param persona    The persona whose taboos to apply.
 * @returns          The matched taboo string or null.
 */
export function findTabooViolation(
  candidate: string,
  persona: PersonaRow,
): string | null {
  if (!candidate) return null;
  const haystack = candidate.toLowerCase();
  for (const taboo of persona.taboos) {
    const needle = taboo.toLowerCase().trim();
    if (needle.length === 0) continue;
    if (haystack.includes(needle)) return taboo;
  }
  return null;
}

// ── Drift scoring ──────────────────────────────────────────────────────────

/**
 * Score the voice-drift between a candidate snippet and a persona's
 * anchor corpus.  Returns the cosine similarity directly — callers
 * compare it against {@link DRIFT_MIN_COSINE} to decide rejection.
 *
 * @param candidate  Candidate snippet text.
 * @param persona    Persona row supplying core_quotes + lexicon.
 * @returns          Cosine similarity in [0,1].
 */
export function driftScore(candidate: string, persona: PersonaRow): number {
  const candidateTokens = tokenise(candidate);
  if (candidateTokens.length === 0) return 0;
  const reference = buildReferenceVector(persona);
  return cosineSimilarity(termFrequencies(candidateTokens), reference);
}

// ── Combined ingest gate ───────────────────────────────────────────────────

/**
 * High-level acceptance gate.  Run this on every LLM-produced snippet
 * before insert.  Returns either `{ accept: true }` or a rejection
 * reason that the caller can log to telemetry.
 *
 * Order of checks:
 *   1. Taboo substring (cheap; categorical reject).
 *   2. Drift cosine (only when persona has MIN_REFERENCE_TOKENS or
 *      more in its anchor corpus — fresh personas skip this leg).
 *
 * @param candidate  The candidate snippet text.
 * @param persona    The persona producing it.
 * @returns          Acceptance decision with rejection reason on failure.
 */
export function acceptSnippet(
  candidate: string,
  persona: PersonaRow,
):
  | { accept: true; cosine: number }
  | { accept: false; reason: 'taboo'; offending: string }
  | { accept: false; reason: 'drift'; cosine: number } {
  const tabooHit = findTabooViolation(candidate, persona);
  if (tabooHit !== null) {
    return { accept: false, reason: 'taboo', offending: tabooHit };
  }

  const reference = buildReferenceVector(persona);
  // Skip drift check when reference is too sparse — fresh-seeded
  // personas with only a few canonical quotes would otherwise reject
  // everything as drift.
  if (reference.size < MIN_REFERENCE_TOKENS) {
    return { accept: true, cosine: 1 };
  }
  const cosine = cosineSimilarity(
    termFrequencies(tokenise(candidate)),
    reference,
  );
  if (cosine < DRIFT_MIN_COSINE) {
    return { accept: false, reason: 'drift', cosine };
  }
  return { accept: true, cosine };
}
