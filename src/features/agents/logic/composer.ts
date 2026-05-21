// ── features/agents/logic/composer.ts ───────────────────────────────────────
// Pure narrative composer.  Takes a skeleton string with `${name}`
// placeholders and a slot map, and returns the slot-filled result.  This
// is the *same mental model* as `gameEngine.buildCommentary()` and as the
// existing referee-narrative templates: a fixed structure with named
// holes filled from per-event data.
//
// HOW IT FITS THE LARGER CORPUS PIPELINE
//   ┌────────────────────┐
//   │ logic/corpus.ts    │  pickSnippet → SnippetRow
//   │  (this entity's    │
//   │   library)         │
//   └─────────┬──────────┘
//             ▼
//   ┌────────────────────┐
//   │ logic/composer.ts  │  composeNarrative({skeleton, slots})
//   │  (this module)     │     where one of the slots is the picked snippet
//   └─────────┬──────────┘
//             ▼
//   ┌────────────────────┐
//   │ narratives row     │  source = 'composed', composed_from = [snippetId]
//   └────────────────────┘
//
// PURE MODULE — no React, no Supabase, no I/O.  Math.random is NOT used;
// the composer is fully deterministic given its inputs.  Randomness (if
// any) lives upstream in `pickSnippet`'s scoring + a downstream pick of
// which skeleton to use.
//
// SAFETY
//   The composer guards against the most common UI footgun: a missing
//   slot rendering literal "${undefined}" or "${null}" in published copy.
//   Such slots collapse to an empty string, and a console warning is
//   emitted so the caller can see which slot it forgot.

import type { ComposeNarrativeArgs, ComposeSlots } from '../types';

// ── Placeholder regex ───────────────────────────────────────────────────────
// `${ident}` where ident is `[a-zA-Z_][a-zA-Z0-9_]*`.  Same shape as JS
// template-literal placeholders so authors can copy a hand-written
// template skeleton straight in.

/**
 * Match any `${identifier}` placeholder.  Capture group 1 is the bare
 * identifier (no leading `${`, no trailing `}`).  Global flag lets the
 * composer iterate every occurrence in one pass.
 */
const PLACEHOLDER_RE = /\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

// ── Compose ─────────────────────────────────────────────────────────────────

/**
 * Replace every `${name}` placeholder in `skeleton` with the matching
 * value from `slots`, returning the assembled string.
 *
 * Slot resolution rules:
 *   - String  → inserted verbatim.
 *   - Number  → coerced via String() (e.g. `${cards}` with `cards: 4`
 *               becomes "4").
 *   - null    → renders as empty string + warning ("missing slot: X").
 *   - undef.  → renders as empty string + warning.
 *   - Slot not in map → renders as empty string + warning.
 *
 * Why warnings instead of throwing:
 *   The composer feeds the user-facing news feed.  Throwing would lose
 *   a published row over a single missing slot.  Warning + collapse keeps
 *   the page intact and surfaces the bug to anyone tailing the dev console.
 *
 * @param args  `{ skeleton, slots }`.
 * @returns     The fully interpolated string.  Never returns null; an
 *              empty input skeleton returns an empty string.
 */
export function composeNarrative(args: ComposeNarrativeArgs): string {
  const { skeleton, slots } = args;
  if (!skeleton) return '';

  return skeleton.replace(PLACEHOLDER_RE, (match, key: string) => {
    // `key` is captured from the regex group; the cast is safe because
    // the regex only matches identifier-shaped names.
    if (!(key in slots)) {
      console.warn(`[composeNarrative] slot "${key}" not provided; collapsing to empty`);
      return '';
    }
    const value = (slots as ComposeSlots)[key];
    if (value === null || value === undefined) {
      console.warn(`[composeNarrative] slot "${key}" is ${value === null ? 'null' : 'undefined'}; collapsing to empty`);
      return '';
    }
    // Numbers and strings both stringify safely.  Other types shouldn't
    // reach here because the ComposeSlots type union excludes them, but
    // we coerce defensively in case a caller bypassed the type with `as`.
    return String(value);
  });
}

// ── Utility: extract slot names from a skeleton ────────────────────────────
// Useful for tooling and debugging: given a skeleton, what slots does it
// expect?  Exported so admin tooling can validate a slot map against a
// skeleton before publishing.

/**
 * Return the unique set of slot names referenced by a skeleton, in
 * first-appearance order.  Empty array for a skeleton with no placeholders.
 *
 * Example:
 *   slotNames('${ref} produced ${cards} cards; ${ref} departed quietly')
 *   → ['ref', 'cards']
 *
 * @param skeleton  The template string.
 * @returns         Ordered list of distinct slot names.
 */
export function slotNames(skeleton: string): string[] {
  if (!skeleton) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const match of skeleton.matchAll(PLACEHOLDER_RE)) {
    const name = match[1];
    if (name && !seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }
  return result;
}
