// ── features/match/logic/viewer/kits.ts ─────────────────────────────────────
// The kit rules for the match viewer (docs/match-viewer.md, sections 2C and 3):
// from the two club colours, decide what each side's outfield players and
// keeper wear on the pitch.
//
// WHY THIS EXISTS
//   Each club has ONE colour in `teams.color`, and those colours were never
//   checked against the pitch: some are near-black on the near-black grass,
//   some are almost the Lunar Dust of the figures' heads and arms, and some
//   pairs of clubs are nearly the same colour (Mercury Runners v Makemake is
//   dE 5). The keeper used to be a hollow dark-shirted figure, which read as a
//   referee in black; the owner chose to have no referee, so nothing on the
//   pitch may look like one.
//
// THE RULES (one of each, applied to every club and every pairing)
//   1. LEGIBILITY.  A kit colour is lifted (CIE L* raised, a* and b* kept, so
//      the hue survives) until it has at least GRASS_MIN_CONTRAST against the
//      lighter grass stripe; then it is deepened (L* lowered) until it is at
//      least FIGURE_MIN_DE from the figure colour and the ball.
//   2. CLASH.  If the two sides' legible kits are closer than CLASH_MIN_DE,
//      the home side keeps its colour and the away side changes to the
//      change kit (canvasColor.change*) most distinct from the home kit.
//   3. KEEPERS.  Each keeper wears the keeper kit (canvasColor.keeper*) most
//      distinct from both outfield kits (the away keeper also avoids the home
//      keeper's).  Keeper kits are bright on purpose: never dark, never
//      hollow, at least KEEPER_MIN_GRASS_CONTRAST on the grass.  The ground
//      marker under a keeper stays his team's colour, so he reads as part of
//      his side.
//
// MEASURES
//   - Contrast: WCAG 2.x relative-luminance contrast ratio (1:1 to 21:1);
//     3:1 is the WCAG 1.4.11 minimum for graphical objects.
//   - Colour difference: CIE76 dE, the Euclidean distance in CIELAB (D65).
//     About 2 is "just noticeable"; the clubs that looked alike on screen
//     measured under 15.  The thresholds below are well above that because a
//     figure is only a few pixels wide on a phone.
//
// PURE LOGIC: no React, no canvas.  The only import is the canvas palette.

import { canvasColor } from '../../../../shared/design';

// ── Thresholds ────────────────────────────────────────────────────────────

/** Minimum WCAG contrast of a kit against the lighter grass stripe. */
export const GRASS_MIN_CONTRAST = 3;
/** Minimum CIE76 dE of a kit from the figure colour (heads, arms) and the ball. */
export const FIGURE_MIN_DE = 25;
/** Minimum CIE76 dE between the two sides' outfield kits (else away changes). */
export const CLASH_MIN_DE = 35;
/** Minimum CIE76 dE between a keeper kit and both outfield kits. */
export const KEEPER_MIN_DE = 40;
/** Keepers are never dark: minimum WCAG contrast of a keeper kit on the grass. */
export const KEEPER_MIN_GRASS_CONTRAST = 4.5;

/** The references every kit is measured against. */
export const KIT_REFERENCE = {
  /** The lighter mowing stripe: the worst case for a dark kit. */
  grass: canvasColor.grassB,
  /** Lunar Dust: the heads and arms of every figure. */
  figure: canvasColor.text,
  /** The ball. */
  ball: canvasColor.ball,
} as const;

/** Change kits a clashing away side may wear, in preference order. */
export const CHANGE_KITS: readonly string[] = [
  canvasColor.changeBlue,
  canvasColor.changeRed,
  canvasColor.changeGreen,
  canvasColor.changeGold,
];

/** Keeper kits, in preference order. */
export const KEEPER_KITS: readonly string[] = [
  canvasColor.keeperYellow,
  canvasColor.keeperPink,
  canvasColor.keeperTeal,
  canvasColor.keeperOrange,
  canvasColor.keeperBlue,
];

// ── Shapes ────────────────────────────────────────────────────────────────

/** What one figure wears, every value a `#rrggbb` string. */
export interface Kit {
  /** Shirt (torso). */
  shirt: string;
  /** Shorts (legs): the same colour as the shirt. */
  shorts: string;
  /** Arms: Lunar Dust for outfield players, the kit colour for keepers (long sleeves). */
  sleeves: string;
  /** Sprite edge around shirt and shorts: a deep shade of the kit. */
  outline: string;
  /** Squad number on the chest: abyss or Lunar Dust, whichever contrasts more. */
  digits: string;
  /** Ground marker (and the carrier ring): always the team's outfield colour. */
  marker: string;
}

/** One side's kits. */
export interface SideKits {
  outfield: Kit;
  keeper: Kit;
}

/** Both sides' kits for one match. */
export interface MatchKits {
  home: SideKits;
  away: SideKits;
  /** True when the clash rule moved the away side into a change kit. */
  awayChanged: boolean;
}

// ── Colour math ───────────────────────────────────────────────────────────

/** sRGB channels in 0..255. */
interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** A CIELAB colour (D65). */
type Lab = readonly [number, number, number];

/**
 * Parse `#rgb` or `#rrggbb` into channels.
 *
 * @param hex  Colour text.
 * @returns    Channels, or null when the text is not a hex colour.
 */
export function parseHex(hex: string | null | undefined): Rgb | null {
  if (typeof hex !== 'string') return null;
  let h = hex.trim();
  if (h.startsWith('#')) h = h.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const n = Number.parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Channels to `#rrggbb`, clamped and rounded. */
function toHex({ r, g, b }: Rgb): string {
  const c = (v: number): string => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** sRGB gamma to linear light (0..1 in, 0..1 out). */
const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** Linear light to sRGB gamma. */
const fromLinear = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** Linear-light channels of a colour. */
function linearRgb(c: Rgb): [number, number, number] {
  return [toLinear(c.r / 255), toLinear(c.g / 255), toLinear(c.b / 255)];
}

/**
 * WCAG relative luminance.
 *
 * @param hex  `#rrggbb`.
 * @returns    0 (black) to 1 (white); 0 for unparseable text.
 */
export function relativeLuminance(hex: string): number {
  const c = parseHex(hex);
  if (!c) return 0;
  const [r, g, b] = linearRgb(c);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG contrast ratio between two colours.
 *
 * @returns  1 (identical) to 21 (black on white).
 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** D65 reference white. */
const XN = 0.95047;
const ZN = 1.08883;

/** sRGB hex to CIELAB. */
function toLab(hex: string): Lab {
  const c = parseHex(hex) ?? { r: 0, g: 0, b: 0 };
  const [r, g, b] = linearRgb(c);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / XN;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / ZN;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** CIELAB to sRGB hex, clipped into the sRGB gamut. */
function fromLab([l, a, bb]: Lab): string {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - bb / 200;
  const inv = (t: number): number => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const x = inv(fx) * XN;
  const y = inv(fy);
  const z = inv(fz) * ZN;
  const lin = [
    3.2406 * x - 1.5372 * y - 0.4986 * z,
    -0.9689 * x + 1.8758 * y + 0.0415 * z,
    0.0557 * x - 0.204 * y + 1.057 * z,
  ];
  const [r, g, b] = lin.map((v) => fromLinear(Math.max(0, Math.min(1, v))) * 255);
  return toHex({ r: r!, g: g!, b: b! });
}

/**
 * CIE76 colour difference (Euclidean distance in CIELAB).
 *
 * @returns  0 for identical colours; about 2 is just noticeable.
 */
export function deltaE(a: string, b: string): number {
  const p = toLab(a);
  const q = toLab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/**
 * Binary search for the L* (a* and b* fixed) where `ok` flips.  Returns the
 * colour at the passing end, so the result always satisfies `ok` when either
 * end does.
 */
function searchLightness(lab: Lab, from: number, to: number, ok: (hex: string) => boolean): string {
  let pass = to;
  let fail = from;
  for (let i = 0; i < 32; i++) {
    const mid = (pass + fail) / 2;
    if (ok(fromLab([mid, lab[1], lab[2]]))) pass = mid;
    else fail = mid;
  }
  return fromLab([pass, lab[1], lab[2]]);
}

// ── Rule 1: legibility ────────────────────────────────────────────────────

/** Contrast on the grass is enough. */
const onGrass = (hex: string): boolean => contrastRatio(hex, KIT_REFERENCE.grass) >= GRASS_MIN_CONTRAST;
/** Far enough from the figure colour and the ball. */
const apartFromFigures = (hex: string): boolean =>
  deltaE(hex, KIT_REFERENCE.figure) >= FIGURE_MIN_DE && deltaE(hex, KIT_REFERENCE.ball) >= FIGURE_MIN_DE;

/**
 * True when a colour passes the legibility rule unchanged.
 *
 * @param hex  `#rrggbb`.
 */
export function isLegibleKit(hex: string): boolean {
  return parseHex(hex) != null && onGrass(hex) && apartFromFigures(hex);
}

/**
 * Apply the legibility rule: lift a kit that is too dark for the grass, then
 * deepen one that is too close to the figure colour or the ball.  A legible
 * colour comes back unchanged (normalised to lower-case `#rrggbb`).
 *
 * @param hex       Club colour.
 * @param fallback  Used when `hex` is missing or unparseable.
 * @returns         A legible `#rrggbb`.
 */
export function legibleKit(hex: string | null | undefined, fallback: string): string {
  const base = parseHex(hex) ? toHex(parseHex(hex)!) : toHex(parseHex(fallback)!);
  let out = base;
  if (!onGrass(out)) {
    const lab = toLab(out);
    out = searchLightness(lab, lab[0], 100, onGrass);
  }
  if (!apartFromFigures(out)) {
    const lab = toLab(out);
    // Deepen, but never below the grass contrast floor just reached.
    out = searchLightness(lab, lab[0], 0, (c) => apartFromFigures(c));
    if (!onGrass(out)) out = searchLightness(toLab(out), toLab(out)[0], 100, (c) => onGrass(c) && apartFromFigures(c));
  }
  return out;
}

// ── Building a kit ────────────────────────────────────────────────────────

/** A deep shade of a colour for the sprite edge (L* scaled down, hue kept). */
function outlineOf(hex: string): string {
  const [l, a, b] = toLab(hex);
  return fromLab([l * 0.4, a * 0.6, b * 0.6]);
}

/** Abyss or Lunar Dust digits, whichever contrasts more with the shirt. */
function digitsOn(hex: string): string {
  return contrastRatio(hex, canvasColor.bg) >= contrastRatio(hex, canvasColor.text) ? canvasColor.bg : canvasColor.text;
}

/** An outfield kit in one colour. */
function outfieldKit(colour: string): Kit {
  return {
    shirt: colour,
    shorts: colour,
    sleeves: canvasColor.text,
    outline: outlineOf(colour),
    digits: digitsOn(colour),
    marker: colour,
  };
}

/** A keeper kit: long sleeves in the kit colour, his team's ground marker. */
function keeperKit(colour: string, teamMarker: string): Kit {
  return { ...outfieldKit(colour), sleeves: colour, marker: teamMarker };
}

/** The candidate whose smallest dE to `against` is largest (first wins ties). */
function mostDistinct(candidates: readonly string[], against: readonly string[]): string {
  let best = candidates[0]!;
  let bestScore = -1;
  for (const c of candidates) {
    const score = Math.min(...against.map((x) => deltaE(c, x)));
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

// ── Rules 2 and 3: clash and keepers ──────────────────────────────────────

/**
 * Resolve both sides' kits for a match.
 *
 * @param homeColor  Home club colour (`teams.color`), or null.
 * @param awayColor  Away club colour, or null.
 * @returns          Outfield and keeper kits per side, and whether away changed.
 */
export function resolveKits(homeColor: string | null | undefined, awayColor: string | null | undefined): MatchKits {
  const home = legibleKit(homeColor, canvasColor.kitHome);
  let away = legibleKit(awayColor, canvasColor.kitAway);
  let awayChanged = false;
  if (deltaE(home, away) < CLASH_MIN_DE) {
    away = mostDistinct(CHANGE_KITS.map((c) => legibleKit(c, c)), [home]);
    awayChanged = true;
  }
  const keepers = KEEPER_KITS.map((c) => legibleKit(c, c));
  const homeKeeper = mostDistinct(keepers, [home, away]);
  const awayKeeper = mostDistinct(
    keepers.filter((c) => c !== homeKeeper),
    [home, away, homeKeeper],
  );
  return {
    home: { outfield: outfieldKit(home), keeper: keeperKit(homeKeeper, home) },
    away: { outfield: outfieldKit(away), keeper: keeperKit(awayKeeper, away) },
    awayChanged,
  };
}
