// ── features/match/ui/viewer/render.ts ──────────────────────────────────────
// The canvas drawing layer for the pixel-art match viewer.  Pure-ish: every
// function takes a CanvasRenderingContext2D and a `project` closure (built by
// the component from the active camera), so it knows nothing about React, the
// rAF loop, or which camera is live.  All per-frame MATH lives in logic/viewer;
// this file only turns positions + poses into pixels.
//
// STYLE — "PHOSPHOR TERRACES" (the ISL design-system Match Sprites handoff,
// locked config: terraces silhouette · eyes · squad numbers · phosphor accent ·
// calm motion · nub limbs):
//   Every being is a Lunar-Dust phosphor figure on Galactic Abyss.  The chunky
//   big-headed Tiny-Terraces silhouette carries the charm; variety comes from
//   SPECIES (head shape, eye configuration, antennae, mandibles), build and
//   phosphor-tone hair — never from hue.  Home wears full phosphor, away wears
//   the dimmed phosphor; the goalkeeper is the hollow (abyss-filled) figure.
//   Squad numbers in Space Mono are the brand's data motif on every chest, and
//   the selected player glows under a Quantum-Purple halo (the Architect's eye).

import { PITCH_LENGTH, PITCH_WIDTH } from '../../logic/spatial/types';
import {
  GOALS,
  GOAL_DEPTH,
  HAIR_TONE,
  PITCH_MARKINGS,
  SPECIES,
  type Appearance,
  type EyeKind,
  type GoalSpec,
  type Marking,
  type Pose,
  type Projected,
} from '../../logic/viewer';

/** Maps a world point (metres + height) to screen space under the active camera. */
export type ProjectFn = (wx: number, wy: number, wz: number) => Projected;

// ── Palette (ISL tokens — the phosphor monochrome) ────────────────────────────

/** Lunar Dust — the phosphor body (and the home side's shirt). */
const PHOS = '#E3E0D5';
/** Galactic Abyss — outline, eyes, and the GK's hollow shirt fill. */
const ABYSS = '#111111';
/** Mid phosphor — legs/shorts, the away side's shirt, antennae stems. */
const PHOS_DIM = '#9C9A90';
/** Quantum Purple — the focus halo (the Architect's eye on the selected soul). */
const QUANTUM = '#9A5CF4';

const SHADOW = 'rgba(0,0,0,0.38)';
const BALL_COLOR = '#E3E0D5';
/** Pitch surface — abyss-toned greens so the phosphor beings carry the light. */
const GRASS_A = '#131613'; // darker mowing stripe
const GRASS_B = '#171b17'; // lighter mowing stripe
const LINE = 'rgba(227,224,213,0.26)';
const GOAL_LINE = 'rgba(227,224,213,0.5)';

/** How many vertical mowing stripes to paint across the pitch length. */
const GRASS_STRIPES = 10;

/** How far a dimmed (non-selected) dude fades when another player is in focus. */
const DIM_ALPHA = 0.32;

// ── A drawable dude / ball ──────────────────────────────────────────────────────

/** Everything the renderer needs to draw one player this frame. */
export interface DudeRender {
  /** World position in metres. */
  wx: number;
  wy: number;
  /** Pose for this frame (from computePose). */
  pose: Pose;
  /** Deterministic appearance (species/build/hair). */
  appearance: Appearance;
  /** Which side the player is on — home wears phosphor, away wears dim phosphor. */
  team: 'home' | 'away';
  /** Goalkeepers render as the hollow (abyss-filled, phosphor-outlined) figure. */
  gk: boolean;
  /** Squad number printed on the chest (the brand's data motif). */
  number: number;
  /** Facing: +1 right, −1 left. */
  face: number;
  /** Draw the Quantum focus halo under this dude (the clicked player). */
  highlighted?: boolean;
  /** Fade this dude back (a different player is selected) so the focus stands out. */
  dimmed?: boolean;
}

/** Everything the renderer needs to draw the ball this frame. */
export interface BallRender {
  wx: number;
  wy: number;
  wz: number;
}

// ── Low-level pixel helpers ─────────────────────────────────────────────────────

/** Filled, pixel-snapped rectangle (min 1px so thin parts never vanish). */
function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}

/** Outlined filled box — a 1px dark border behind the fill, for the crisp sprite edge. */
function obox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  outline: string,
  o: number,
): void {
  ctx.fillStyle = outline;
  ctx.fillRect(
    Math.round(x - o),
    Math.round(y - o),
    Math.max(1, Math.round(w + 2 * o)),
    Math.max(1, Math.round(h + 2 * o)),
  );
  ctx.fillStyle = fill;
  ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}

/** Filled ellipse. */
function ell(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.5, rx), Math.max(0.4, ry), 0, 0, Math.PI * 2);
  ctx.fill();
}

/** Filled circle. */
function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Rounded-rect fill (rounded corners, not a hard circle) — the eye shape from
 * the handoff.  Falls back to arcTo when the canvas lacks roundRect (jsdom).
 */
function rrect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const xr = Math.round(x);
  const yr = Math.round(y);
  const wr = Math.max(1, Math.round(w));
  const hr = Math.max(1, Math.round(h));
  const rr = Math.max(0, Math.min(r, wr / 2, hr / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(xr, yr, wr, hr, rr);
  } else {
    ctx.moveTo(xr + rr, yr);
    ctx.arcTo(xr + wr, yr, xr + wr, yr + hr, rr);
    ctx.arcTo(xr + wr, yr + hr, xr, yr + hr, rr);
    ctx.arcTo(xr, yr + hr, xr, yr, rr);
    ctx.arcTo(xr, yr, xr + wr, yr, rr);
  }
  ctx.closePath();
  ctx.fill();
}

/** Parse `#rgb` / `#rrggbb` into channels; null on anything unparseable. */
function parseHex(hex: string): { r: number; g: number; b: number } | null {
  if (typeof hex !== 'string') return null;
  let h = hex.trim();
  if (h.startsWith('#')) h = h.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6) return null;
  const n = Number.parseInt(h, 16);
  if (Number.isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * Lighten (amt>0) or darken (amt<0) a hex colour toward white/black.  Returns an
 * `rgb()` string, or the input unchanged if it can't be parsed (e.g. a token).
 */
function shade(hex: string, amt: number): string {
  const c = parseHex(hex);
  if (!c) return hex;
  const f = (v: number): number => Math.max(0, Math.min(255, Math.round(v + 255 * amt)));
  return `rgb(${f(c.r)},${f(c.g)},${f(c.b)})`;
}

/**
 * Cel shading: a flat shadow band on the right + bottom of a box and a small
 * highlight on the top-left — the two-step lighting that makes the phosphor
 * figures read as solid pictograms instead of flat fills.
 */
function celShade(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  base: string,
): void {
  ctx.fillStyle = shade(base, -0.16);
  ctx.fillRect(Math.round(x + w * 0.6), Math.round(y), Math.ceil(w * 0.4), Math.round(h));
  ctx.fillRect(Math.round(x), Math.round(y + h * 0.72), Math.round(w), Math.ceil(h * 0.28));
  ctx.fillStyle = shade(base, 0.18);
  ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.floor(w * 0.3)), Math.max(1, Math.floor(h * 0.24)));
}

// ── Pitch ────────────────────────────────────────────────────────────────────

/** Stroke a world-space quad's outline (its 4 corners, projected). */
function quadStroke(
  ctx: CanvasRenderingContext2D,
  project: ProjectFn,
  pts: ReadonlyArray<readonly [number, number]>,
): void {
  ctx.beginPath();
  pts.forEach(([wx, wy], i) => {
    const p = project(wx, wy, 0);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
  ctx.stroke();
}

/** Draw one pitch marking by running its geometry through the projection. */
function drawMarking(ctx: CanvasRenderingContext2D, project: ProjectFn, m: Marking): void {
  switch (m.kind) {
    case 'rect':
      quadStroke(ctx, project, [
        [m.x0, m.y0],
        [m.x1, m.y0],
        [m.x1, m.y1],
        [m.x0, m.y1],
      ]);
      break;
    case 'line': {
      const a = project(m.x0, m.y0, 0);
      const b = project(m.x1, m.y1, 0);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      break;
    }
    case 'arc': {
      // ~40 samples turns the world circle into a correct perspective ellipse.
      const N = 40;
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const ang = m.a0 + ((m.a1 - m.a0) * i) / N;
        const p = project(m.cx + m.r * Math.cos(ang), m.cy + m.r * Math.sin(ang), 0);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      break;
    }
    case 'spot': {
      const p = project(m.x, m.y, 0);
      ctx.fillStyle = LINE;
      circle(ctx, p.x, p.y, 1.1);
      break;
    }
  }
}

/** Draw a goal frame: two posts, crossbar, and a short net depth receding off the line. */
function drawGoal(ctx: CanvasRenderingContext2D, project: ProjectFn, goal: GoalSpec): void {
  const depth = GOAL_DEPTH * goal.depthDir;
  ctx.strokeStyle = GOAL_LINE;
  ctx.lineWidth = 1;
  const post = (y: number): void => {
    const foot = project(goal.x, y, 0);
    const top = project(goal.x, y, goal.height);
    ctx.beginPath();
    ctx.moveTo(foot.x, foot.y);
    ctx.lineTo(top.x, top.y);
    ctx.stroke();
    const back = project(goal.x + depth, y, goal.height);
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(back.x, back.y);
    ctx.stroke();
  };
  post(goal.y0);
  post(goal.y1);
  const c0 = project(goal.x, goal.y0, goal.height);
  const c1 = project(goal.x, goal.y1, goal.height);
  ctx.beginPath();
  ctx.moveTo(c0.x, c0.y);
  ctx.lineTo(c1.x, c1.y);
  ctx.stroke();
}

/**
 * Draw the full static pitch: mowing stripes, all regulation markings, and both
 * goals.  Cheap enough to run every frame, or call once into an offscreen canvas
 * to bake the broadcast view (the component does the latter).
 */
export function drawPitch(ctx: CanvasRenderingContext2D, project: ProjectFn): void {
  // Mowing stripes — projected quads alternating two abyss-toned greens.
  for (let i = 0; i < GRASS_STRIPES; i++) {
    const x0 = (i * PITCH_LENGTH) / GRASS_STRIPES;
    const x1 = ((i + 1) * PITCH_LENGTH) / GRASS_STRIPES;
    const a = project(x0, 0, 0);
    const b = project(x1, 0, 0);
    const c = project(x1, PITCH_WIDTH, 0);
    const d = project(x0, PITCH_WIDTH, 0);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.closePath();
    ctx.fillStyle = i % 2 ? GRASS_B : GRASS_A;
    ctx.fill();
  }

  ctx.lineWidth = 1;
  ctx.strokeStyle = LINE;
  for (const m of PITCH_MARKINGS) drawMarking(ctx, project, m);
  for (const goal of GOALS) drawGoal(ctx, project, goal);
}

// ── Dude — morphology helpers (all monochrome phosphor) ─────────────────────

/** A short tilted stem (feeler antennae) drawn from its base upward. */
function drawTilt(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rot: number,
  len: number,
  w: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillRect(Math.round(-w / 2), Math.round(-len), Math.max(1, Math.round(w)), Math.max(1, Math.round(len)));
  ctx.restore();
}

/** Antennae above the head, by species kind: splayed feelers or orb-tipped stalks. */
function drawAntennae(
  ctx: CanvasRenderingContext2D,
  kind: string,
  hx: number,
  hy: number,
  w: number,
  u: number,
): void {
  if (kind === 'none') return;
  const aw = Math.max(1, 0.7 * u);
  const len = w * 0.5;
  const x1 = hx + w * 0.26;
  const x2 = hx + w * 0.74;
  ctx.fillStyle = PHOS_DIM;
  if (kind === 'feeler') {
    drawTilt(ctx, x1, hy, -0.5, len, aw);
    drawTilt(ctx, x2, hy, 0.5, len, aw);
  } else if (kind === 'orb') {
    rect(ctx, x1 - aw / 2, hy - len, aw, len);
    rect(ctx, x2 - aw / 2, hy - len, aw, len);
    ctx.fillStyle = PHOS;
    circle(ctx, x1, hy - len, Math.max(1.2, aw * 1.1));
    circle(ctx, x2, hy - len, Math.max(1.2, aw * 1.1));
  }
}

/** Hair silhouette on top of the head (terrans only), in its phosphor tone. */
function drawHairShape(
  ctx: CanvasRenderingContext2D,
  style: Appearance['style'],
  hx: number,
  hy: number,
  head: number,
  u: number,
  color: string,
): void {
  ctx.fillStyle = color;
  switch (style) {
    case 'short':
      rect(ctx, hx, hy, head, head * 0.24);
      break;
    case 'flat':
      rect(ctx, hx - 0.4 * u, hy, head + 0.8 * u, head * 0.3);
      break;
    case 'spiky':
      rect(ctx, hx, hy - head * 0.16, head, head * 0.34);
      rect(ctx, hx + head * 0.16, hy - head * 0.34, head * 0.16, head * 0.2);
      rect(ctx, hx + head * 0.62, hy - head * 0.34, head * 0.16, head * 0.2);
      break;
    case 'long':
      rect(ctx, hx, hy, head, head * 0.28);
      break;
    case 'bald':
      break;
  }
}

/**
 * Eyes in Galactic Abyss, by species configuration.  All shapes are rounded
 * rects nudged toward the facing direction so the crowd reads as looking where
 * it's going.
 */
function drawEyes(
  ctx: CanvasRenderingContext2D,
  kind: EyeKind,
  cxp: number,
  hx: number,
  hy: number,
  w: number,
  h: number,
  u: number,
  face: number,
): void {
  ctx.fillStyle = ABYSS;
  const ew = Math.max(1.6, 1.15 * u);
  const ey = hy + h * 0.52;
  const fx = face * w * 0.05;
  const eye = (x: number, y: number, sw: number, sh: number): void =>
    rrect(ctx, x - sw / 2, y - sh / 2, sw, sh, Math.min(sw, sh) * 0.42);
  switch (kind) {
    case 'one': {
      // The cyclops: one big central eye.
      const s = Math.max(3, w * 0.36);
      eye(cxp + fx, ey, s, s);
      return;
    }
    case 'three': {
      // The trinocular: a row of three.
      const o = w * 0.28;
      for (const k of [-o, 0, o]) eye(cxp + k + fx, ey, ew, ew * 1.15);
      return;
    }
    case 'cluster': {
      // The insectoid: a 2×2 compound cluster.
      const o = w * 0.17;
      for (const ix of [-o, o]) for (const iy of [-h * 0.09, h * 0.09]) eye(cxp + ix + fx, ey + iy, ew, ew);
      return;
    }
    case 'big': {
      // The grey: two large almonds.
      const ww = w * 0.26;
      const hh = h * 0.3;
      eye(cxp - w * 0.2 + fx, ey, ww, hh);
      eye(cxp + w * 0.2 + fx, ey, ww, hh);
      return;
    }
    case 'high': {
      // The aurelid: two small eyes set high on the dome.
      const o = w * 0.2;
      eye(cxp - o + fx, hy + h * 0.4, ew, ew);
      eye(cxp + o + fx, hy + h * 0.4, ew, ew);
      return;
    }
    case 'two': {
      const o = w * 0.2;
      eye(cxp - o + fx, ey, ew, ew * 1.15);
      eye(cxp + o + fx, ey, ew, ew * 1.15);
      return;
    }
  }
}

/**
 * The species-shaped head: long-hair backing → antennae → phosphor head box
 * (species-proportioned) with cel shading → mandibles → hair → eyes.
 */
function drawHead(
  ctx: CanvasRenderingContext2D,
  cxp: number,
  headY: number,
  head: number,
  u: number,
  face: number,
  a: Appearance,
): void {
  const sp = SPECIES[a.species];
  const sized = head * sp.headMul;

  // Species head proportions — the silhouette IS the species.
  let w = sized;
  let hgt = sized;
  if (sp.head === 'tall') {
    w = sized * 0.8;
    hgt = sized * 1.26;
  } else if (sp.head === 'wide') {
    w = sized * 1.24;
    hgt = sized * 0.82;
  } else if (sp.head === 'round') {
    w = sized * 1.12;
    hgt = sized * 1.0;
  }

  // Anchor the species box to the same chin line the plain box would sit on, so
  // a tall or wide head grows upward/outward rather than sinking into the torso.
  const headBottomY = headY + head;
  const hx = cxp - w / 2;
  const hy = headBottomY - hgt;
  const ol = Math.max(1, 0.8 * u);

  // Long-hair backing framing the face behind the head.
  if (a.hair && a.style === 'long') {
    ctx.fillStyle = HAIR_TONE.long;
    rect(ctx, hx - 0.7 * u, hy + hgt * 0.18, w + 1.4 * u, hgt * 0.86);
  }

  drawAntennae(ctx, sp.antennae, hx, hy, w, u);
  obox(ctx, hx, hy, w, hgt, PHOS, ABYSS, ol);
  celShade(ctx, hx, hy, w, hgt, PHOS);

  // Insectoid mandibles — two little teeth under the chin.
  if (sp.mandible) {
    ctx.fillStyle = shade(PHOS, -0.45);
    const my = hy + hgt * 0.95;
    rect(ctx, cxp - w * 0.2, my, w * 0.1, hgt * 0.12);
    rect(ctx, cxp + w * 0.1, my, w * 0.1, hgt * 0.12);
  }

  if (a.hair && a.style !== 'bald') drawHairShape(ctx, a.style, hx, hy, w, u, a.hair);
  drawEyes(ctx, sp.eyes, cxp, hx, hy, w, hgt, u, face);
}

/**
 * One continuous bent limb (no segment seams): shoulder → elbow → hand, stroked
 * as a single rounded polyline in the sleeve colour over an abyss outline, with
 * a blocky hand capping the end.
 */
function drawArmJointed(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  upperAngle: number,
  foreRel: number,
  upperLen: number,
  foreLen: number,
  w: number,
  color: string,
  o: number,
): void {
  const ex = sx + Math.cos(upperAngle) * upperLen;
  const ey = sy + Math.sin(upperAngle) * upperLen;
  const ta = upperAngle + foreRel;
  const hx = ex + Math.cos(ta) * foreLen;
  const hy = ey + Math.sin(ta) * foreLen;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = ABYSS;
  ctx.lineWidth = w + 2 * o;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.lineTo(hx, hy);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.lineTo(hx, hy);
  ctx.stroke();
  const hs = Math.max(1.5, w * 1.05);
  ctx.fillStyle = ABYSS;
  ctx.fillRect(Math.round(hx - hs / 2 - o), Math.round(hy - hs / 2 - o), Math.round(hs + 2 * o), Math.round(hs + 2 * o));
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(hx - hs / 2), Math.round(hy - hs / 2), Math.round(hs), Math.round(hs));
}

/**
 * Draw one phosphor being at its world position, posed for this frame.  Drawn
 * from the feet up: halo → shadow → legs → nub arms → shirt → number → head.
 * Distant players shrink via the projection's depth scale.
 */
export function drawDude(ctx: CanvasRenderingContext2D, project: ProjectFn, d: DudeRender): void {
  const pr = project(d.wx, d.wy, 0);
  const sc = pr.sc;

  // Quantum focus halo (drawn first, under the dude) marks the clicked player —
  // the one place the accent colour appears on the pitch, with a soft glow.
  if (d.highlighted) {
    ctx.save();
    ctx.shadowColor = QUANTUM;
    ctx.shadowBlur = 8 * sc;
    ctx.strokeStyle = QUANTUM;
    ctx.lineWidth = Math.max(1, 1.2 * sc);
    ctx.beginPath();
    ctx.ellipse(pr.x, pr.y, 6.2 * sc, 2.5 * sc, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  // Fade non-selected dudes so the selected one stands out (set once, restored
  // at the end of the function).
  const dimmed = d.dimmed === true;
  if (dimmed) {
    ctx.save();
    ctx.globalAlpha = DIM_ALPHA;
  }

  const { hop, h, scaleX: sx0, scaleY: sy0 } = d.pose;
  const a = d.appearance;
  const u = sc;
  const feetY = pr.y - hop;

  // Shirt tone: home = full phosphor, away = dim phosphor (the `accent:
  // phosphor` decision — team kits stay monochrome; the HUD carries club
  // colour).  The GK is the hollow figure instead.
  const shirt = d.team === 'away' ? PHOS_DIM : PHOS;

  // Grounding shadow (no hop), shrinking as the body rises.
  ctx.fillStyle = SHADOW;
  ell(ctx, pr.x, pr.y, 4.0 * sc * (1 - 0.28 * h), 1.6 * sc * (1 - 0.28 * h));

  // Terraces silhouette: BIG head, short chunky body, stubby legs.
  const buildW = a.build === 'stocky' ? 1.14 : 0.95;
  const legH = 2.4 * u * sy0;
  const legW = 2.0 * u * sx0;
  const gap = 1.0 * u * sx0;
  const bodyH = 4.4 * u * sy0;
  const bodyW = 5.2 * u * sx0 * buildW;
  const head = 4.9 * u * ((sx0 + sy0) / 2);
  const legTop = feetY - legH;
  const bodyTop = legTop - bodyH;
  const headY = bodyTop - head * 0.86;

  // Legs / shorts — dust-shadow value, cel-shaded; they scissor on the swing.
  const shortsCol = d.gk ? shade(PHOS, -0.42) : PHOS_DIM;
  const { swing } = d.pose;
  const lx1 = pr.x - gap - legW / 2 + swing;
  const lx2 = pr.x + gap - legW / 2 - swing;
  ctx.fillStyle = shortsCol;
  rect(ctx, lx1, legTop, legW, legH);
  celShade(ctx, lx1, legTop, legW, legH, shortsCol);
  ctx.fillStyle = shortsCol;
  rect(ctx, lx2, legTop, legW, legH);
  celShade(ctx, lx2, legTop, legW, legH, shortsCol);

  // Nub arms (the locked `limbs: nub` config): fixed stubby bent limbs splayed
  // slightly down-and-out — no swing, the calm on-2s idle read.
  const upperLen = bodyH * 0.5;
  const foreLen = bodyH * 0.46;
  const armW = Math.max(1, legW * 0.9);
  const shoulderY = bodyTop + bodyH * 0.18;
  const sleeve = d.gk ? shade(PHOS, -0.2) : PHOS;
  const ol = Math.max(1, 0.8 * u);
  drawArmJointed(ctx, pr.x + bodyW * 0.42, shoulderY, Math.PI / 2 + 0.3, 0, upperLen * 0.6, foreLen * 0.5, armW, sleeve, ol);
  drawArmJointed(ctx, pr.x - bodyW * 0.42, shoulderY, Math.PI / 2 - 0.3, 0, upperLen * 0.6, foreLen * 0.5, armW, sleeve, ol);

  // Torso — the shirt.  GK = hollow phosphor (abyss fill, phosphor outline);
  // outfielders wear their side's phosphor tone, cel-shaded.
  if (d.gk) {
    obox(ctx, pr.x - bodyW / 2, bodyTop, bodyW, bodyH, ABYSS, PHOS, ol);
  } else {
    obox(ctx, pr.x - bodyW / 2, bodyTop, bodyW, bodyH, shirt, shade(shirt, -0.5), ol);
    celShade(ctx, pr.x - bodyW / 2, bodyTop, bodyW, bodyH, shirt);
  }

  // Squad number on the chest, in the brand's mono.  Contrast follows the
  // shirt: abyss digits on the phosphor shirts, phosphor digits on the GK's
  // hollow abyss shirt.  Skipped when the sprite is too small to read.
  if (sc > 1.0) {
    const fs = Math.max(4, Math.round(bodyH * 0.4));
    ctx.font = `700 ${fs}px "Space Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = d.gk ? PHOS : ABYSS;
    ctx.fillText(String(d.number), pr.x, bodyTop + bodyH * 0.52);
  }

  drawHead(ctx, pr.x, headY, head, u, d.face, a);

  // Restore the alpha we lowered for a dimmed (non-selected) dude.
  if (dimmed) ctx.restore();
}

// ── Ball ─────────────────────────────────────────────────────────────────────

/** Draw the ball with a grounding shadow that detaches as the ball gains height. */
export function drawBall(ctx: CanvasRenderingContext2D, project: ProjectFn, b: BallRender): void {
  const pr = project(b.wx, b.wy, b.wz);
  const sc = pr.sc;
  const gr = project(b.wx, b.wy, 0);
  ctx.fillStyle = SHADOW;
  ell(ctx, gr.x, gr.y, 2.4 * sc * (1 - Math.min(0.6, b.wz * 0.05)), 1.0 * sc);
  ctx.fillStyle = BALL_COLOR;
  circle(ctx, pr.x, pr.y, Math.max(1.2, 1.5 * sc));
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  circle(ctx, pr.x + 0.4 * sc, pr.y + 0.4 * sc, Math.max(0.5, 0.6 * sc));
}
