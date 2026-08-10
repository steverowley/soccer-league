// ── match-worker/narrativeMode.ts ───────────────────────────────────────────
// Verbatim copy of src/shared/narrative/narrativeMode.ts — edge functions cannot
// import from src/. Guarded by the twinParity CODE_TWINS test; edit the src
// copy and re-sync, never this one.
// Which engine writes the world's prose: the local corpus, or a model.
//
// THE ARRANGEMENT
//   Deterministic is the main path and the default.  The LLM is an opt-in
//   override, switched on per deployment by setting ISL_NARRATIVE_MODE=llm.
//   Nothing needs configuring to run the world; you configure only to add a
//   model back on top.
//
// WHY THE CORPUS IS THE FLOOR, NOT THE FALLBACK-OF-LAST-RESORT
//   The old arrangement was the reverse: the model was the path, and a failure
//   returned null so the voice simply didn't speak.  That is how the Galaxy
//   Dispatch went 78% one repeated line for two months without anyone noticing
//   — an empty API key and a quiet cosmos look identical from the outside.
//   Here a model failure falls through to the corpus, so the world keeps
//   talking whatever happens upstream, and an outage costs richness rather
//   than silence.

/** Which generator writes a given narrative. */
export type NarrativeMode = 'deterministic' | 'llm';

/** What the world runs on unless a deployment explicitly asks for a model. */
export const DEFAULT_NARRATIVE_MODE: NarrativeMode = 'deterministic';

/**
 * Read a narrative mode from raw configuration.
 *
 * Anything other than an explicit, case-insensitive `"llm"` resolves to
 * deterministic — an unset, empty, misspelled, or garbled value must never
 * silently start spending tokens.
 *
 * @param raw  The configured value (e.g. `Deno.env.get('ISL_NARRATIVE_MODE')`).
 * @returns    The resolved mode.
 */
export function resolveNarrativeMode(raw: string | undefined | null): NarrativeMode {
  return raw?.trim().toLowerCase() === 'llm' ? 'llm' : DEFAULT_NARRATIVE_MODE;
}

/**
 * Run the model when the deployment asked for it; otherwise, or on any failure,
 * use the corpus.
 *
 * The fallback is called lazily, so in deterministic mode the model closure is
 * never constructed and no SDK import or network call happens at all.
 *
 * @param mode      Resolved mode — `'deterministic'` skips `llm` entirely.
 * @param llm       The model path. May return null to mean "nothing usable".
 * @param fallback  The corpus path. Must always produce a line.
 * @returns         A line, always. Never null, never throws from `llm`.
 */
export async function preferLlm<T>(
  mode: NarrativeMode,
  llm: () => Promise<T | null>,
  fallback: () => T,
): Promise<T> {
  if (mode !== 'llm') return fallback();
  try {
    const generated = await llm();
    // A null return means the model produced nothing usable — an empty
    // completion, an unparseable payload. Treat it exactly like a failure.
    return generated ?? fallback();
  } catch (err) {
    console.warn('[narrative] model path failed, using the corpus:', err);
    return fallback();
  }
}
