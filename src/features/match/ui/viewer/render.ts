// ── features/match/ui/viewer/render.ts ──────────────────────────────────────
// The canvas drawing layer for the pixel-art match viewer.  Pure-ish: every
// function takes a CanvasRenderingContext2D and a `project` closure (built by
// the component from the active camera), so it knows nothing about React, the
// rAF loop, or which camera is live.  All per-frame MATH lives in logic/viewer;
// this file only turns positions + poses into pixels.
//
// STYLE (from the Tiny Terraces research): square, chunky, big-headed dudes with
// a crisp dark outline, hair + hats for variety, a grounding shadow, and arms
// that pivot from the shoulders and wave out to the sides.

import { PITCH_LENGTH, PITCH_WIDTH } from '../../logic/spatial/types';
import {
  GOALS,
  GOAL_DEPTH,
  PITCH_MARKINGS,
  type Appearance,
  type GoalSpec,
  type Marking,
  type Pose,
  type Projected,
} from '../../logic/viewer';

/** Maps a world point (metres + height) to screen space under the active camera. */
export type ProjectFn = (wx: number, wy: number, wz: number) => Projected;

// ── Palette (ISL tokens) ──────────────────────────────────────────────────────

const SHADOW = 'rgba(0,0,0,0.38)';
const BALL_COLOR = '#F4F1E6';
const LINE = 'rgba(227,224,213,0.30)';
const GOAL_LINE = 'rgba(227,224,213,0.55)';
const GRASS_A = '#1c241c'; // darker mowing stripe
const GRASS_B = '#202a20'; // lighter mowing stripe

/** How many vertical mowing stripes to paint across the pitch length. */
const GRASS_STRIPES = 10;

/** Arm wave: base outward splay + how far the arms swing each cycle (radians). */
const ARM_OUT = 0.5;
const ARM_WAVE = 0.85;

// ── A drawable dude / ball ──────────────────────────────────────────────────────

/** Everything the renderer needs to draw one player this frame. */
export interface DudeRender {
  /** World position in metres. */
  wx: number;
  wy: number;
  /** Pose for this frame (from computePose). */
  pose: Pose;
  /** Deterministic appearance (skin/hair/hat/build). */
  appearance: Appearance;
  /** Kit fill colour (team colour, or a distinct GK colour). */
  kit: string;
  /** Facing: +1 right, −1 left. */
  face: number;
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
  // Mowing stripes — projected quads alternating two greens.
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

// ── Dude ─────────────────────────────────────────────────────────────────────

/** One arm: a sleeve pivoting from shoulder (sx, sy) at angle theta (π/2 = down) with a hand. */
function drawArm(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  theta: number,
  len: number,
  w: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(theta);
  ctx.fillStyle = color;
  ctx.fillRect(0, -w / 2, len, w);
  ctx.fillRect(len - w * 0.4, -w * 0.7, w * 1.4, w * 1.4); // hand
  ctx.restore();
}

/** Hair on top of the head, by style. */
function drawHair(
  ctx: CanvasRenderingContext2D,
  a: Appearance,
  headX: number,
  headY: number,
  head: number,
  u: number,
): void {
  if (!a.hair) return;
  ctx.fillStyle = a.hair;
  switch (a.style) {
    case 'short':
      rect(ctx, headX, headY, head, head * 0.26);
      break;
    case 'flat':
      rect(ctx, headX - 0.4 * u, headY, head + 0.8 * u, head * 0.32);
      break;
    case 'spiky':
      rect(ctx, headX, headY - head * 0.18, head, head * 0.38);
      rect(ctx, headX + head * 0.14, headY - head * 0.36, head * 0.18, head * 0.22);
      rect(ctx, headX + head * 0.62, headY - head * 0.36, head * 0.18, head * 0.22);
      break;
    case 'long':
      rect(ctx, headX, headY, head, head * 0.3); // top fringe (sides drawn as backing)
      break;
    case 'bald':
      break;
  }
}

/** Headwear over the hair, by style. */
function drawHat(
  ctx: CanvasRenderingContext2D,
  a: Appearance,
  headX: number,
  headY: number,
  head: number,
  u: number,
): void {
  if (a.hat === 'none' || !a.hatColor) return;
  const c = a.hatColor;
  switch (a.hat) {
    case 'cap':
      ctx.fillStyle = shade(c, -0.35);
      rect(ctx, headX - 0.3 * u, headY + head * 0.02, head + 1.4 * u, head * 0.13); // brim
      ctx.fillStyle = c;
      rect(ctx, headX, headY - head * 0.24, head, head * 0.3); // crown
      break;
    case 'beanie':
      ctx.fillStyle = c;
      rect(ctx, headX - 0.3 * u, headY - head * 0.16, head + 0.6 * u, head * 0.34);
      break;
    case 'tall':
      ctx.fillStyle = shade(c, -0.3);
      rect(ctx, headX - 0.3 * u, headY - head * 0.04, head + 0.6 * u, head * 0.12); // band
      ctx.fillStyle = c;
      rect(ctx, headX + head * 0.13, headY - head * 0.7, head * 0.74, head * 0.72); // tall crown
      break;
    case 'band':
      ctx.fillStyle = c;
      rect(ctx, headX, headY + head * 0.08, head, head * 0.15);
      break;
  }
}

/**
 * Draw one little dude at its world position, posed for this frame.  Drawn from
 * the feet up: shadow → legs → waving arms → torso → head → hair → hat → eyes →
 * antennae.  Distant players shrink via the projection's depth scale.
 */
export function drawDude(ctx: CanvasRenderingContext2D, project: ProjectFn, d: DudeRender): void {
  const pr = project(d.wx, d.wy, 0);
  const sc = pr.sc;
  const { hop, h, scaleX: sx0, scaleY: sy0, swing, cosPhase } = d.pose;
  const a = d.appearance;
  const kit = d.kit;
  const sleeve = shade(kit, -0.32);

  // Grounding shadow (no hop), shrinking as the body rises.
  ctx.fillStyle = SHADOW;
  ell(ctx, pr.x, pr.y, 4.4 * sc * (1 - 0.28 * h), 1.7 * sc * (1 - 0.28 * h));

  const u = sc;
  const feetY = pr.y - hop;
  // Chibi silhouette: BIG head, short chunky body, stubby legs.
  const buildW = a.build === 'stocky' ? 1.12 : 0.92;
  const legH = 2.5 * u * sy0;
  const legW = 1.9 * u * sx0;
  const gap = 1.0 * u * sx0;
  const bodyH = 4.2 * u * sy0;
  const bodyW = 5.0 * u * sx0 * buildW;
  const head = 5.0 * u * ((sx0 + sy0) / 2);
  const legTop = feetY - legH;
  const bodyTop = legTop - bodyH;
  const headX = pr.x - head / 2;
  const headY = bodyTop - head * 0.9;

  // Legs scissor on the swing.
  ctx.fillStyle = shade(kit, -0.5);
  rect(ctx, pr.x - gap - legW / 2 + swing, legTop, legW, legH);
  rect(ctx, pr.x + gap - legW / 2 - swing, legTop, legW, legH);

  // Arms pivot from the shoulders and WAVE in opposite phase (one rises while the
  // other drops): both rotate by −cosPhase·ARM_WAVE from mirrored rest angles, so
  // they alternate into a flowing wave rather than synced star-jumps.
  const armLen = bodyH * 1.0;
  const armW = Math.max(1, legW * 0.95);
  const shoulderY = bodyTop + bodyH * 0.2;
  drawArm(ctx, pr.x + bodyW * 0.4, shoulderY, Math.PI / 2 - ARM_OUT - cosPhase * ARM_WAVE, armLen, armW, sleeve);
  drawArm(ctx, pr.x - bodyW * 0.4, shoulderY, Math.PI / 2 + ARM_OUT - cosPhase * ARM_WAVE, armLen, armW, sleeve);

  // Torso (outlined).
  const ol = Math.max(1, 0.8 * u);
  obox(ctx, pr.x - bodyW / 2, bodyTop, bodyW, bodyH, kit, shade(kit, -0.55), ol);

  // Long-hair backing, framing the face behind the head.
  if (a.hair && a.style === 'long') {
    ctx.fillStyle = a.hair;
    rect(ctx, headX - 0.8 * u, headY + head * 0.12, head + 1.6 * u, head * 1.02);
  }

  // Head (outlined), then hair + hat on top.
  obox(ctx, headX, headY, head, head, a.skin, shade(a.skin, -0.5), ol);
  drawHair(ctx, a, headX, headY, head, u);
  drawHat(ctx, a, headX, headY, head, u);

  // Eyes — two pixels nudged toward the facing direction.
  ctx.fillStyle = '#161616';
  const eyeY = headY + head * 0.46;
  const ew = Math.max(1, 0.9 * u);
  const off = head * 0.2;
  const fx = d.face * head * 0.07;
  rect(ctx, pr.x - off + fx, eyeY, ew, ew * 1.05);
  rect(ctx, pr.x + off - ew + fx, eyeY, ew, ew * 1.05);

  // Antennae — some alien races.
  if (a.antennae) {
    const aw = Math.max(1, 0.7 * u);
    const ah = head * 0.5;
    ctx.fillStyle = a.hair ?? shade(a.skin, 0.25);
    rect(ctx, headX + head * 0.22, headY - ah, aw, ah);
    rect(ctx, headX + head * 0.72, headY - ah, aw, ah);
    ctx.fillStyle = BALL_COLOR;
    rect(ctx, headX + head * 0.22 - aw * 0.3, headY - ah - aw, aw * 1.6, aw * 1.6);
    rect(ctx, headX + head * 0.72 - aw * 0.3, headY - ah - aw, aw * 1.6, aw * 1.6);
  }
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
