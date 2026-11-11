// ── features/match/ui/viewer/render.ts ──────────────────────────────────────
// The canvas drawing layer for the match viewer.  Pure-ish: every function
// takes a CanvasRenderingContext2D and a `project` closure (built by the
// component from the active camera), so it knows nothing about React, the
// rAF loop, or which camera is live.  All per-frame MATH lives in logic/viewer;
// this file only turns positions + poses into pixels.
//
// STYLE: TINY TERRACES, "CHARMING" (docs/match-viewer.md section 6)
//   A Galactic Abyss pitch with hairline Lunar Dust markings, and pixel-pure
//   figures on one coarse grid (figure.ts): big round heads in the thirteen
//   peoples' shapes, club-colour shirts and socks, floppy spring arms.
//
// READABILITY (sections 2C and 3, unchanged)
//   - KITS come from logic/viewer/kits.ts (one legibility rule, one clash
//     rule, a keeper kit per side), never straight from `teams.color`; a
//     ground marker in the team colour sits under every player.
//   - KEEPERS wear their bright keeper kit with long sleeves.  Nothing is
//     drawn as a dark or hollow figure: there is no referee, and fans read a
//     dark figure as one.
//   - THE BALL has its own colour, a dark outline, a ground shadow that
//     separates from it as it rises, and a short fading trail.  The player on
//     the ball stands in a ring in his team colour.
//   - TWO X: the backing store is twice the 320 x 208 art.  The pitch lines
//     and figures are drawn on the 1x art grid (PIXEL_SCALE backing pixels a
//     figure pixel), so they stay chunky; the ball and the event marks are
//     sized in projection-scale units as before.

import { canvasColor } from '../../../../shared/design';
import {
  GOALS,
  GOAL_DEPTH,
  PITCH_MARKINGS,
  type ActionBody,
  type Appearance,
  type ArmState,
  type GoalSpec,
  type Kit,
  type Marking,
  type Projected,
} from '../../logic/viewer';
import { drawFigure, pixelEllipse, pixelRing, pline, px, resetFill, setGrid } from './figure';

/** Maps a world point (metres + height) to screen space under the active camera. */
export type ProjectFn = (wx: number, wy: number, wz: number) => Projected;

/**
 * Backing-store pixels per pixel of the original 320 x 208 art.  The component
 * multiplies the projection's depth scale `sc` by this, so every size
 * expressed in `sc` units scales with it; the pitch lines and the figures are
 * drawn on this grid.
 */
export const PIXEL_SCALE = 2;
/** Short alias for the absolute sizes in this file. */
const PX = PIXEL_SCALE;

/**
 * Figure scale per unit of art-space depth scale: the sketch's figure at
 * 0.9 of its close-up size on the broadcast pitch (about 13 art pixels tall
 * at mid-pitch).
 */
export const FIGURE_SCALE = 0.9;

// ── Palette (canvas tokens) ───────────────────────────────────────────────────
// A canvas cannot read CSS variables, so the colours come from `canvasColor`
// in src/shared/design/tokens.ts: literal values that tokens.test.ts holds
// equal to their custom properties in tokens.css.

/** Galactic Abyss: the ball's outline. */
const ABYSS = canvasColor.bg;
/** Quantum Purple: the focus halo (the Architect's eye on the selected soul). */
const QUANTUM = canvasColor.architect;
const SHADOW = canvasColor.shadow;
/** The ball: its own colour, measured against every kit in kits.test.ts. */
const BALL_COLOR = canvasColor.ball;
/** The ball's shaded side. */
const BALL_SHADE = canvasColor.ballShade;
/** Hairline markings and the slightly brighter goal frames. */
const LINE = canvasColor.line;
const GOAL_LINE = canvasColor.goalLine;

/** How far a dimmed (non-selected) figure fades when another player is in focus. */
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

// ── A drawable figure / ball ──────────────────────────────────────────────────

/** Everything the renderer needs to draw one player this frame. */
export interface DudeRender {
  /** World position in metres. */
  wx: number;
  wy: number;
  /** Stride phase (radians) and how hard he is running (0..1). */
  phase: number;
  run: number;
  /** His look: people, proportions, head tone and details. */
  appearance: Appearance;
  /** What this figure wears (from resolveKits: outfield or keeper kit of his side). */
  kit: Kit;
  /** Facing: +1 right, -1 left. */
  face: number;
  /** His spring arms (absent: arms at rest). */
  arms?: ArmState | null;
  /** Seconds on the viewer's real-time clock (blinks, breathing); absent = 0. */
  t?: number;
  /** Draw the Quantum focus halo under this figure (the clicked player). */
  highlighted?: boolean;
  /** He has the ball: draw a ring in his team colour under him. */
  carrier?: boolean;
  /** Fade this figure back (a different player is selected) so the focus stands out. */
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
  /** A held ball: drawn this many sprite (`sc`) units above the holder's feet at (wx, wy). */
  heldLift?: number | null;
}

/**
 * Sprite (`sc`) units per metre of height on a figure: a Charming figure is
 * about 14 figure pixels at scale 1 drawn at FIGURE_SCALE, about 1.8 m; a
 * little less than that so a ball held overhead sits in his hands.
 * Places a held ball (over the head for a throw-in, at the chest for a catch).
 */
export const SPRITE_UNITS_PER_M = 6.6;

// ── Low-level helpers (the ball and the halo keep their round shapes) ────────

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

// ── Pitch ────────────────────────────────────────────────────────────────────

/** A projected point on the art grid (backing pixels / PIXEL_SCALE). */
function artOf(project: ProjectFn, wx: number, wy: number, wz: number): { x: number; y: number } {
  const p = project(wx, wy, wz);
  return { x: p.x / PX, y: p.y / PX };
}

/**
 * A polyline of hairlines through world points on the grass.  Joints are
 * drawn once (the colour is translucent, so a doubled pixel would show).
 */
function hairPath(ctx: CanvasRenderingContext2D, project: ProjectFn, pts: ReadonlyArray<readonly [number, number, number]>, col: string, closed: boolean): void {
  const n = pts.length;
  const first = artOf(project, pts[0]![0], pts[0]![1], pts[0]![2]);
  let prev = first;
  for (let i = 1; i < n; i++) {
    const q = artOf(project, pts[i]![0], pts[i]![1], pts[i]![2]);
    pline(ctx, prev.x, prev.y, q.x, q.y, col, 1, i > 1);
    prev = q;
  }
  if (closed) {
    // The closing segment skips both its ends: both are already drawn.
    const dx = first.x - prev.x;
    const dy = first.y - prev.y;
    const len = Math.max(Math.abs(dx), Math.abs(dy));
    if (len > 1.5) {
      const k = 1 / len;
      pline(ctx, prev.x, prev.y, first.x - dx * k, first.y - dy * k, col, 1, true);
    }
  }
}

/** Draw one pitch marking by running its geometry through the projection. */
function drawMarking(ctx: CanvasRenderingContext2D, project: ProjectFn, m: Marking): void {
  switch (m.kind) {
    case 'rect':
      hairPath(ctx, project, [[m.x0, m.y0, 0], [m.x1, m.y0, 0], [m.x1, m.y1, 0], [m.x0, m.y1, 0]], LINE, true);
      break;
    case 'line':
      hairPath(ctx, project, [[m.x0, m.y0, 0], [m.x1, m.y1, 0]], LINE, false);
      break;
    case 'arc': {
      // 40 samples turn the world circle into a perspective ellipse.
      const N = 40;
      const pts: Array<[number, number, number]> = [];
      const full = Math.abs(m.a1 - m.a0) >= Math.PI * 2 - 1e-6;
      for (let i = 0; i < (full ? N : N + 1); i++) {
        const ang = m.a0 + ((m.a1 - m.a0) * i) / N;
        pts.push([m.cx + m.r * Math.cos(ang), m.cy + m.r * Math.sin(ang), 0]);
      }
      hairPath(ctx, project, pts, LINE, full);
      break;
    }
    case 'spot': {
      const p = artOf(project, m.x, m.y, 0);
      px(ctx, p.x - 0.5, p.y - 0.5, 1, 1, LINE);
      break;
    }
  }
}

/**
 * Draw a goal frame: posts, crossbar, and a short net depth off the line, as
 * stepped hairlines on the art grid.  The pitch draws it in `goalLine`, a
 * step brighter than the markings; the goal-frame flare (renderEvents.ts)
 * draws it again in full Lunar Dust over that.
 *
 * @param col  The hairline colour (a `canvasColor` token).
 */
export function drawGoalFrame(ctx: CanvasRenderingContext2D, project: ProjectFn, goal: GoalSpec, col: string = GOAL_LINE): void {
  const back = goal.x + GOAL_DEPTH * goal.depthDir;
  hairPath(ctx, project, [[goal.x, goal.y0, 0], [goal.x, goal.y0, goal.height], [goal.x, goal.y1, goal.height], [goal.x, goal.y1, 0]], col, false);
  hairPath(ctx, project, [[goal.x, goal.y0, goal.height], [back, goal.y0, goal.height]], col, false);
  hairPath(ctx, project, [[goal.x, goal.y1, goal.height], [back, goal.y1, goal.height]], col, false);
}

/**
 * The back of a goal's net: the rear posts and bar and the two ground lines
 * back from the posts.  Not part of the resting pitch (it would clutter the
 * hairline goal); the goal-frame flare draws it with the frame so the whole
 * goal lights up for a moment.
 *
 * @param col  The hairline colour (a `canvasColor` token).
 */
export function drawGoalNet(ctx: CanvasRenderingContext2D, project: ProjectFn, goal: GoalSpec, col: string): void {
  const back = goal.x + GOAL_DEPTH * goal.depthDir;
  hairPath(ctx, project, [[back, goal.y0, 0], [back, goal.y0, goal.height], [back, goal.y1, goal.height], [back, goal.y1, 0]], col, false);
  hairPath(ctx, project, [[goal.x, goal.y0, 0], [back, goal.y0, 0]], col, false);
  hairPath(ctx, project, [[goal.x, goal.y1, 0], [back, goal.y1, 0]], col, false);
}

/**
 * Draw the static pitch: every regulation marking as a hairline and both
 * goals, on the art grid.  The surface is the canvas background (Galactic
 * Abyss), filled by the caller.  Cheap enough every frame under the Ball
 * camera; the component bakes it once for the Pitch camera.
 */
export function drawPitch(ctx: CanvasRenderingContext2D, project: ProjectFn): void {
  resetFill();
  setGrid(PX);
  for (const m of PITCH_MARKINGS) drawMarking(ctx, project, m);
  for (const goal of GOALS) drawGoalFrame(ctx, project, goal);
  resetFill();
}

// ── Figure ───────────────────────────────────────────────────────────────────

/**
 * Draw one player at his world position, posed for this frame: focus halo,
 * carrier ring, ground marker and shadow, then the Charming figure (figure.ts).
 * Distant players shrink with the projection's depth scale.
 */
export function drawDude(ctx: CanvasRenderingContext2D, project: ProjectFn, d: DudeRender): void {
  const pr = project(d.wx, d.wy, 0);
  const sc = pr.sc;
  const kit = d.kit;
  const ax = pr.x / PX;
  const ay = pr.y / PX;
  const as = sc / PX;

  // Quantum focus halo (under the figure) marks the clicked player: the one
  // place the accent colour appears on the pitch.
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
  const dimmed = d.dimmed === true;
  if (dimmed) {
    ctx.save();
    ctx.globalAlpha = DIM_ALPHA;
  }
  resetFill();
  setGrid(PX);

  // The player on the ball stands in a ring of his team colour, edged in the
  // kit's deep shade so it reads on the pitch.
  if (d.carrier) {
    pixelRing(ctx, ax, ay, RING_RX * as + 1, RING_RY * as + 1, kit.outline);
    pixelRing(ctx, ax, ay, RING_RX * as, RING_RY * as, kit.marker);
  }

  // Ground marker: a disc of team colour under every player (keepers too, so
  // a keeper in his keeper kit still reads as part of his side), and the
  // shadow of his feet on it.
  const ga = ctx.globalAlpha;
  ctx.globalAlpha = ga * MARKER_ALPHA;
  pixelEllipse(ctx, ax, ay, MARKER_RX * as, MARKER_RY * as, kit.marker);
  ctx.globalAlpha = ga;
  pixelEllipse(ctx, ax, ay, 2.6 * as, 1.0 * as, SHADOW);

  drawFigure(
    ctx,
    {
      x: ax,
      y: ay,
      f: FIGURE_SCALE * as,
      face: d.face,
      kit,
      look: d.appearance,
      phase: d.phase,
      run: d.run,
      act: d.act ?? null,
      arms: d.arms ?? null,
      t: d.t ?? 0,
    },
    PX,
  );
  resetFill();
  if (dimmed) ctx.restore();
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
  // the ball, in the ball's own colour whatever the kick (the coloured
  // trails by kind of kick were cut, docs/match-viewer.md section 7).
  const trail = b.trail ?? [];
  if (trail.length > 1) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = BALL_COLOR;
    const pts = [...trail.map((q) => project(q.x, q.y, q.z)), pr];
    for (let i = 1; i < pts.length; i++) {
      const f = i / (pts.length - 1);
      ctx.globalAlpha = 0.1 + 0.55 * f * f;
      ctx.lineWidth = Math.max(PX * 0.5, r * (0.5 + 0.9 * f));
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
