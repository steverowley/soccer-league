// ── features/match/logic/viewer/appearance.ts ───────────────────────────────
// Deterministic per-player look for the pixel-art viewer — the "sprite foundry"
// from the ISL design-system handoff (Match Sprites study, 2026-07).
//
// THE PHOSPHOR PICTOGRAM MODEL
//   Every being on the pitch is a Lunar-Dust phosphor figure on Galactic Abyss —
//   the brand's monochrome. Variety comes from SILHOUETTE, never from hue:
//   a SPECIES changes head shape, eye configuration, antennae and mandibles;
//   BUILD changes torso width; HAIR (phosphor-tone shades only) tops terrans.
//   This replaced the earlier "silly little men" (skin tones, rainbow hair,
//   hats) when the design system locked `accent: phosphor`.
//
// WHY DETERMINISTIC-FROM-ID
//   The viewer must render the same person the same way every match, forever,
//   without needing extra DB columns.  Hashing the player's stable id into a
//   seeded RNG gives a fixed, varied appearance per player at zero storage
//   cost.  Callers with richer knowledge (an entity description, an explicit
//   species) can pass hints that override the random draw — same input, same
//   sprite, forever.
//
// PURE LOGIC — no React, no canvas, no Supabase.  Fully unit-testable.

// ── Species ───────────────────────────────────────────────────────────────────

/** Head silhouettes the renderer knows how to draw. */
export type HeadShape = 'box' | 'wide' | 'tall' | 'round';

/** Eye configurations the renderer knows how to draw. */
export type EyeKind = 'two' | 'big' | 'cluster' | 'one' | 'three' | 'high';

/** Antenna silhouettes (drawn above the head). */
export type AntennaKind = 'none' | 'feeler' | 'orb';

/** The intergalactic species roster. */
export type Species = 'terran' | 'grey' | 'insectoid' | 'cyclops' | 'trinocular' | 'aurelid';

/** What a species contributes to the silhouette (never a new hue). */
export interface SpeciesSpec {
  head: HeadShape;
  eyes: EyeKind;
  antennae: AntennaKind;
  /** Terrans are the only species that grows hair. */
  hair: boolean;
  /** Head-size multiplier — greys read big-headed, insectoids slightly small. */
  headMul: number;
  /** Insectoids get little mandibles under the chin. */
  mandible?: boolean;
}

/**
 * The species table (from the handoff's Sprite Studies).  Each species is a
 * distinct silhouette recipe; the renderer stays monochrome throughout, so the
 * crowd reads as varied even on the austere phosphor palette.
 */
export const SPECIES: Readonly<Record<Species, SpeciesSpec>> = {
  terran:     { head: 'box',   eyes: 'two',     antennae: 'none',   hair: true,  headMul: 1.0 },
  grey:       { head: 'wide',  eyes: 'big',     antennae: 'none',   hair: false, headMul: 1.3 },
  insectoid:  { head: 'box',   eyes: 'cluster', antennae: 'feeler', hair: false, headMul: 0.95, mandible: true },
  cyclops:    { head: 'wide',  eyes: 'one',     antennae: 'none',   hair: false, headMul: 1.1 },
  trinocular: { head: 'tall',  eyes: 'three',   antennae: 'none',   hair: false, headMul: 1.02 },
  aurelid:    { head: 'round', eyes: 'high',    antennae: 'orb',    hair: false, headMul: 1.06 },
};

/** Species keys in a fixed order (drives the random species draw). */
export const SPECIES_KEYS: readonly Species[] = [
  'terran', 'grey', 'insectoid', 'cyclops', 'trinocular', 'aurelid',
];

// ── Hair ──────────────────────────────────────────────────────────────────────

/** Hair silhouettes the renderer knows how to draw (terrans only). */
export type HairStyle = 'bald' | 'short' | 'flat' | 'spiky' | 'long';

/**
 * Weighted bag of hair styles — repeats bias the distribution toward common
 * cuts so a crowd reads as "mostly short, some long, a few bald/spiky".
 */
const HAIR_STYLE_BAG: readonly HairStyle[] = [
  'bald', 'short', 'short', 'short', 'flat', 'spiky', 'spiky', 'long', 'long',
];

/**
 * Phosphor-tone hair shades per style — the variety axis kept IN palette (dust
 * greys, never the old rainbow dyes), per the brand's monochrome rule.
 */
export const HAIR_TONE: Readonly<Record<Exclude<HairStyle, 'bald'>, string>> = {
  short: '#C6C3B8',
  flat:  '#AEAB9F',
  spiky: '#94917F',
  long:  '#BBB8AC',
};

/** Body build — drives torso width (and reads as a diverse crowd of body types). */
export type Build = 'slim' | 'stocky';

// ── Descriptor ────────────────────────────────────────────────────────────────

/** The full appearance descriptor the sprite renderer consumes. */
export interface Appearance {
  /** Which species silhouette to draw. */
  species: Species;
  /** Body build → torso width multiplier in the renderer. */
  build: Build;
  /** Hair silhouette (always 'bald' for non-terran species). */
  style: HairStyle;
  /** Phosphor-tone hair shade, or null when bald. */
  hair: string | null;
}

/**
 * Optional hints for the foundry: explicit fields win over anything parsed from
 * `text`, which wins over the seeded random draw.  `name` (or `id`) seeds the
 * deterministic RNG.
 */
export interface AppearanceHints {
  name?: string;
  id?: string;
  /** Free text (an entity description) — mined for species/build/hair words. */
  text?: string;
  species?: Species;
  build?: Build;
  hairStyle?: HairStyle;
}

// ── Seeded RNG ────────────────────────────────────────────────────────────────

/**
 * FNV-1a 32-bit string hash.  Maps a player id to a stable uint32 seed.
 *
 * @param s  Any string (a player UUID in practice).
 * @returns  Unsigned 32-bit hash.
 */
export function hashStringToSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * mulberry32 — a tiny, fast, well-distributed seeded PRNG.  Returns a function
 * yielding floats in [0, 1).  Same generator family the spatial engine uses.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Description parsing ───────────────────────────────────────────────────────

/** Synonym table mapping loose entity-description words to a species. */
const SPECIES_SYNONYMS: ReadonlyArray<readonly [Species, readonly string[]]> = [
  ['grey',       ['grey', 'gray', 'little green', 'big-head', 'big head', 'abductor']],
  ['insectoid',  ['insect', 'bug', 'mantis', 'chitin', 'roach', 'hive', 'drone']],
  ['cyclops',    ['cyclop', 'one-eyed', 'one eye', 'single eye', 'monocular']],
  ['trinocular', ['three-eyed', 'three eyes', 'tri-ocular', 'trinocular', 'third eye']],
  ['aurelid',    ['orb antenna', 'jelly', 'aurelid', 'lantern']],
  ['terran',     ['human', 'terran', 'earthling']],
];

/** The hints `parseDescription` can extract from free text. */
export interface ParsedHints {
  species?: Species;
  build?: Build;
  hair?: HairStyle;
}

/**
 * Pull species/build/hair hints out of a free-text entity description.  Exact
 * species names win, then synonyms; body-shape and hair words map onto the
 * build/style axes.  Anything unmatched is simply absent (the seeded draw
 * fills it in).
 *
 * @param text  Any prose (an entity persona line, a scout note, a name).
 * @returns     The hints found — possibly none.
 */
export function parseDescription(text: string): ParsedHints {
  const t = ` ${text.toLowerCase()} `;
  const out: ParsedHints = {};
  for (const k of SPECIES_KEYS) {
    if (t.includes(k)) {
      out.species = k;
      break;
    }
  }
  if (!out.species) {
    for (const [k, words] of SPECIES_SYNONYMS) {
      if (words.some((w) => t.includes(w))) {
        out.species = k;
        break;
      }
    }
  }
  if (/stock|burly|heavy|broad|brawn|hulk|huge|massive|wide/.test(t)) out.build = 'stocky';
  else if (/slim|lean|thin|wiry|lanky|tall|spindl/.test(t)) out.build = 'slim';
  if (/bald|shaven/.test(t)) out.hair = 'bald';
  else if (/spik|mohawk|crest/.test(t)) out.hair = 'spiky';
  else if (/long hair|flowing|mane|locks/.test(t)) out.hair = 'long';
  if (/antenna|antennae|feeler/.test(t) && !out.species) out.species = 'insectoid';
  return out;
}

// ── Builder (the sprite foundry) ──────────────────────────────────────────────

/**
 * Build a stable, varied appearance for a player id or entity description.
 *
 * Pass a string (a player UUID — the common case) or hints ({ name, text,
 * species, build, hairStyle }).  Explicit fields beat parsed text beats the
 * seeded random draw, and the RNG draws are ordered (species → build → style)
 * so the mapping is fixed: the same input always yields the same look.
 * Non-terran species are always bald (hair is the terran variety axis).
 *
 * @param desc  Stable player id (UUID), or an AppearanceHints object.
 * @returns     Appearance descriptor for the renderer.
 */
export function makeAppearance(desc: string | AppearanceHints): Appearance {
  const hints: AppearanceHints = typeof desc === 'string' ? { name: desc } : desc;
  const name = hints.name ?? hints.id ?? 'entity';
  const parsed = hints.text != null ? parseDescription(hints.text) : {};
  const r = mulberry32(hashStringToSeed(`${name}|${hints.text ?? ''}`));

  const species = hints.species ?? parsed.species ?? SPECIES_KEYS[Math.floor(r() * SPECIES_KEYS.length)]!;
  const sp = SPECIES[species];
  const build: Build = hints.build ?? parsed.build ?? (r() < 0.5 ? 'slim' : 'stocky');
  let style: HairStyle = hints.hairStyle ?? parsed.hair ?? HAIR_STYLE_BAG[Math.floor(r() * HAIR_STYLE_BAG.length)]!;
  if (!sp.hair) style = 'bald';

  return {
    species,
    build,
    style,
    hair: style === 'bald' ? null : HAIR_TONE[style],
  };
}
