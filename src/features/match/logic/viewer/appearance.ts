// ── features/match/logic/viewer/appearance.ts ───────────────────────────────
// Deterministic per-player look for the pixel-art viewer: skin tone (human AND
// alien races), hair style + colour, build, and antennae for some aliens.
//
// WHY DETERMINISTIC-FROM-ID
//   The viewer must render the same person the same way every match, forever,
//   without needing extra DB columns.  Hashing the player's stable id into a
//   seeded RNG gives a fixed, varied appearance per player at zero storage
//   cost.  If real `race`/appearance columns ever land, a caller can map those
//   onto this descriptor instead — the renderer only consumes the descriptor.
//
// PURE LOGIC — no React, no canvas, no Supabase.  Fully unit-testable.

// ── Palettes ──────────────────────────────────────────────────────────────────

/**
 * Skin tones.  The first HUMAN_SKIN_COUNT are human; the remainder are alien
 * races (greens / blues / purples / greys / pinks / yellows) befitting an
 * intergalactic league.  Alien tones unlock the chance of antennae.
 */
export const SKIN_TONES: readonly string[] = [
  '#f1c9a5', '#d8a47b', '#a9714b', '#6f4a30', // human
  '#8fd27a', '#5fb0c9', '#b98cf4', '#9fa7ad', '#e89ac0', '#d6d36a', // alien
];

/** How many leading entries in SKIN_TONES are human (the rest are alien races). */
export const HUMAN_SKIN_COUNT = 4;

/** Hair colours — naturals plus a few cosmic dyes. */
export const HAIR_COLORS: readonly string[] = [
  '#1b1b1b', '#2b2b2b', '#5b3a29', '#7a4a1f', '#caa64a', '#e3e0d5',
  '#9A5CF4', '#FF4F5E', '#8fd27a',
];

/** Hair silhouettes the renderer knows how to draw. */
export type HairStyle = 'bald' | 'short' | 'flat' | 'spiky' | 'long';

/**
 * Weighted bag of hair styles — repeats bias the distribution toward common
 * cuts so a crowd reads as "mostly short, some long, a few bald/spiky".
 */
const HAIR_STYLE_BAG: readonly HairStyle[] = [
  'bald', 'short', 'short', 'short', 'flat', 'spiky', 'spiky', 'long', 'long',
];

/** Body build — drives torso width (and reads as a diverse crowd of body types). */
export type Build = 'slim' | 'stocky';

/** Headwear silhouettes the renderer knows how to draw (Tiny Terraces' signature variety axis). */
export type HatStyle = 'none' | 'cap' | 'beanie' | 'tall' | 'band';

/**
 * Weighted bag of hats — heavily biased toward bare-headed so a hat reads as a
 * distinguishing accessory rather than a uniform.
 */
const HAT_STYLE_BAG: readonly HatStyle[] = [
  'none', 'none', 'none', 'none', 'cap', 'cap', 'beanie', 'tall', 'band',
];

/** Bright hat colours. */
export const HAT_COLORS: readonly string[] = [
  '#FF4F5E', '#9A5CF4', '#5fb0c9', '#caa64a', '#e3e0d5', '#8fd27a', '#FF6637',
];

/** The full appearance descriptor the sprite renderer consumes. */
export interface Appearance {
  /** Skin/race fill colour. */
  skin: string;
  /** Hair colour, or null when bald. */
  hair: string | null;
  /** Hair silhouette. */
  style: HairStyle;
  /** Body build → torso width multiplier in the renderer. */
  build: Build;
  /** True for the subset of alien races that sport antennae. */
  antennae: boolean;
  /** Headwear silhouette. */
  hat: HatStyle;
  /** Hat colour, or null when bare-headed. */
  hatColor: string | null;
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

// ── Builder ───────────────────────────────────────────────────────────────────

/**
 * Build a stable, varied appearance for a player id.
 *
 * The RNG draws are ordered (skin → style → hair → build → antennae) so the
 * mapping is fixed; the same id always yields the same look.  Bald players
 * carry `hair: null`; antennae only ever appear on alien skin tones.
 *
 * @param id  Stable player id (UUID).  Synthetic ids (padding) work too.
 * @returns   Appearance descriptor for the renderer.
 */
export function makeAppearance(id: string): Appearance {
  const r = mulberry32(hashStringToSeed(id));
  const skinIdx = Math.floor(r() * SKIN_TONES.length);
  const alien = skinIdx >= HUMAN_SKIN_COUNT;
  const style = HAIR_STYLE_BAG[Math.floor(r() * HAIR_STYLE_BAG.length)]!;
  const hair = style === 'bald' ? null : HAIR_COLORS[Math.floor(r() * HAIR_COLORS.length)]!;
  const build: Build = r() < 0.5 ? 'slim' : 'stocky';
  const antennae = alien && r() < 0.4;
  const hat = HAT_STYLE_BAG[Math.floor(r() * HAT_STYLE_BAG.length)]!;
  const hatColor = hat === 'none' ? null : HAT_COLORS[Math.floor(r() * HAT_COLORS.length)]!;
  return { skin: SKIN_TONES[skinIdx]!, hair, style, build, antennae, hat, hatColor };
}
