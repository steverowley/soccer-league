// ── corpus-enricher / voiceGuard.ts ────────────────────────────────────────
// Edge-function copy of `src/features/agents/logic/voiceGuard.ts` (Phase 10).
//
// WHY THIS FILE EXISTS (and is a deliberate duplicate)
//   Edge functions run on Deno via esm.sh imports.  They cannot reach into
//   `src/` because that tree is bundled by Vite for the browser, not the
//   Deno runtime, and pulling in transitive React / Zod / Supabase deps
//   would break the worker.  voiceGuard is small and PURE — duplicating
//   it is cheaper than building a shared package.
//
//   The src/ original remains the source of truth for the in-app reflex
//   tier (`buildMatchCompletionMemories`, etc.).  If you change the
//   constants or the acceptance logic, change BOTH files and add the
//   matching unit test on the src/ side.
//
// WHAT IT GUARDS
//   1. TABOO substrings — the persona's `taboos` list contains phrases
//      this voice MUST NEVER produce.  Substring match is categorical.
//   2. VOICE DRIFT — cheap bag-of-words cosine between the candidate and
//      the persona's anchor corpus (core_quotes + lexicon).  Fresh
//      personas with too-sparse anchors skip the drift gate so the
//      enricher can warm them up.
//
// PURE MODULE — no Supabase, no Anthropic, no Deno globals.  Safe to fold
// into any handler.
// ───────────────────────────────────────────────────────────────────────────

// deno-lint-ignore-file no-explicit-any
// ^ Matches the host index.ts style: edge function code keeps the deno
//   lint quiet around Deno-typed surfaces.

// ── Shape (mirrors the host file's PersonaRow) ──────────────────────────────
// Deliberately structural rather than a shared import — the host file
// already declares this interface locally so we accept the same shape and
// stay decoupled from any future src/ type drift.

/**
 * Minimal persona shape needed by the guard.  A subset of the full
 * `entity_persona` row defined in migration 0035; only the fields the
 * gate reads are included so callers can pass any compatible row.
 */
export interface GuardPersona {
  /** Canonical lines used as anchor corpus for drift scoring. */
  core_quotes: string[];
  /** Voice-specific phrases that contribute to the anchor corpus. */
  lexicon: string[];
  /** Substrings the voice NEVER produces — categorical reject. */
  taboos: string[];
}

// ── Tuning constants (KEEP IN SYNC with src/features/agents/logic/voiceGuard.ts) ──

/**
 * Minimum cosine similarity (0..1) a candidate must achieve against the
 * persona anchor corpus to pass the drift gate.
 *
 * MECHANICAL EFFECT: at 0.08 the gate rejects ~obviously off-voice
 * outputs (random topic, totally different register) while admitting
 * short 1-3 sentence snippets that share only a handful of content
 * tokens with the anchor.  Raise if the enricher's hit-rate climbs to
 * "everything passes"; lower if good snippets are being rejected.
 */
export const DRIFT_MIN_COSINE = 0.08;

/**
 * Minimum reference token count before the drift check is *meaningful*.
 *
 * MECHANICAL EFFECT: personas with fewer than 12 distinct anchor tokens
 * (fresh-seeded entities with thin core_quotes + lexicon) bypass the
 * drift gate entirely — otherwise every candidate would fail simply
 * because the reference is too small to share words with.  Taboo
 * enforcement still applies.
 */
const MIN_REFERENCE_TOKENS = 12;

/**
 * Stopword bag dropped from BOTH the candidate and the reference.
 * Kept short on purpose so domain-specific football terms always count.
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
 * Lower-case, strip punctuation, split on whitespace, drop stopwords.
 * Deterministic — identical input ALWAYS yields identical output, which
 * is what the cosine scoring relies on.
 *
 * @param text  Free-text input.
 * @returns     Lowercased content tokens (duplicates retained for TF).
 */
function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

/**
 * Build a term-frequency map (token → count) for cosine scoring.
 *
 * @param tokens  Token list (with duplicates).
 * @returns       Frequency map.
 */
function termFrequencies(tokens: readonly string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of tokens) {
    map.set(t, (map.get(t) ?? 0) + 1);
  }
  return map;
}

/**
 * Compute the cosine similarity between two TF vectors in [0,1].  Defensive
 * against empty inputs (returns 0 rather than NaN).
 *
 * @param a  First vector.
 * @param b  Second vector.
 * @returns  Cosine similarity.
 */
function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) return 0;

  let normA = 0;
  let normB = 0;
  for (const [, freq] of a) normA += freq * freq;
  for (const [, freq] of b) normB += freq * freq;
  if (normA === 0 || normB === 0) return 0;

  // Iterate the smaller map; constant-factor optimisation, correctness
  // is identical either way.
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [token, freq] of smaller) {
    const otherFreq = larger.get(token);
    if (otherFreq !== undefined) dot += freq * otherFreq;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ── Reference corpus ───────────────────────────────────────────────────────

/**
 * Build the persona's anchor token-frequency map from `core_quotes` +
 * `lexicon`.  The caller should cache the result for the duration of one
 * enrichment pass — the persona is immutable across that pass.
 *
 * @param persona  Persona being enriched.
 * @returns        Anchor TF map ready for cosine scoring.
 */
function buildReferenceVector(persona: GuardPersona): Map<string, number> {
  const tokens: string[] = [];
  for (const quote of persona.core_quotes) tokens.push(...tokenise(quote));
  for (const phrase of persona.lexicon) tokens.push(...tokenise(phrase));
  return termFrequencies(tokens);
}

// ── Taboo enforcement ──────────────────────────────────────────────────────

/**
 * Return the first taboo phrase found inside `candidate` (case-insensitive
 * substring match) or null if none hit.  Taboos are short, well-curated
 * strings; substring match is the right tool.
 *
 * @param candidate  Candidate snippet text.
 * @param persona    Persona whose taboos apply.
 * @returns          Matched taboo phrase or null.
 */
export function findTabooViolation(
  candidate: string,
  persona: GuardPersona,
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

// ── Combined ingest gate ───────────────────────────────────────────────────

/**
 * Acceptance decision returned by {@link acceptSnippet}.
 *
 * On accept, `cosine` carries the score actually observed (or 1 when the
 * reference was too sparse to score against).
 * On reject, `reason` is either `'taboo'` (categorical) or `'drift'`
 * (cosine below {@link DRIFT_MIN_COSINE}).
 */
export type AcceptDecision =
  | { accept: true; cosine: number }
  | { accept: false; reason: 'taboo'; offending: string }
  | { accept: false; reason: 'drift'; cosine: number };

/**
 * High-level ingest gate.  Run on every LLM-produced snippet BEFORE
 * inserting into `entity_snippets`.
 *
 * Order:
 *   1. Taboo substring — categorical, cheapest, runs first.
 *   2. Drift cosine — skipped on sparse personas (< MIN_REFERENCE_TOKENS).
 *
 * @param candidate  Candidate snippet text from the LLM.
 * @param persona    Persona producing the snippet.
 * @returns          Acceptance decision; rejection reason on failure.
 */
export function acceptSnippet(
  candidate: string,
  persona: GuardPersona,
): AcceptDecision {
  const tabooHit = findTabooViolation(candidate, persona);
  if (tabooHit !== null) {
    return { accept: false, reason: 'taboo', offending: tabooHit };
  }

  const reference = buildReferenceVector(persona);
  // Skip drift scoring on sparse anchor corpora — see MIN_REFERENCE_TOKENS.
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
