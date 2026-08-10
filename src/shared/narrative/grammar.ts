// ── shared/narrative/grammar.ts ──────────────────────────────────────────────
// A seeded grammar expander: the deterministic replacement for the LLM voices.
//
// WHY THIS EXISTS
//   Every in-world voice — the Architect's whispers, pundit takes, journalist
//   columns, political decrees — used to be an Anthropic call.  That made the
//   whole narrative layer hostage to an API key: when credits ran out the feed
//   collapsed to a single repeated fallback line, and nothing about the world
//   was reproducible.  This module generates that text locally instead.
//
// THE TRICK: COMBINATORIAL DEPTH, NOT RANDOMNESS
//   A template with five slots of eight fragments each spans 8^5 = 32,768
//   distinct sentences.  A handful of templates per voice therefore covers
//   hundreds of thousands of outputs — far more than a reader will ever see —
//   while every one of them is a pure function of its seed.  The world feels
//   improvised; it is in fact perfectly replayable.
//
// SLOT SYNTAX
//   {noun}        — expand the `noun` pool from the lexicon
//   {noun|verb}   — expand either pool (choose first, then a fragment from it)
//   [maybe text]  — include this literal about half the time
//   <name>        — substitute a caller-supplied variable, verbatim
//
//   Pool fragments may themselves contain slots, so a lexicon can nest as deep
//   as it likes; expansion recurses until no slot remains.  A malformed or
//   unknown slot is left in place rather than throwing — a stray brace should
//   never take down a match tick.

/** A seeded random source returning a float in [0, 1). */
export type Rng = () => number;

/** Named pools of interchangeable fragments, keyed by slot name. */
export type Lexicon = Readonly<Record<string, readonly string[]>>;

/** Caller-supplied substitutions for `<angle>` placeholders (team names, etc.). */
export type Vars = Readonly<Record<string, string>>;

/**
 * Guard against a lexicon that references itself in a cycle (`{a}` → `{b}` →
 * `{a}`).  Ten rounds is far beyond any legitimate nesting depth; past that we
 * return what we have rather than recursing forever.
 */
const MAX_EXPANSION_ROUNDS = 10;

/** Matches `{slot}` or `{slot|alt}` — the pool-expansion form. */
const SLOT_RE = /\{([a-z0-9_|]+)\}/gi;

/** Matches `[optional literal]` — included on a coin flip. */
const OPTIONAL_RE = /\[([^[\]]*)\]/g;

/** Matches `<var>` — replaced from the caller's `vars` map. */
const VAR_RE = /<([a-z0-9_]+)>/gi;

/**
 * Derive a stable 32-bit seed from any string.
 *
 * FNV-1a: one xor-multiply per byte, well-dispersed for short keys and stable
 * across runtimes (the browser and the Deno workers must agree, or a narrative
 * would read differently depending on which side rendered it).
 *
 * @param input  Any context key — `${matchId}:${minute}`, an entity id, a date.
 * @returns      A 32-bit unsigned integer suitable for `makeRng`.
 */
export function seedFromString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // The FNV prime, 16777619, applied with Math.imul to stay in 32-bit range.
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Build the seeded source for a context key — the entry point every voice uses.
 *
 * mulberry32, the same generator the match engine runs on, so the codebase has
 * one RNG idiom.  `shared/` cannot import the engine's copy (it lives under
 * `features/`, and the worker keeps its own twin), so the four lines live here
 * too rather than inverting the dependency.
 *
 * @param key  Context key — the same key always yields the same stream.
 * @returns    A seeded `Rng`.
 */
export function rngFor(key: string): Rng {
  let a = seedFromString(key);
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pick one fragment from a pool.  Returns `undefined` for an empty pool so
 * callers can leave the slot untouched rather than emitting "undefined".
 */
function pick<T>(pool: readonly T[], rng: Rng): T | undefined {
  if (pool.length === 0) return undefined;
  return pool[Math.floor(rng() * pool.length)];
}

/**
 * Expand one template into a finished line.
 *
 * Expansion runs in rounds: each round resolves every slot currently present,
 * and fragments pulled in may introduce new slots for the next round.  Optional
 * `[...]` sections resolve first so a dropped section never leaves an orphaned
 * slot behind, and `<vars>` resolve last so caller text is never re-scanned for
 * grammar syntax (a team called "Great Red FC" must not be treated as markup).
 *
 * @param template  The template string, e.g. `'{opener} <team> {verdict}.'`
 * @param lexicon   Pools the `{slots}` draw from.
 * @param rng       Seeded source — the same seed always yields the same line.
 * @param vars      Substitutions for `<angle>` placeholders. Optional.
 * @returns         The expanded line, with whitespace normalised.
 */
export function expand(
  template: string,
  lexicon: Lexicon,
  rng: Rng,
  vars: Vars = {},
): string {
  // Optional sections first — a dropped `[...]` must take its slots with it.
  let text = template.replace(OPTIONAL_RE, (_match, inner: string) =>
    rng() < 0.5 ? inner : '',
  );

  for (let round = 0; round < MAX_EXPANSION_ROUNDS; round++) {
    if (!/\{[a-z0-9_|]+\}/i.test(text)) break;
    text = text.replace(SLOT_RE, (match, name: string) => {
      // `{a|b}` — choose which pool to draw from, then draw.
      const poolName = name.includes('|')
        ? pick(name.split('|'), rng) ?? name
        : name;
      const fragment = pick(lexicon[poolName] ?? [], rng);
      // Unknown or empty pool: leave the slot as written so the gap is visible
      // in review rather than silently producing "undefined".
      return fragment ?? match;
    });
  }

  text = text.replace(VAR_RE, (match, name: string) => vars[name] ?? match);

  // Collapse the double spaces and stranded punctuation that dropped optional
  // sections leave behind, so output always reads as clean prose.
  text = text
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();

  // Repair sentence case.  Pools carry both cased and lower-cased variants so a
  // fragment can sit mid-clause, but which position a fragment lands in depends
  // on the template AND on which optional sections survived — so the template
  // author cannot know.  Capitalising every sentence start here means a lower
  // fragment that happens to follow a full stop reads correctly anyway.
  return text.replace(
    /(^|[.!?]\s+)([a-z])/g,
    (_match, prefix: string, letter: string) => prefix + letter.toUpperCase(),
  );
}

/**
 * Count how many distinct lines a template could produce against a lexicon.
 *
 * This is the variety budget: tests assert each voice clears a floor so the
 * deterministic layer can never quietly decay into the handful of repeated
 * strings that the old LLM fallbacks were.  Nested pools multiply, `[optional]`
 * sections double, and unknown slots count as 1 (they expand to themselves).
 *
 * The count is an upper bound — it assumes slots draw independently, which they
 * do — and saturates at `Number.MAX_SAFE_INTEGER` for deeply nested lexicons
 * rather than overflowing into `Infinity`.
 *
 * @param template  The template to measure.
 * @param lexicon   The pools it draws from.
 * @returns         Number of distinct expansions.
 */
export function variantCount(template: string, lexicon: Lexicon): number {
  return countFor(template, lexicon, 0);
}

/**
 * Recursive worker behind `variantCount`.  `depth` mirrors the expansion-round
 * guard so a self-referential lexicon terminates here too.
 */
function countFor(template: string, lexicon: Lexicon, depth: number): number {
  if (depth >= MAX_EXPANSION_ROUNDS) return 1;

  let total = 1;

  // Each `[optional]` section is an independent in/out choice, and its contents
  // contribute their own variety when present.
  for (const match of template.matchAll(OPTIONAL_RE)) {
    total = saturatingMultiply(total, 1 + countFor(match[1] ?? '', lexicon, depth + 1));
  }

  const withoutOptional = template.replace(OPTIONAL_RE, '');

  for (const match of withoutOptional.matchAll(SLOT_RE)) {
    const name = match[1] ?? '';
    const poolNames = name.includes('|') ? name.split('|') : [name];
    // Summed across the alternatives: `{a|b}` can produce anything in either.
    let branch = 0;
    for (const poolName of poolNames) {
      const pool = lexicon[poolName];
      if (!pool || pool.length === 0) {
        branch += 1;
        continue;
      }
      for (const fragment of pool) branch += countFor(fragment, lexicon, depth + 1);
    }
    total = saturatingMultiply(total, branch);
  }

  return total;
}

/** Multiply without overflowing past the safe-integer range. */
function saturatingMultiply(a: number, b: number): number {
  const product = a * b;
  return product > Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : product;
}

/**
 * Total variety across a set of templates — the number a voice advertises.
 *
 * @param templates  Every template the voice can start from.
 * @param lexicon    The shared pools.
 */
export function totalVariants(templates: readonly string[], lexicon: Lexicon): number {
  return templates.reduce((sum, t) => sum + variantCount(t, lexicon), 0);
}
