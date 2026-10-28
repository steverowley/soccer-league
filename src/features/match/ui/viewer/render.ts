// ── features/match/ui/viewer/render.ts ──────────────────────────────────────
// The canvas drawing layer for the pixel-art match viewer.  Pure-ish: every
// function takes a CanvasRenderingContext2D and a `project` closure (built by
// the component from the active camera), so it knows nothing about React, the
// rAF loop, or which camera is live.  All per-frame MATH lives in logic/viewer;
// this file only turns positions + poses into pixels.
//
// STYLE — "PHOSPHOR TERRACES" (the ISL design-system Match Sprites study,
// config: terraces silhouette · eyes · squad numbers · kit accent · calm
// motion · nub limbs):
//   Every being is a Lunar-Dust phosphor figure on Galactic Abyss.  The chunky
//   big-headed Tiny-Terraces silhouette carries the charm; variety comes from
//   SPECIES (head shape, eye configuration, antennae, mandibles), build and
//   phosphor-tone hair, never from hue.  Squad numbers in Space Mono are the
//   brand's data motif on every chest, and the selected player glows under a
//   Quantum-Purple halo (the Architect's eye).
//
// READABILITY (docs/match-viewer.md, sections 2C and 3)
//   - KITS: shirt AND shorts wear the kit colour, and a small ground marker
//     in the team colour sits under every player.  The colours come from
//     logic/viewer/kits.ts (one legibility rule, one clash rule, a keeper kit
//     per side), never straight from `teams.color`.
//   - KEEPERS wear a bright keeper kit with long sleeves over their team's
//     marker.  Nothing is drawn as a dark or hollow figure: the old hollow
//     keeper read as a referee in black, and there is no referee.
//   - THE BALL has its own hi-vis colour, a dark outline, a ground shadow that
//     separates from it as it rises, and a short fading trail when it travels
//     fast.  The player on the ball stands in a ring in his team colour.
//   - TWO X: the canvas backing store is twice the old 320 x 208; every size
//     and line here is multiplied by PIXEL_SCALE, so the proportions and the
//     chunky pixels are those of the 1x art, only crisper.

import { PITCH_LENGTH, PITCH_WIDTH } from '../../logic/spatial/types';
import { canvasColor } from '../../../../shared/design';
import {
  GOALS,
  GOAL_DEPTH,
  HAIR_TONE,
  PITCH_MARKINGS,
  SPECIES,
  type Appearance,
  type EyeKind,
  type GoalSpec,
  type Kit,
  type Marking,
  type Pose,
  type Projected,
  type ActionBody,
  type ArmPreset,
  type TrailKind,
} from '../../logic/viewer';

/** Maps a world point (metres + height) to screen space under the active camera. */
export type ProjectFn = (wx: number, wy: number, wz: number) => Projected;

/**
 * Backing-store pixels per pixel of the original 320 x 208 art.  The component
 * multiplies the projection's depth scale `sc` by this, so every sprite size
 * expressed in `sc` units scales with it; the few absolute sizes below (line
 * widths, minimum sizes) multiply by it directly.
 */
export const PIXEL_SCALE = 2;
/** Short alias for the absolute sizes in this file. */
const PX = PIXEL_SCALE;

// ── Palette (ISL tokens — the phosphor monochrome) ────────────────────────────
// A canvas cannot read CSS variables, so the colours come from `canvasColor`
// in src/shared/design/tokens.ts: literal values that tokens.test.ts holds
// equal to their custom properties in tokens.css.

/** Lunar Dust: the phosphor body (heads and outfield arms). */
const PHOS = canvasColor.text;
/** Galactic Abyss: eyes, head outlines and the ball's outline. */
const ABYSS = canvasColor.bg;
/** Mid phosphor: antennae stems. */
const PHOS_DIM = canvasColor.figureDim;
/** Quantum Purple — the focus halo (the Architect's eye on the selected soul). */
const QUANTUM = canvasColor.architect;

const SHADOW = canvasColor.shadow;
/** The ball: hi-vis lime, measured against every kit in kits.test.ts. */
const BALL_COLOR = canvasColor.ball;
/** The ball's shaded side. */
const BALL_SHADE = canvasColor.ballShade;
/** Pitch surface — abyss-toned greens so the phosphor beings carry the light. */
const GRASS_A = canvasColor.grassA; // darker mowing stripe
const GRASS_B = canvasColor.grassB; // lighter mowing stripe
const LINE = canvasColor.line;
const GOAL_LINE = canvasColor.goalLine;

/** How many vertical mowing stripes to paint across the pitch length. */
const GRASS_STRIPES = 10;

/** How far a dimmed (non-selected) dude fades when another player is in focus. */
const DIM_ALPHA = 0.32;

/** Ground marker half-axes under every player, in `sc` units. */
const MARKER_RX = 3.6;
const MARKER_RY = 1.45;
/** Opacity of the ground marker (a disc of team colour under the feet). */
const MARKER_ALPHA = 0.85;
/** Carrier ring half-axes, in `sc` units: between the marker and the focus halo. */
const RING_RX = 5.3;
const RING_RY = 2.15;

/**
 * Ball radius in `sc` units.  At the far touchline under the Pitch camera
 * (sc 0.9 x PIXEL_SCALE) the filled ball is 2.1 x 0.9 x 2 x 2 = 7.6 backing
 * pixels across plus the outline; on a 356 px wide phone viewer (640 backing
 * pixels) that is 4.2 CSS px before the outline, 5.2 with it.
 */
export const BALL_RADIUS = 2.1;

/**
 * How the ball's trail is drawn for each kind of kick (docs/match-viewer.md
 * section 5B): a pass and a through ball keep the ball's lime, a cross,
 * long ball and clearance have their own colours, a shot is white, wider,
 * brighter and glows.
 */
export const TRAIL_STYLE: Readonly<Record<TrailKind, { color: string; width: number; alpha: number; glow: boolean }>> = {
  pass: { color: BALL_COLOR, width: 1, alpha: 1, glow: false },
  through: { color: BALL_COLOR, width: 1, alpha: 1.15, glow: false },
  cross: { color: canvasColor.trailCross, width: 1.1, alpha: 1.15, glow: false },
  long: { color: canvasColor.trailLong, width: 1.1, alpha: 1.1, glow: false },
  clear: { color: canvasColor.trailClear, width: 1.2, alpha: 0.9, glow: false },
  shot: { color: canvasColor.trailShot, width: 1.6, alpha: 1.5, glow: true },
};

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
  /** What this figure wears (from resolveKits: outfield or keeper kit of his side). */
  kit: Kit;
  /** Squad number printed on the chest (the brand's data motif). */
  number: number;
  /** Facing: +1 right, −1 left. */
  face: number;
  /** Draw the Quantum focus halo under this dude (the clicked player). */
  highlighted?: boolean;
  /** He has the ball: draw a ring in his team colour under him. */
  carrier?: boolean;
  /** Fade this dude back (a different player is selected) so the focus stands out. */
  dimmed?: boolean;
  /** An event animation (kick, slide, fall, dive...) from actionBody; absent = his gait only. */
  act?: ActionBody | null;
}

/** Everything the renderer needs to draw the ball this frame. */
export interface BallRender {
  wx: number;
  wy: number;
  /** Height above the grass in metres (0 when the replay has no height). */
  wz: number;
  /** Recent positions, oldest first, when the ball is travelling fast (else empty). */
  trail?: ReadonlyArray<{ x: number; y: number; z: number }>;
  /** The kind of the kick in flight, which styles the trail (absent = the ball's own lime). */
  trailKind?: TrailKind | null;
  /** A held ball: drawn this many sprite (`sc`) units above the holder's feet at (wx, wy). */
  heldLift?: number | null;
}

/** Sprite units per metre of height on a figure (an 11.5-unit figure is about 1.8 m). */
export const SPRITE_UNITS_PER_M = 6.4;

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
      circle(ctx, p.x, p.y, 1.1 * PX);
      break;
    }
  }
}

/** Draw a goal frame: two posts, crossbar, and a short net depth receding off the line. */
function drawGoal(ctx: CanvasRenderingContext2D, project: ProjectFn, goal: GoalSpec): void {
  const depth = GOAL_DEPTH * goal.depthDir;
  ctx.strokeStyle = GOAL_LINE;
  ctx.lineWidth = PX;
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

  ctx.lineWidth = PX;
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
  const aw = Math.max(PX, 0.7 * u);
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
    circle(ctx, x1, hy - len, Math.max(1.2 * PX, aw * 1.1));
    circle(ctx, x2, hy - len, Math.max(1.2 * PX, aw * 1.1));
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
  const ew = Math.max(1.6 * PX, 1.15 * u);
  const ey = hy + h * 0.52;
  const fx = face * w * 0.05;
  const eye = (x: number, y: number, sw: number, sh: number): void =>
    rrect(ctx, x - sw / 2, y - sh / 2, sw, sh, Math.min(sw, sh) * 0.42);
  switch (kind) {
    case 'one': {
      // The cyclops: one big central eye.
      const s = Math.max(3 * PX, w * 0.36);
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
  const ol = Math.max(PX, 0.8 * u);

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
  outline: string,
): void {
  const ex = sx + Math.cos(upperAngle) * upperLen;
  const ey = sy + Math.sin(upperAngle) * upperLen;
  const ta = upperAngle + foreRel;
  const hx = ex + Math.cos(ta) * foreLen;
  const hy = ey + Math.sin(ta) * foreLen;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = outline;
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
  const hs = Math.max(1.5 * PX, w * 1.05);
  ctx.fillStyle = outline;
  ctx.fillRect(Math.round(hx - hs / 2 - o), Math.round(hy - hs / 2 - o), Math.round(hs + 2 * o), Math.round(hs + 2 * o));
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(hx - hs / 2), Math.round(hy - hs / 2), Math.round(hs), Math.round(hs));
}

/**
 * Draw one phosphor being at its world position, posed for this frame.  Drawn
 * from the feet up: halo -> carrier ring -> ground marker -> shadow -> legs ->
 * nub arms -> shirt -> number -> head.  Distant players shrink via the
 * projection's depth scale.
 */
export function drawDude(ctx: CanvasRenderingContext2D, project: ProjectFn, d: DudeRender): void {
  const pr = project(d.wx, d.wy, 0);
  const sc = pr.sc;
  const kit = d.kit;

  // Quantum focus halo (drawn first, under the dude) marks the clicked player —
  // the one place the accent colour appears on the pitch, with a soft glow.
  if (d.highlighted) {
    ctx.save();
    ctx.shadowColor = QUANTUM;
    ctx.shadowBlur = 8 * sc;
    ctx.strokeStyle = QUANTUM;
    ctx.lineWidth = Math.max(PX, 1.2 * sc);
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

  // The player on the ball stands in a ring of his team colour, over a dark
  // under-stroke so the ring reads on both grass stripes.
  if (d.carrier) {
    ctx.lineWidth = Math.max(PX, 1.6 * sc);
    ctx.strokeStyle = kit.outline;
    ctx.beginPath();
    ctx.ellipse(pr.x, pr.y, RING_RX * sc, RING_RY * sc, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = Math.max(PX * 0.6, 1.0 * sc);
    ctx.strokeStyle = kit.marker;
    ctx.stroke();
  }

  // Ground marker: a disc of team colour under every player (keepers too, so
  // a keeper in his keeper kit still reads as part of his side).
  ctx.save();
  ctx.globalAlpha *= MARKER_ALPHA;
  ctx.fillStyle = kit.marker;
  ell(ctx, pr.x, pr.y, MARKER_RX * sc, MARKER_RY * sc);
  ctx.restore();

  const { hop, h, scaleX: sx0p, scaleY: sy0p } = d.pose;
  const act = d.act;
  const sx0 = sx0p * (act ? act.scaleX : 1);
  const sy0 = sy0p * (act ? act.scaleY : 1);
  const a = d.appearance;
  const u = sc;
  const feetY = pr.y - hop - (act ? act.lift * sc : 0);

  // Grounding shadow (no hop), shrinking as the body rises.
  ctx.fillStyle = SHADOW;
  ell(ctx, pr.x, pr.y, 2.8 * sc * (1 - 0.28 * h), 1.1 * sc * (1 - 0.28 * h));

  // An event animation leans the whole body about the feet (a slide, a
  // fall, a dive), toward the way he faces when the tilt is positive.
  const tilted = act != null && act.tilt !== 0;
  if (tilted) {
    ctx.save();
    ctx.translate(pr.x, feetY);
    ctx.rotate(act.tilt * d.face);
    ctx.translate(-pr.x, -feetY);
  }

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
  const ol = Math.max(PX, 0.8 * u);

  // Legs / shorts in the kit colour, outlined and cel-shaded; they scissor on
  // the swing.  In a kick the FRONT leg (the side he faces) is drawn back,
  // then swung through and lifted.
  const { swing } = d.pose;
  const lx1 = pr.x - gap - legW / 2 + swing;
  const lx2 = pr.x + gap - legW / 2 - swing;
  const kick = act ? act.kickLeg : 0;
  const frontIsRight = d.face >= 0;
  for (const [i, lx] of [lx1, lx2].entries()) {
    const front = (i === 1) === frontIsRight;
    const kx = front ? kick * legW * 1.1 * d.face : 0;
    const ky = front ? Math.abs(kick) * legH * 0.45 : 0;
    obox(ctx, lx + kx, legTop - ky, legW, legH, kit.shorts, kit.outline, ol * 0.6);
    celShade(ctx, lx + kx, legTop - ky, legW, legH, kit.shorts);
  }

  // Arms.  At rest, the nub arms (the locked `limbs: nub` config): fixed
  // stubby bent limbs splayed slightly down-and-out, no swing, the calm
  // on-2s idle read.  An event animation raises or spreads them (armAngles).
  // Outfield arms are phosphor; a keeper's are his kit's long sleeves.
  const upperLen = bodyH * 0.5;
  const foreLen = bodyH * 0.46;
  const armW = Math.max(PX, legW * 0.9);
  const shoulderY = bodyTop + bodyH * 0.18;
  const armOutline = kit.sleeves === PHOS ? ABYSS : kit.outline;
  const arms = act ? act.arms : 'rest';
  if (arms === 'rest') {
    drawArmJointed(ctx, pr.x + bodyW * 0.42, shoulderY, Math.PI / 2 + 0.3, 0, upperLen * 0.6, foreLen * 0.5, armW, kit.sleeves, ol, armOutline);
    drawArmJointed(ctx, pr.x - bodyW * 0.42, shoulderY, Math.PI / 2 - 0.3, 0, upperLen * 0.6, foreLen * 0.5, armW, kit.sleeves, ol, armOutline);
  } else {
    const [right, left] = armAngles(arms, d.face);
    // Raised arms are longer and bend in at the elbow so the hands clear
    // the big head (a throw-in's hands meet over it, a celebration's spread).
    const raised = arms === 'up' || arms === 'overhead';
    const reach = arms === 'overhead' ? 1.45 : raised ? 1.25 : 0.8;
    const bend = arms === 'overhead' ? 0.95 : 0;
    drawArmJointed(ctx, pr.x + bodyW * 0.42, shoulderY, right, -bend, upperLen * reach, foreLen * reach, armW, kit.sleeves, ol, armOutline);
    drawArmJointed(ctx, pr.x - bodyW * 0.42, shoulderY, left, bend, upperLen * reach, foreLen * reach, armW, kit.sleeves, ol, armOutline);
  }

  // Torso: the shirt, outlined in the kit's deep shade and cel-shaded.
  obox(ctx, pr.x - bodyW / 2, bodyTop, bodyW, bodyH, kit.shirt, kit.outline, ol);
  celShade(ctx, pr.x - bodyW / 2, bodyTop, bodyW, bodyH, kit.shirt);

  // Squad number on the chest, in the brand's mono, in whichever of abyss or
  // phosphor contrasts more with the shirt (kits.ts picks it).  Skipped when
  // the sprite is too small to read.
  if (sc > PX) {
    const fs = Math.max(4 * PX, Math.round(bodyH * 0.4));
    ctx.font = `700 ${fs}px "Space Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = kit.digits;
    ctx.fillText(String(d.number), pr.x, bodyTop + bodyH * 0.52);
  }

  drawHead(ctx, pr.x, headY, head, u, d.face, a);

  if (tilted) ctx.restore();
  // Restore the alpha we lowered for a dimmed (non-selected) dude.
  if (dimmed) ctx.restore();
}

/**
 * Upper-arm angles (canvas radians, 0 = right, PI/2 = down) for an arm
 * preset, as [right shoulder, left shoulder].  'forward' and 'back' follow
 * the way he faces.
 */
export function armAngles(arms: ArmPreset, face: number): [number, number] {
  const fwd = face >= 0 ? -0.15 : Math.PI + 0.15;
  const back = face >= 0 ? Math.PI - 0.7 : 0.7;
  switch (arms) {
    case 'up':
      return [-Math.PI / 2 + 0.4, -Math.PI / 2 - 0.4];
    case 'out':
      return [-0.2, Math.PI + 0.2];
    case 'overhead':
      // Out from the shoulders; the forearms bend back in to meet over the head.
      return [-Math.PI / 2 + 0.5, -Math.PI / 2 - 0.5];
    case 'forward':
      return [fwd, fwd];
    case 'back':
      return [back, back];
    case 'rest':
      return [Math.PI / 2 + 0.3, Math.PI / 2 - 0.3];
  }
}

// ── Ball ─────────────────────────────────────────────────────────────────────

/**
 * Draw the ball: a fading trail when it travels fast, a ground shadow that
 * stays on the grass and shrinks and fades as the ball rises (so the gap
 * between them shows the height), then the ball itself in its own colour with
 * a dark outline and a shaded side.
 */
export function drawBall(ctx: CanvasRenderingContext2D, project: ProjectFn, b: BallRender): void {
  // A held ball (a throw-in over the head, a keeper's catch) is placed on
  // the holder's sprite, `heldLift` sprite units above his feet.
  const gr = project(b.wx, b.wy, 0);
  const pr = b.heldLift != null ? { x: gr.x, y: gr.y - b.heldLift * gr.sc, sc: gr.sc } : project(b.wx, b.wy, b.wz);
  const sc = pr.sc;
  const r = BALL_RADIUS * sc;
  const outline = Math.max(PX * 0.5, 0.55 * sc);

  // Trail: segments from oldest to newest, thicker and more opaque toward
  // the ball, coloured by the kind of kick in flight (TRAIL_STYLE): a shot
  // is wider and brighter, with a glow.
  const trail = b.trail ?? [];
  if (trail.length > 1) {
    const style = TRAIL_STYLE[b.trailKind ?? 'pass'];
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = style.color;
    if (style.glow) {
      ctx.shadowColor = style.color;
      ctx.shadowBlur = 4 * PX;
    }
    const pts = [...trail.map((q) => project(q.x, q.y, q.z)), pr];
    for (let i = 1; i < pts.length; i++) {
      const f = i / (pts.length - 1);
      ctx.globalAlpha = Math.min(1, (0.1 + 0.55 * f * f) * style.alpha);
      ctx.lineWidth = Math.max(PX * 0.5, r * (0.5 + 0.9 * f) * style.width);
      ctx.beginPath();
      ctx.moveTo(pts[i - 1]!.x, pts[i - 1]!.y);
      ctx.lineTo(pts[i]!.x, pts[i]!.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Ground shadow: under the ball on the grass; smaller and fainter with height.
  const lift = b.heldLift != null ? 0.6 : Math.min(1, Math.max(0, b.wz) / 4);
  ctx.save();
  ctx.globalAlpha *= 1 - 0.55 * lift;
  ctx.fillStyle = SHADOW;
  ell(ctx, gr.x, gr.y + 0.3 * sc, 2.6 * sc * (1 - 0.4 * lift), 1.1 * sc * (1 - 0.4 * lift));
  ctx.restore();

  // The ball: outline, body, shaded side.
  ctx.fillStyle = ABYSS;
  circle(ctx, pr.x, pr.y, r + outline);
  ctx.fillStyle = BALL_COLOR;
  circle(ctx, pr.x, pr.y, r);
  ctx.fillStyle = BALL_SHADE;
  circle(ctx, pr.x + 0.5 * sc, pr.y + 0.5 * sc, r * 0.5);
}
