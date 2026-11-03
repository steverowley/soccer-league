// ── features/match/ui/viewer/figure.ts ──────────────────────────────────────
// The "Charming" figure in the Tiny Terraces style (docs/match-viewer.md
// section 6), ported from the owner-approved sketch (`species-picker.html`).
//
// PIXEL-PURE
//   Every figure is drawn on one coarse grid: a figure pixel is GRID x GRID
//   backing pixels (the 1x art grid of the 640 x 416 canvas), every rectangle
//   snaps to it, and lines are stepped pixel by pixel.  No antialiased fills,
//   glows or blur on a figure.
//
// THE BODY
//   A big round head about a quarter of his height, a soft rounded shirt in
//   the club colour, short sturdy Lunar Dust legs with club-colour socks and
//   little feet, floppy spring arms (logic/viewer/arms.ts) with hands, a
//   breathing bob when he stands and a 1 px bounce per step.  Poses (kick,
//   slide, dive, fall, celebration...) rotate the body about the hips; a body
//   lying down rests on the grass and nothing pokes through it.
//
// THE PEOPLES
//   Thirteen heads.  Peoples change silhouette and eyes only, never hue:
//   heads and features use the Lunar Dust shades of the canvas palette, plus
//   the glow shade for lights.  Per-player variation comes from Appearance.
//
// PERFORMANCE
//   22+ figures a frame at 60 fps on a phone: scalar maths into one scratch
//   buffer (no per-frame allocation), stepped lines merged into runs, and
//   fillStyle only set when the colour changes.

import { canvasColor } from '../../../../shared/design';
import type { ActionBody, Appearance, ArmState, Kit } from '../../logic/viewer';

/** Lunar Dust: legs, hands and the default head. */
const DUST = canvasColor.text;
/** Galactic Abyss: eyes and visors. */
const ABYSS = canvasColor.bg;
const LIGHT = canvasColor.figureLight;
const MID = canvasColor.figureMid;
const DARK = canvasColor.figureDark;
const GLOW = canvasColor.figureGlow;

/** The Charming build, in figure pixels at scale 1 (the sketch's PROPS.charming). */
export const CHARM = {
  /** Head width and height. */
  hw: 4,
  hh: 4,
  /** Shoulder width, torso height, shorts height. */
  sw: 5,
  tor: 4,
  sh: 2,
  /** Thigh and shin length, leg thickness. */
  thigh: 2.3,
  shin: 2.1,
  legW: 1.4,
  /** Arm thickness, upper and fore arm length. */
  armW: 1.15,
  a1: 2.3,
  a2: 2.1,
} as const;

/** Arm angles used when a figure has no arm state (tests, a still). */
const REST_A = 0.62;
const REST_B = 0.35;

/** Everything one figure needs this frame. */
export interface FigureSpec {
  /** Where his feet meet the grass, in figure pixels (backing pixels / grid). */
  x: number;
  y: number;
  /** Figure scale: 1 is the sketch's figure; nearer and zoomed figures are larger. */
  f: number;
  /** +1 faces right, -1 left. */
  face: number;
  kit: Kit;
  look: Appearance;
  /** Stride phase (radians) and how hard he runs (0..1). */
  phase: number;
  run: number;
  /** An event pose, or null for his gait. */
  act: ActionBody | null;
  /** His spring arms (null: arms at rest). */
  arms: ArmState | null;
  /** Seconds on the viewer's real-time clock (blinks, breathing, flicker). */
  t: number;
}

// ── Pixel primitives ──────────────────────────────────────────────────────────

/** Backing pixels per figure pixel for the figure being drawn. */
let grid = 2;
/** The fill colour last set (fillStyle is only set when it changes). */
let curFill = '';

/** Forget the cached fill colour (call after anything else set fillStyle or restored the context). */
export function resetFill(): void {
  curFill = '';
}

/** Set the grid (backing pixels per figure pixel) for the primitives below. */
export function setGrid(g: number): void {
  grid = g;
}

function useFill(ctx: CanvasRenderingContext2D, col: string): void {
  if (col !== curFill) {
    ctx.fillStyle = col;
    curFill = col;
  }
}

/** A filled rectangle snapped to the grid (at least one figure pixel). */
export function px(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, col: string): void {
  useFill(ctx, col);
  ctx.fillRect(Math.round(x) * grid, Math.round(y) * grid, Math.max(1, Math.round(w)) * grid, Math.max(1, Math.round(h)) * grid);
}

/**
 * A stepped line `t` figure pixels thick: one square per step, merged into
 * runs along the major axis so a long line is a few rectangles.  With
 * `skipFirst`, the first point is left out (polylines with a translucent
 * colour would otherwise draw their joints twice).
 */
export function pline(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  col: string,
  t = 1,
  skipFirst = false,
): void {
  useFill(ctx, col);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  const off = (t - 1) / 2;
  const horiz = Math.abs(dx) >= Math.abs(dy);
  let r0 = 0;
  let r1 = 0;
  let rk = 0;
  let open = false;
  for (let i = skipFirst ? 1 : 0; i <= n; i++) {
    const x = Math.round(x0 + (dx * i) / n - off);
    const y = Math.round(y0 + (dy * i) / n - off);
    const along = horiz ? x : y;
    const across = horiz ? y : x;
    if (open && across === rk && along >= r0 - 1 && along <= r1 + 1) {
      if (along < r0) r0 = along;
      if (along > r1) r1 = along;
      continue;
    }
    if (open) flushRun(ctx, horiz, r0, r1, rk, t);
    r0 = along;
    r1 = along;
    rk = across;
    open = true;
  }
  if (open) flushRun(ctx, horiz, r0, r1, rk, t);
}

function flushRun(ctx: CanvasRenderingContext2D, horiz: boolean, a0: number, a1: number, k: number, t: number): void {
  if (horiz) ctx.fillRect(a0 * grid, k * grid, (a1 - a0 + t) * grid, t * grid);
  else ctx.fillRect(k * grid, a0 * grid, t * grid, (a1 - a0 + t) * grid);
}

/** A rectangle with its corners knocked off (the sketch's soft round shapes). */
export function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: number, col: string): void {
  x = Math.round(x);
  y = Math.round(y);
  w = Math.round(w);
  h = Math.round(h);
  // A corner never eats a whole side (a 4 x 4 head with a 2 px corner would be a cross).
  c = Math.min(c, Math.floor((Math.min(w, h) - 1) / 2));
  if (c <= 0 || w < 3 || h < 3) {
    px(ctx, x, y, w, h, col);
    return;
  }
  px(ctx, x, y + c, w, h - 2 * c, col);
  px(ctx, x + c, y, w - 2 * c, h, col);
  if (c >= 2) px(ctx, x + 1, y + 1, w - 2, h - 2, col);
}

/** A filled ellipse made of whole figure-pixel rows. */
export function pixelEllipse(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, col: string): void {
  if (rx <= 0 || ry <= 0) return;
  useFill(ctx, col);
  const top = Math.round(cy - ry);
  const bot = Math.round(cy + ry);
  for (let yy = top; yy < bot; yy++) {
    const d = (yy + 0.5 - cy) / ry;
    if (d <= -1 || d >= 1) continue;
    const hw = rx * Math.sqrt(1 - d * d);
    const a = Math.round(cx - hw);
    const b = Math.round(cx + hw);
    if (b > a) ctx.fillRect(a * grid, yy * grid, (b - a) * grid, grid);
  }
}

/** A one-pixel ellipse outline made of whole figure-pixel rows. */
export function pixelRing(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, col: string): void {
  if (rx <= 1 || ry <= 1) {
    pixelEllipse(ctx, cx, cy, rx, ry, col);
    return;
  }
  useFill(ctx, col);
  const top = Math.round(cy - ry);
  const bot = Math.round(cy + ry);
  for (let yy = top; yy < bot; yy++) {
    const d = (yy + 0.5 - cy) / ry;
    if (d <= -1 || d >= 1) continue;
    const hw = rx * Math.sqrt(1 - d * d);
    const a = Math.round(cx - hw);
    const b = Math.round(cx + hw);
    const di = (yy + 0.5 - cy) / (ry - 1);
    if (yy === top || yy === bot - 1 || di <= -1 || di >= 1) {
      if (b > a) ctx.fillRect(a * grid, yy * grid, (b - a) * grid, grid);
      continue;
    }
    const ihw = (rx - 1) * Math.sqrt(1 - di * di);
    const ia = Math.max(a + 1, Math.round(cx - ihw));
    const ib = Math.min(b - 1, Math.round(cx + ihw));
    ctx.fillRect(a * grid, yy * grid, (ia - a) * grid, grid);
    ctx.fillRect(ib * grid, yy * grid, (b - ib) * grid, grid);
  }
}

/** Set an alpha multiplier without save/restore (which would also reset fillStyle). */
function withAlpha(ctx: CanvasRenderingContext2D, k: number, draw: () => void): void {
  const ga = ctx.globalAlpha;
  ctx.globalAlpha = ga * k;
  draw();
  ctx.globalAlpha = ga;
}

// ── The body ──────────────────────────────────────────────────────────────────

/**
 * Scratch points (x, y pairs): legs 0-5, arms 6-11, head 12, shoulders 13,
 * waist 14, hips 15, shoulder line 16.  One buffer for every figure: a frame allocates nothing.
 */
const PT = new Float64Array(34);

/**
 * Up to this whole-body tilt (radians) a figure is drawn upright in crisp
 * blocks with his shoulders shifted (a lunge, a stumble, a header); beyond
 * it, along his rotated body (a slide, a fall, a dive).
 */
const UPRIGHT_MAX_TILT = 0.7;

/** Leg poses: [kicking thigh, its knee, other thigh, its knee] fully in the pose. */
const LEG_POSE = {
  // Leg angles are in the body's frame (the world angle is this minus the tilt):
  // in a slide (tilt -0.9) the front leg runs along the grass, the back leg tucks under.
  slide: [0.6, 0, -0.4, 1.4],
  dive: [-0.25, 0.6, 0.1, 0.2],
  down: [0.35, 0.7, -0.1, 0.1],
  lunge: [1.2, 0.05, -0.2, 0.3],
  stumble: [-0.35, 0.4, 0.25, 0.1],
} as const;

/**
 * Draw one figure.  `grid` backing pixels make one figure pixel.
 *
 * @param ctx   The canvas.
 * @param s     Where, how big, who, and what he is doing.
 * @param g     Backing pixels per figure pixel.
 */
export function drawFigure(ctx: CanvasRenderingContext2D, s: FigureSpec, g: number): void {
  grid = g;
  curFill = '';
  const { x, y, f, face, kit, look, act } = s;
  const celebrating = act != null && act.arms === 'celebrate';
  const run = act && !celebrating ? 0 : s.run;
  const ph = s.phase;
  const LEG = Math.max(1, Math.round(CHARM.legW * f));
  const ARM = Math.max(1, Math.round(CHARM.armW * f));
  const thighL = CHARM.thigh * f * look.legScale;
  const shinL = CHARM.shin * f * look.legScale;
  const shH = Math.max(1, Math.round(CHARM.sh * f));
  const torH = Math.max(2, Math.round(CHARM.tor * f));
  const SW = Math.max(3, Math.round(CHARM.sw * f * look.shoulder) | 1);
  const HW = Math.max(3, Math.round(CHARM.hw * f * look.headScale));
  const HH = Math.max(3, Math.round(CHARM.hh * f * look.headScale));
  const rot = act ? act.tilt : 0;
  const lift = act ? act.lift * f : 0;
  const lying = act ? act.lying : false;

  // Legs: thigh angle from straight down (+ forward) and knee bend.
  let a0 = 0.06 + 0.75 * run * Math.sin(ph);
  let a1 = -0.06 + 0.75 * run * Math.sin(ph + Math.PI);
  let k0 = 0.05 + run * (0.15 + 0.8 * Math.max(0, -Math.cos(ph)) * Math.max(0, -Math.sin(ph) + 0.3));
  let k1 = 0.05 + run * (0.15 + 0.8 * Math.max(0, Math.cos(ph)) * Math.max(0, Math.sin(ph) + 0.3));
  if (act && act.legs === 'kick') {
    const kl = act.kickLeg;
    a0 = kl >= 0 ? 1.1 * kl : 0.7 * kl;
    k0 = 0.1 + 1.2 * Math.max(0, -kl);
    a1 = -0.12;
    k1 = 0.1;
  } else if (act && act.legs !== 'gait' && act.legs !== 'kick') {
    const L = LEG_POSE[act.legs];
    const w = act.kickLeg;
    a0 += (L[0] - a0) * w;
    k0 += (L[1] - k0) * w;
    a1 += (L[2] - a1) * w;
    k1 += (L[3] - k1) * w;
  }

  // A pixel down on each footfall when running; a slow breath when standing.
  const bob = run > 0.3 ? (Math.cos(2 * ph) > 0.2 ? 1 : 0) : !act && (s.t * 0.75 + look.seed * 7) % 1 < 0.5 ? 1 : 0;
  const legLen = thighL + shinL * 0.98;
  const baseY = y - lift - legLen;
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const lean = 0.16 * run;
  const ur = rot + lean;
  const cu = Math.cos(ur);
  const su = Math.sin(ur);
  // Local frame: origin at the hips, x forward (mirrored by face), y down.
  const put = (i: number, lx: number, ly: number, upper: boolean): void => {
    const c = upper ? cu : cr;
    const sn = upper ? su : sr;
    PT[2 * i] = x + face * (lx * c - ly * sn);
    PT[2 * i + 1] = baseY + (lx * sn + ly * c);
  };
  const hipHalf = (SW / 2 - LEG / 2 - Math.max(0, Math.round(f * 0.4))) * (rot ? 0.3 : 1);
  for (let i = 0; i < 2; i++) {
    const a = i ? a1 : a0;
    const k = i ? k1 : k0;
    const hx = (i ? 1 : -1) * hipHalf;
    const kx = hx + Math.sin(a) * thighL;
    const ky = Math.cos(a) * thighL;
    put(3 * i, hx, 0, false);
    put(3 * i + 1, kx, ky, false);
    put(3 * i + 2, kx + Math.sin(a - k) * shinL, ky + Math.cos(a - k) * shinL, false);
  }
  const shY = -(shH + torH);
  put(12, 0, shY - HH / 2 + Math.round(f * 0.3), true);
  put(13, 0, shY, true);
  put(14, 0, -shH, false);
  // Arms: index 0 the back arm (side -1), 1 the front arm (side +1).
  const arms = s.arms;
  for (let i = 0; i < 2; i++) {
    const side = i ? 1 : -1;
    const arm = arms ? (i ? arms.front : arms.back) : null;
    const a = arm ? arm.a : REST_A;
    const b = arm ? arm.b : REST_B;
    const sx = side * (SW / 2 - ARM / 2);
    const sy = shY + ARM / 2 + Math.round(f * 0.4);
    const ex = sx + side * Math.sin(a) * CHARM.a1 * f;
    const ey = sy + Math.cos(a) * CHARM.a1 * f;
    put(6 + 3 * i, sx, sy, true);
    put(7 + 3 * i, ex, ey, true);
    put(8 + 3 * i, ex + side * Math.sin(a + b) * CHARM.a2 * f, ey + Math.cos(a + b) * CHARM.a2 * f, true);
  }
  // Rest on the ground: a lying body sits on it, nothing pokes through it.
  let maxY = -1e9;
  for (const i of BODY_POINTS) maxY = Math.max(maxY, PT[2 * i + 1]! + LEG / 2);
  const shift = lying && lift < 0.5 ? y - maxY : Math.min(0, y - maxY);
  const floor = y - LEG / 2;
  const sy = (i: number, b: number): number => Math.min(floor, PT[2 * i + 1]! + shift + b);

  const sock = kit.shirt;
  const leg = (i: number, b: number): void => {
    const h = 3 * i;
    const hx = PT[2 * h]!;
    const hy = sy(h, b);
    const kx = PT[2 * h + 2]!;
    const ky = sy(h + 1, 0);
    const fx = PT[2 * h + 4]!;
    const fy = sy(h + 2, 0);
    pline(ctx, hx, hy, kx, ky, DUST, LEG);
    const mx = kx + (fx - kx) * 0.35;
    const my = ky + (fy - ky) * 0.35;
    pline(ctx, kx, ky, mx, my, DUST, LEG);
    pline(ctx, mx, my, fx, fy, sock, LEG); // socks in the club colour
    const fw = Math.max(1, Math.round(f * 0.9));
    const fh = Math.max(1, Math.round(f * 0.6));
    px(ctx, fx - LEG / 2 + 0.5 + (face > 0 ? LEG - 1 : -fw + 1) * (rot ? 0 : 1), fy + LEG / 2 - 0.5 - fh + 1, fw, fh, MID);
  };
  const arm = (i: number, b: number): void => {
    const h = 6 + 3 * i;
    const x0 = PT[2 * h]!;
    const y0 = sy(h, b);
    const x1 = PT[2 * h + 2]!;
    const y1 = sy(h + 1, b);
    const x2 = PT[2 * h + 4]!;
    const y2 = sy(h + 2, b);
    pline(ctx, x0, y0, x1, y1, kit.shirt, ARM); // sleeve
    pline(ctx, x1, y1, x2, y2, kit.sleeves, ARM); // forearm (a keeper's long sleeve)
    const hs = ARM + (f > 1.5 ? 1 : 0);
    px(ctx, x2 - hs / 2 + 0.5, y2 - hs / 2 + 0.5, hs, hs, DUST); // hand
  };

  const back = face > 0 ? 1 : 0;
  const front = 1 - back;
  if (Math.abs(ur) < UPRIGHT_MAX_TILT) {
    // Upright: crisp blocks; a lean is a pixel or two at the shoulders.
    const hipY = Math.min(floor, baseY + shift + bob);
    const lx = Math.round(Math.sin(ur) * torH * 0.6);
    const top = Math.round(hipY - shH - torH);
    leg(back, bob);
    arm(1, bob);
    const m = Math.max(0, Math.round(f * 0.4));
    px(ctx, x - (SW - 2 * m) / 2 + 0.5, hipY - shH, SW - 2 * m, shH, kit.shorts);
    rrect(ctx, x - SW / 2 + 0.5 + face * lx, top, SW, torH + 1, SW >= 7 ? 2 : 1, kit.shirt);
    leg(front, bob);
    drawHead(ctx, x + face * lx, top - HH + Math.round(f * 0.3), HW, HH, f, face, look, s.t);
    arm(0, bob);
    return;
  }
  // Pitched over (a slide, a dive, on the ground): thick strokes along the body.
  put(15, 0, 0, false);
  put(16, 0, shY + 1, true);
  leg(1, 0);
  leg(0, 0);
  const hipX = PT[30]!;
  const hipY = sy(15, 0);
  const waistX = PT[28]!;
  const waistY = sy(14, 0);
  // Seen side-on, the body is a little thinner than it is wide.
  pline(ctx, hipX, hipY, waistX, waistY, kit.shorts, Math.max(2, Math.round(SW * 0.65)));
  pline(ctx, waistX, waistY, PT[32]!, sy(16, 0), kit.shirt, Math.max(2, Math.round(SW * 0.8)));
  drawHead(ctx, PT[24]!, sy(12, 0) - HH / 2, HW, HH, f, face, look, s.t);
  arm(1, 0);
  arm(0, 0);
}

/** The points a lying body rests on: legs, head, shoulders, waist. */
const BODY_POINTS = [0, 1, 2, 3, 4, 5, 12, 13, 14] as const;

// ── Heads: the thirteen peoples ───────────────────────────────────────────────
// Ported from the sketch's drawCharmHead (Terran, Grey, Trinocular, Synth,
// Taurid, Cephalid, Ignid, Dome, Android) and drawGenHead (the generated
// genomes Slyari, Fenthrai, Ohm K and Quoo, kept as fixed heads), with the
// per-player variation from Appearance.  `top` is the head's top edge for a
// plain head; taller heads grow upward from the same chin line.

/** Head state shared by the helpers below (set at the top of drawHead). */
let hBlink = false;
let hLook = 0;

/** An eye in Abyss that closes to a line on a blink. */
function eye(ctx: CanvasRenderingContext2D, ex: number, ey: number, w: number, h: number): void {
  ex = Math.round(ex);
  ey = Math.round(ey);
  if (hBlink) px(ctx, ex, ey + h - 1, w, 1, ABYSS);
  else px(ctx, ex, ey, w, h, ABYSS);
}

/** Two eyes of size e at a height and spacing (fractions of the head), looking where he runs. */
function twoEyes(ctx: CanvasRenderingContext2D, cx: number, y0: number, W: number, H: number, f: number, yFrac: number, gapFrac: number, scale = 1): void {
  if (W < 4) return;
  const e = Math.max(1, Math.round(f * 0.8 * scale));
  const ey = y0 + Math.round(H * yFrac);
  const g = Math.max(1, Math.round(W * gapFrac));
  eye(ctx, cx + hLook - g - e / 2 + 0.5, ey, e, e);
  eye(ctx, cx + hLook + g - e / 2 + 0.5, ey, e, e);
}

/** A flame of columns over the head (Ignid, Fenthrai), flickering with the clock. */
function flame(ctx: CanvasRenderingContext2D, x0: number, y0: number, W: number, H: number, u: number, height: number, t: number, sd: number, embers: boolean): void {
  const cols = Math.max(3, Math.round(W / u));
  for (let i = 0; i < cols; i++) {
    const edge = 1 - Math.abs((i + 0.5) / cols - 0.5) * 1.6;
    const hgt = Math.max(1, Math.round(H * height * edge * (0.55 + 0.45 * Math.abs(Math.sin(t * 9 + i * 1.7 + sd)))));
    px(ctx, x0 + i * u, y0 - hgt + u, u, hgt, DUST);
    px(ctx, x0 + i * u, y0 - hgt + u, u, Math.max(1, Math.round(hgt * 0.35)), GLOW);
    if (embers && (i + Math.floor(t * 10)) % 3 === 0) px(ctx, x0 + i * u, y0 - hgt - u + 1, u, u, MID);
  }
}

/** Two horns from the head's top corners (Taurid, Quoo). */
function horns(ctx: CanvasRenderingContext2D, x0: number, y0: number, W: number, u: number, f: number, len: number, curl: number): void {
  const t1 = Math.max(1, Math.round(f * 0.5));
  for (let sd = -1; sd <= 1; sd += 2) {
    const bx = sd < 0 ? x0 : x0 + W - 1;
    const ex = bx + sd * 1.2 * u * len;
    const ey = y0 - 0.2 * u;
    pline(ctx, bx, y0 + u, ex, ey, LIGHT, Math.max(1, Math.round(f * 0.7)));
    pline(ctx, ex, ey, ex + sd * u * (0.2 - 0.8 * curl), ey - 1.4 * u * len, LIGHT, t1);
  }
}

/** Freckles across the cheeks (only where there are pixels for them). */
function freckles(ctx: CanvasRenderingContext2D, cx: number, y0: number, W: number, H: number, u: number): void {
  if (u <= 1) return;
  for (const dx of FRECKLES) px(ctx, Math.round(cx + dx * W), y0 + Math.round(H * 0.72), 1, 1, MID);
}
const FRECKLES = [-0.3, -0.18, 0.18, 0.3] as const;

/** A bulb skull tapering to a small chin (Grey, Slyari). */
function bulb(ctx: CanvasRenderingContext2D, cx: number, x0: number, y0: number, W: number, H: number, c: number, taper: number, tone: string): void {
  rrect(ctx, x0, y0, W, Math.round(H * 0.72), c, tone);
  const cw = Math.max(1, W - 2 * Math.max(1, Math.round(W * taper)));
  rrect(ctx, Math.round(cx - cw / 2 + 0.5), y0 + Math.round(H * 0.6), cw, H - Math.round(H * 0.6), 1, tone);
}

/**
 * Draw a head.
 *
 * @param cx    Centre x of the head (figure pixels).
 * @param top   Top edge of a plain head.
 * @param HW    Plain head width and height (already varied by head size).
 * @param f     Figure scale (features below one figure pixel are dropped).
 * @param face  +1 right, -1 left (he looks where he faces).
 * @param a     His appearance.
 * @param t     Clock seconds (blinks, flicker, scans).
 */
export function drawHead(
  ctx: CanvasRenderingContext2D,
  cx: number,
  top: number,
  HW: number,
  HH: number,
  f: number,
  face: number,
  a: Appearance,
  t: number,
): void {
  const u = Math.max(1, Math.round(f));
  const t1 = Math.max(1, Math.round(f * 0.5));
  const bottom = Math.round(top + HH);
  const sd = a.seed * 6.283;
  const tone = a.tone;
  hBlink = (t + a.seed * 3.4) % 3.4 < 0.13;
  hLook = Math.round(face * HW * 0.12);
  let W = HW;
  let H = HH;
  switch (a.species) {
    case 'grey':
    case 'slyari':
      W = HW + 2 * u;
      H = HH + u;
      break;
    case 'trinocular':
    case 'cephalid':
      H = HH + u;
      break;
    case 'android':
      H = HH + (u > 1 ? 1 : 0);
      break;
    case 'synth':
      W = HW + (u > 1 ? 1 : 0);
      break;
    case 'ohmk':
      W = Math.max(4, HW - u);
      H = Math.max(3, HH - u);
      break;
    default:
      break;
  }
  const x0 = Math.round(cx - W / 2 + 0.5);
  const y0 = bottom - H;
  const c = W >= 7 ? 2 : 1;

  switch (a.species) {
    case 'grey': {
      // Big bulb skull tapering to a small chin; two large slanted black eyes.
      bulb(ctx, cx, x0, y0, W, H, c, a.chinTaper, tone);
      const ew = Math.max(1, Math.round(W * 0.22 * a.eyeScale));
      const eh = Math.max(1, Math.round(H * 0.2 * a.eyeScale));
      const ey = y0 + Math.round(H * 0.4);
      const gap = Math.max(1, Math.round(W * 0.12));
      const lx = Math.round(cx + hLook - gap / 2 - ew + 0.5);
      const rx = Math.round(cx + hLook + gap / 2 + 0.5);
      eye(ctx, lx, ey, ew, eh);
      eye(ctx, rx, ey, ew, eh);
      if (!hBlink && u > 1) {
        // The outer corners tilt up.
        px(ctx, lx - 1, ey - 1, Math.ceil(ew / 2), 1, ABYSS);
        px(ctx, rx + ew - Math.ceil(ew / 2) + 1, ey - 1, Math.ceil(ew / 2), 1, ABYSS);
      }
      return;
    }
    case 'trinocular': {
      // A tall head with a third eye above the other two.
      rrect(ctx, x0, y0, W, H, c, tone);
      const e = Math.max(1, Math.round(f * 0.8 * a.eyeScale));
      const inset = Math.max(1, Math.round(W * a.inset));
      eye(ctx, x0 + inset, y0 + Math.round(H * 0.56), e, e);
      eye(ctx, x0 + W - inset - e, y0 + Math.round(H * 0.56), e, e);
      eye(ctx, x0 + Math.round((W - e) / 2), y0 + Math.round(H * a.thirdY), e, e);
      return;
    }
    case 'synth': {
      // Hard-edged box head, a visor with a scanning light, bolts, aerials.
      px(ctx, x0, y0, W, H, tone);
      const vh = Math.max(1, Math.round(H * a.visorH));
      const vy = y0 + Math.round(H * a.visorY);
      const vi = Math.max(0, Math.round(u * 0.5));
      px(ctx, x0 + vi, vy, W - 2 * vi, vh, ABYSS);
      const k = (Math.sin(t * 3 + sd) + 1) / 2;
      const lw = Math.max(1, Math.round(u * 0.8));
      px(ctx, x0 + vi + Math.round(k * (W - 2 * vi - lw)), vy, lw, vh, GLOW);
      if (a.bolts) {
        px(ctx, x0 - u, y0 + Math.round(H * 0.45), u, u, MID);
        px(ctx, x0 + W, y0 + Math.round(H * 0.45), u, u, MID);
      }
      const inset = Math.max(0, u - 1);
      const ah = Math.round(1.6 * u);
      for (let n = 0; n < a.aerials; n++) {
        // One aerial stands at the side he faces; a second at the other side.
        const atFront = (n === 0) === face > 0;
        const ax = atFront ? x0 + W - u - inset : x0 + inset;
        px(ctx, ax, y0 - ah, t1, ah, MID);
        px(ctx, ax - (u > 1 ? 1 : 0), y0 - ah - u, u + (u > 1 ? 1 : 0), u, DUST);
      }
      return;
    }
    case 'taurid': {
      // Curled horns and a broad muzzle.
      rrect(ctx, x0, y0, W, H, c, tone);
      horns(ctx, x0, y0, W, u, f, a.hornLen, a.hornCurl);
      const mw = Math.max(2, Math.round(W * a.muzzleW));
      const mh = Math.max(1, Math.round(H * 0.28));
      const mx = Math.round(cx - mw / 2 + 0.5 + face * Math.round(u * 0.4));
      px(ctx, mx, bottom - mh, mw, mh, LIGHT);
      if (u > 1) {
        px(ctx, Math.round(cx - mw / 4 + face * Math.round(u * 0.4)), bottom - mh + 1, 1, 1, MID);
        px(ctx, Math.round(cx + mw / 4 - 1 + face * Math.round(u * 0.4)), bottom - mh + 1, 1, 1, MID);
      }
      twoEyes(ctx, cx, y0, W, H, f, 0.34, 0.26);
      return;
    }
    case 'cephalid': {
      // A tall soft dome with swaying face tentacles.
      rrect(ctx, x0, y0, W, H, c, tone);
      const n = a.tentacles;
      for (let i = 0; i < n; i++) {
        const tx = x0 + Math.round(((i + 0.5) * W) / n);
        const sw = Math.sin(t * 5 + i * 1.3 + sd) * 0.8 * u;
        const len = (i > 0 && i < n - 1 ? 2.4 : 1.8) * u * a.tentacleLen;
        pline(ctx, tx, bottom - 1, tx + sw, bottom + len, tone, t1);
      }
      twoEyes(ctx, cx, y0, W, H, f, 0.5, 0.22);
      return;
    }
    case 'ignid': {
      // A head of flickering flame.
      rrect(ctx, x0, y0, W, H, c, tone);
      flame(ctx, x0, y0, W, H, u, 1.25 * a.flameH, t, sd, true);
      twoEyes(ctx, cx, y0, W, H, f, 0.5, 0.22);
      return;
    }
    case 'dome': {
      // A glass bubble on a metal collar; inside, a small brain that pulses.
      const DW = W + 2 * u;
      const dx = Math.round(cx - DW / 2 + 0.5);
      const collar = Math.max(1, Math.round(H * a.collar));
      const DH = H + u;
      px(ctx, dx - (u > 1 ? 1 : 0), bottom - collar, DW + (u > 1 ? 2 : 0), collar, MID);
      const gTop = bottom - collar - DH + 1;
      withAlpha(ctx, 0.55, () => rrect(ctx, dx, gTop, DW, DH, Math.min(3, c + 1), LIGHT));
      // The glass rim and a highlight.
      px(ctx, dx + 2, gTop, DW - 4, 1, DUST);
      px(ctx, dx, gTop + 2, 1, DH - 3, DUST);
      px(ctx, dx + DW - 1, gTop + 2, 1, DH - 3, DUST);
      px(ctx, dx + 1, gTop + 1, 1, 1, DUST);
      px(ctx, dx + DW - 2, gTop + 1, 1, 1, DUST);
      px(ctx, dx + (face > 0 ? 2 : DW - 3), gTop + 2, 1, Math.max(1, Math.round(DH * 0.3)), GLOW);
      const bw = Math.max(2, Math.round(DW * 0.45 * a.brainScale));
      const bh = Math.max(2, Math.round(DH * 0.4 * a.brainScale));
      const pulse = Math.sin(t * 3 + sd) > 0 ? 1 : 0;
      const bx = Math.round(cx - bw / 2 + 0.5);
      const by = bottom - collar - bh - Math.max(1, Math.round(u * 0.5));
      rrect(ctx, bx, by - pulse, bw, bh + pulse, 1, tone);
      if (u > 1) {
        px(ctx, bx + 1, by + Math.round(bh / 2) - pulse, bw - 2, 1, MID);
        px(ctx, bx + Math.round(bw / 2), by + 1 - pulse, 1, bh - 2, MID);
      }
      if (W >= 4) {
        const e = Math.max(1, Math.round(f * 0.5));
        px(ctx, dx + (face > 0 ? DW - 2 * u - e : u + 1), bottom - collar + Math.round(collar / 2 - e / 2), e, e, hBlink ? MID : GLOW);
      }
      return;
    }
    case 'android': {
      // A smooth shell, a dark faceplate with two glowing slit eyes, a seam and a temple light.
      rrect(ctx, x0, y0, W, H, Math.min(3, c + 1), tone);
      const fpW = Math.max(3, W - 2 * Math.max(1, Math.round(u * 0.6)));
      const fpH = Math.max(2, Math.round(H * a.plateH));
      const fx = Math.round(cx - fpW / 2 + 0.5 + hLook);
      const fy = y0 + Math.round(H * 0.32);
      rrect(ctx, fx, fy, fpW, fpH, fpW >= 6 ? 1 : 0, DARK);
      slits(ctx, fx, fy, fpW, fpH);
      if (a.seam) px(ctx, Math.round(cx - 0.5), y0 + 1, 1, Math.max(1, fy - y0 - 1), LIGHT);
      if (a.templeLight) {
        const front = a.templeFront ? face > 0 : face <= 0;
        const k = 0.5 + 0.5 * Math.sin(t * 4 + sd);
        withAlpha(ctx, 0.4 + 0.6 * k, () => px(ctx, front ? x0 + W - u : x0, y0 + Math.round(H * 0.25), u, u, GLOW));
      }
      return;
    }
    case 'slyari': {
      // Generated genome: bulb head, one big eye, feelers, a trunk, freckles.
      bulb(ctx, cx, x0, y0, W, H, c, 0.22, tone);
      freckles(ctx, cx, y0, W, H, u);
      const e = Math.max(2, Math.round(W * 0.4 * a.eyeScale));
      const eh = Math.max(1, Math.round(H * 0.38 * a.eyeScale));
      const ex = Math.round(cx - e / 2 + 0.5);
      const ey = y0 + Math.round(H * 0.3);
      if (hBlink) px(ctx, ex, ey + eh - 1, e, 1, ABYSS);
      else {
        rrect(ctx, ex, ey, e, eh, e >= 4 ? 1 : 0, ABYSS);
        if (u > 1) px(ctx, ex + (face > 0 ? e - 2 : 1), ey + 1, 1, 1, DUST);
      }
      const len = a.feelerLen;
      const bn = Math.round(Math.sin(t * 7 + sd) * 0.5 * u);
      for (let s = -1; s <= 1; s += 2) {
        const bx = cx + s * W * 0.25;
        const mx = bx + s * 0.5 * u;
        const my = y0 - 1.6 * u * len + bn;
        const tx = mx + face * 1.2 * u * len + s * 0.3 * u;
        const ty = my - 0.6 * u * len;
        pline(ctx, bx, y0, mx, my, tone, t1);
        pline(ctx, mx, my, tx, ty, tone, t1);
        px(ctx, tx - t1 / 2 + 0.5, ty - t1 / 2, t1 + 1, t1 + 1, LIGHT);
      }
      const sw = Math.sin(t * 4 + sd) * 0.6 * u;
      pline(ctx, cx + face * u * 0.6, bottom - Math.round(H * 0.3), cx + face * u + sw, bottom + 1.6 * u * a.trunkLen, tone, Math.max(1, Math.round(f * 0.7)));
      return;
    }
    case 'fenthrai': {
      // Generated genome: round head, three eyes, a flame top, side fins.
      rrect(ctx, x0, y0, W, H, c, tone);
      const e = Math.max(1, Math.round(f * 0.8));
      const inset = Math.max(1, Math.round(W * 0.18));
      eye(ctx, x0 + inset, y0 + Math.round(H * 0.56), e, e);
      eye(ctx, x0 + W - inset - e, y0 + Math.round(H * 0.56), e, e);
      eye(ctx, x0 + Math.round((W - e) / 2), y0 + Math.round(H * 0.22), e, e);
      flame(ctx, x0, y0, W, H, u, 0.9 * a.flameH, t, sd, false);
      const fin = Math.round(1.6 * u * a.finLen);
      for (let k = 0; k < fin; k++) {
        const hgt = Math.max(1, Math.round((fin - k) * 0.9));
        px(ctx, x0 - k - 1, y0 + Math.round(H * 0.25), 1, hgt, LIGHT);
        px(ctx, x0 + W + k, y0 + Math.round(H * 0.25), 1, hgt, LIGHT);
      }
      return;
    }
    case 'ohmk': {
      // Generated robot: a small metal head, slit eyes, side bolts, a jaw line.
      // On the pitch the head is a few pixels: the faceplate becomes a band
      // and the jaw is left out, so the metal still reads as a head.
      rrect(ctx, x0, y0, W, H, c, tone);
      const tiny = H < 5;
      const fpW = tiny ? W : Math.max(3, W - 2 * Math.max(1, Math.round(u * 0.6)));
      const fpH = tiny ? 1 : Math.max(2, Math.round(H * 0.4));
      const fx = Math.round(cx - fpW / 2 + 0.5);
      const fy = y0 + Math.round(H * 0.32);
      px(ctx, fx, fy, fpW, fpH, DARK);
      slits(ctx, fx, fy, fpW, fpH);
      const bl = Math.max(1, Math.round(H * 0.28 * a.boltLen));
      px(ctx, x0 - u, y0 + Math.round(H * 0.4), u, bl, MID);
      px(ctx, x0 + W, y0 + Math.round(H * 0.4), u, bl, MID);
      const jw = Math.max(1, Math.round(W * a.jawW));
      if (!tiny) px(ctx, Math.round(cx - jw / 2 + 0.5), bottom - Math.max(1, Math.round(H * 0.18)), jw, 1, DARK);
      return;
    }
    case 'quoo': {
      // Generated genome: round head, big eyes, horns, gills, freckles.
      rrect(ctx, x0, y0, W, H, c, tone);
      freckles(ctx, cx, y0, W, H, u);
      const e = Math.max(1, Math.round(f * 0.8 * a.eyeScale)) + (u > 1 ? 1 : 0);
      const gp = Math.max(1, Math.round(W * 0.24));
      const ey = y0 + Math.round(H * 0.5) - Math.round(u * 0.3);
      eye(ctx, cx + hLook - gp - e / 2 + 0.5, ey, e, e);
      eye(ctx, cx + hLook + gp - e / 2 + 0.5, ey, e, e);
      horns(ctx, x0, y0, W, u, f, a.hornLen, 0.5);
      if (u > 1) {
        for (let k = 0; k < 3; k++) {
          px(ctx, x0 + 1, y0 + Math.round(H * 0.5) + k * 2, 2, 1, MID);
          px(ctx, x0 + W - 3, y0 + Math.round(H * 0.5) + k * 2, 2, 1, MID);
        }
      }
      return;
    }
    case 'terran':
    default: {
      // Hair and two eyes.
      rrect(ctx, x0, y0, W, H, c, tone);
      const hair = a.hairTone;
      const style = a.hairStyle;
      if (hair && style !== 'bald') {
        const capH = style === 'buzz' ? Math.max(1, Math.round(H * 0.22)) : Math.max(1, Math.round(H * 0.38));
        rrect(ctx, x0, y0, W, capH + c, c, hair);
        px(ctx, x0 + c, y0 + capH, W - 2 * c, c, tone);
        if (style !== 'buzz') px(ctx, face > 0 ? x0 : x0 + W - u, y0 + c, u, Math.round(H * (style === 'long' ? 0.85 : 0.6)), hair);
        if (style === 'tuft') px(ctx, Math.round(cx + face * W * 0.15 - u / 2), y0 - u, u, u, hair);
      }
      twoEyes(ctx, cx, y0, W, H, f, a.eyeY, a.eyeGap);
      return;
    }
  }
}

/** Two glowing slit eyes on a faceplate (Android, Ohm K); they dim on a blink. */
function slits(ctx: CanvasRenderingContext2D, fx: number, fy: number, fpW: number, fpH: number): void {
  const ew = Math.max(1, Math.round(fpW * 0.3));
  const ey = fy + Math.round(fpH / 2 - 0.5);
  const inset = Math.max(1, Math.round(fpW * 0.12));
  const col = hBlink ? MID : GLOW;
  px(ctx, fx + inset, ey, ew, 1, col);
  px(ctx, fx + fpW - inset - ew, ey, ew, 1, col);
}
