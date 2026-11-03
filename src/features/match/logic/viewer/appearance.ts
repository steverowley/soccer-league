// ── features/match/logic/viewer/appearance.ts ───────────────────────────────
// The per-player look of a figure in the match viewer (docs/match-viewer.md
// section 6, "Figures and peoples").
//
// WHAT DECIDES HOW A PLAYER LOOKS
//   - His PEOPLE is canon: it comes from his bio (`MatchViewerPlayer.species`,
//     one of the thirteen keys in src/data/peoples.ts), never from a hash.
//     No species (an old bio, a synthetic pad) means Terran.
//   - Everything else is VARIATION within his people, seeded from his id so
//     no two players look the same and one player always looks the same:
//     head size, leg length, shoulder width, head tone, and each people's own
//     details (hair, horns, tentacles, visor, aerials, flame, brain, faceplate,
//     eye size and spacing...).
//
// BRAND RULE: peoples never add a hue.  Head tones are Lunar Dust shades from
// the canvas palette; the club kit stays the only strong colour on a figure.
//
// PURE LOGIC: no React, no canvas.  The renderer (ui/viewer/figure.ts) reads
// the fields; which fields matter depends on the people (each is documented
// with the peoples that use it).

import { canvasColor } from '../../../../shared/design';
import { SPECIES, type Species } from '../../../../data/peoples';

export type { Species };

/** The thirteen peoples, in the order the lore and the viewer list them. */
export const SPECIES_KEYS: readonly Species[] = SPECIES;

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
 * mulberry32: a tiny, fast, well-distributed seeded PRNG.  Returns a function
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

// ── Variation ranges (owner spec, docs/match-viewer.md section 6) ─────────────

/** Head size multiplier range. */
export const HEAD_SCALE: readonly [number, number] = [0.88, 1.14];
/** Leg length multiplier range. */
export const LEG_SCALE: readonly [number, number] = [0.86, 1.14];
/** Shoulder width multiplier range. */
export const SHOULDER_SCALE: readonly [number, number] = [0.94, 1.14];

/**
 * Head tones for every people except the two with their own: Lunar Dust is
 * twice as likely as each of the two lighter-worn shades.
 */
export const HEAD_TONES: readonly string[] = [canvasColor.text, canvasColor.text, canvasColor.figureTone2, canvasColor.figureTone3];
/** The Quoo's tones: its own shade, twice as likely, or one of the two nearest Lunar Dust shades. */
export const QUOO_TONES: readonly string[] = [canvasColor.figureQuoo, canvasColor.figureQuoo, canvasColor.figureTone2, canvasColor.figureTone3];

/** Terran hair silhouettes. */
export type HairStyle = 'bald' | 'short' | 'tuft' | 'long' | 'buzz';
/** Weighted bag of hair styles (repeats bias the crowd toward short cuts). */
const HAIR_STYLE_BAG: readonly HairStyle[] = ['short', 'tuft', 'long', 'short', 'buzz', 'bald', 'tuft', 'short'];
/** Terran hair shades: Lunar Dust shades only, never a dye. */
export const HAIR_TONES: readonly string[] = [canvasColor.figureMid, canvasColor.figureDark, canvasColor.figureLight];

// ── Descriptor ────────────────────────────────────────────────────────────────

/**
 * Everything the renderer needs to draw one player's figure.  Numbers are
 * multipliers or fractions of the head unless noted; every field is always
 * set (a people ignores the ones that are not its own).
 */
export interface Appearance {
  /** His people (Terran when the bio has none). */
  species: Species;
  /** Body proportions: head size, leg length, shoulder width (multipliers). */
  headScale: number;
  legScale: number;
  shoulder: number;
  /** Head colour: a Lunar Dust shade (canvas token). */
  tone: string;
  /** 0..1, offsets his blink, breathing and flicker so a crowd is never in step. */
  seed: number;

  /** Terran: hair style and its Lunar Dust shade (null when bald). */
  hairStyle: HairStyle;
  hairTone: string | null;
  /** Terran: eye spacing (fraction of head width from the centre) and eye height (fraction of head height). */
  eyeGap: number;
  eyeY: number;
  /** Grey, Trinocular, Slyari, Quoo: eye size multiplier. */
  eyeScale: number;
  /** Grey: how sharply the skull tapers to the chin (fraction cut from each side). */
  chinTaper: number;
  /** Trinocular: how far the lower eyes sit in from the edge, and the third eye's height. */
  inset: number;
  thirdY: number;
  /** Synth: visor height and position (fractions of head height), 0 to 2 aerials, side bolts. */
  visorH: number;
  visorY: number;
  aerials: 0 | 1 | 2;
  bolts: boolean;
  /** Taurid (and the Quoo's horns): horn length multiplier; Taurid horn curl 0 (out) to 1 (in), muzzle width. */
  hornLen: number;
  hornCurl: number;
  muzzleW: number;
  /** Cephalid: 3 to 5 tentacles, and their length multiplier. */
  tentacles: number;
  tentacleLen: number;
  /** Ignid and Fenthrai: flame height multiplier. */
  flameH: number;
  /** Dome: brain size multiplier and collar height (fraction of head height). */
  brainScale: number;
  collar: number;
  /** Android: faceplate height (fraction of head height), seam, temple light and its side. */
  plateH: number;
  seam: boolean;
  templeLight: boolean;
  templeFront: boolean;
  /** Slyari: feeler and trunk length multipliers. */
  feelerLen: number;
  trunkLen: number;
  /** Fenthrai: side fin length multiplier. */
  finLen: number;
  /** Ohm K: side bolt length and jaw width multipliers. */
  boltLen: number;
  jawW: number;
}

/** Uniform draw in [lo, hi]. */
function range(r: () => number, [lo, hi]: readonly [number, number]): number {
  return lo + (hi - lo) * r();
}

/** One element of a non-empty list. */
function pick<T>(r: () => number, list: readonly T[]): T {
  return list[Math.floor(r() * list.length)]!;
}

/**
 * The figure for one player.
 *
 * Deterministic: the same id and people always give the same figure.  Every
 * draw happens in a fixed order whatever the people, so a player's body
 * (head, legs, shoulders) does not change if his people is corrected later.
 *
 * @param id       His stable player id (seeds the variation).
 * @param species  His people from the bio; absent or null means Terran.
 * @returns        The appearance the renderer draws.
 */
export function makeAppearance(id: string, species?: Species | null): Appearance {
  const people: Species = species ?? 'terran';
  const r = mulberry32(hashStringToSeed(id));
  const headScale = range(r, HEAD_SCALE);
  const legScale = range(r, LEG_SCALE);
  const shoulder = range(r, SHOULDER_SCALE);
  const toneRoll = r();
  const seed = r();
  const hairStyle = pick(r, HAIR_STYLE_BAG);
  const hairToneRoll = pick(r, HAIR_TONES);
  const eyeGap = range(r, [0.18, 0.26]);
  const eyeY = range(r, [0.46, 0.58]);
  const eyeScale = range(r, [0.85, 1.25]);
  const chinTaper = range(r, [0.16, 0.3]);
  const inset = range(r, [0.12, 0.24]);
  const thirdY = range(r, [0.16, 0.28]);
  const visorH = range(r, [0.2, 0.36]);
  const visorY = range(r, [0.3, 0.46]);
  const aerials = Math.min(2, Math.floor(r() * 3)) as 0 | 1 | 2;
  const bolts = r() < 0.6;
  const hornLen = range(r, [0.75, 1.45]);
  const hornCurl = r();
  const muzzleW = range(r, [0.45, 0.68]);
  const tentacles = 3 + Math.min(2, Math.floor(r() * 3));
  const tentacleLen = range(r, [0.75, 1.35]);
  const flameH = range(r, [0.8, 1.3]);
  const brainScale = range(r, [0.8, 1.2]);
  const collar = range(r, [0.2, 0.36]);
  const plateH = range(r, [0.34, 0.5]);
  const seam = r() < 0.6;
  const templeLight = r() < 0.7;
  const templeFront = r() < 0.5;
  const feelerLen = range(r, [0.75, 1.35]);
  const trunkLen = range(r, [0.8, 1.4]);
  const finLen = range(r, [0.75, 1.35]);
  const boltLen = range(r, [0.8, 1.3]);
  const jawW = range(r, [0.55, 0.85]);

  const tones = people === 'quoo' ? QUOO_TONES : HEAD_TONES;
  const tone = people === 'ohmk' ? canvasColor.figureMetal : tones[Math.floor(toneRoll * tones.length)]!;
  const bald = people !== 'terran' || hairStyle === 'bald';

  return {
    species: people,
    headScale,
    legScale,
    shoulder,
    tone,
    seed,
    hairStyle: people === 'terran' ? hairStyle : 'bald',
    hairTone: bald ? null : hairToneRoll,
    eyeGap,
    eyeY,
    eyeScale,
    chinTaper,
    inset,
    thirdY,
    visorH,
    visorY,
    aerials,
    bolts,
    hornLen,
    hornCurl,
    muzzleW,
    tentacles,
    tentacleLen,
    flameH,
    brainScale,
    collar,
    plateH,
    seam,
    templeLight,
    templeFront,
    feelerLen,
    trunkLen,
    finLen,
    boltLen,
    jawW,
  };
}
