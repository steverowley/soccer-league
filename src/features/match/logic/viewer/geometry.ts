// ── features/match/logic/viewer/geometry.ts ─────────────────────────────────
// Regulation pitch markings as world-space primitives (metres).  The renderer
// runs each primitive's points through the active projection and strokes it, so
// the same data draws correctly under any camera.
//
// Because world units ARE metres, every marking is to-scale by construction —
// the numbers below are the real FIFA dimensions, centred on (52.5, 34).

import { GOAL_Y_MIN, GOAL_Y_MAX, PITCH_LENGTH, PITCH_WIDTH } from '../spatial/types';

// ── Real-world marking dimensions (metres) ───────────────────────────────────

/** Penalty area: 16.5 m deep, 40.32 m wide (16.5 either side of the posts). */
const PEN_AREA_DEPTH = 16.5;
const PEN_AREA_WIDTH = 40.32;
/** Goal area ("6-yard box"): 5.5 m deep, 18.32 m wide. */
const GOAL_AREA_DEPTH = 5.5;
const GOAL_AREA_WIDTH = 18.32;
/** Penalty spot: 11 m from the goal line. */
const PEN_SPOT_DIST = 11;
/** Centre circle / penalty-arc radius: 9.15 m. */
const ARC_RADIUS = 9.15;
/**
 * Half-angle (radians) of the penalty "D": the slice of the 9.15 m arc that
 * falls OUTSIDE the 16.5 m penalty box.  acos(5.5/9.15) ≈ 0.93 rad ≈ 53°.
 */
const D_HALF_ANGLE = Math.acos((PEN_AREA_DEPTH - PEN_SPOT_DIST) / ARC_RADIUS);

const cx = PITCH_LENGTH / 2;
const cy = PITCH_WIDTH / 2;
const penY0 = (PITCH_WIDTH - PEN_AREA_WIDTH) / 2;
const penY1 = (PITCH_WIDTH + PEN_AREA_WIDTH) / 2;
const gaY0 = (PITCH_WIDTH - GOAL_AREA_WIDTH) / 2;
const gaY1 = (PITCH_WIDTH + GOAL_AREA_WIDTH) / 2;

// ── Primitive shapes ─────────────────────────────────────────────────────────

/** A single drawable marking, all coordinates in pitch metres. */
export type Marking =
  | { kind: 'rect'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'line'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'arc'; cx: number; cy: number; r: number; a0: number; a1: number }
  | { kind: 'spot'; x: number; y: number };

/**
 * Every line on a regulation pitch, in draw order (outermost first).  Arcs are
 * rendered by sampling points along [a0, a1]; the renderer connects them so the
 * projection turns circles into correct perspective ellipses.
 */
export const PITCH_MARKINGS: readonly Marking[] = [
  { kind: 'rect', x0: 0, y0: 0, x1: PITCH_LENGTH, y1: PITCH_WIDTH }, // touchlines
  { kind: 'line', x0: cx, y0: 0, x1: cx, y1: PITCH_WIDTH }, // halfway line
  { kind: 'arc', cx, cy, r: ARC_RADIUS, a0: 0, a1: Math.PI * 2 }, // centre circle
  { kind: 'spot', x: cx, y: cy }, // centre spot
  // penalty areas
  { kind: 'rect', x0: 0, y0: penY0, x1: PEN_AREA_DEPTH, y1: penY1 },
  { kind: 'rect', x0: PITCH_LENGTH - PEN_AREA_DEPTH, y0: penY0, x1: PITCH_LENGTH, y1: penY1 },
  // goal areas
  { kind: 'rect', x0: 0, y0: gaY0, x1: GOAL_AREA_DEPTH, y1: gaY1 },
  { kind: 'rect', x0: PITCH_LENGTH - GOAL_AREA_DEPTH, y0: gaY0, x1: PITCH_LENGTH, y1: gaY1 },
  // penalty spots
  { kind: 'spot', x: PEN_SPOT_DIST, y: cy },
  { kind: 'spot', x: PITCH_LENGTH - PEN_SPOT_DIST, y: cy },
  // penalty "D" arcs (only the part outside the box)
  { kind: 'arc', cx: PEN_SPOT_DIST, cy, r: ARC_RADIUS, a0: -D_HALF_ANGLE, a1: D_HALF_ANGLE },
  {
    kind: 'arc',
    cx: PITCH_LENGTH - PEN_SPOT_DIST,
    cy,
    r: ARC_RADIUS,
    a0: Math.PI - D_HALF_ANGLE,
    a1: Math.PI + D_HALF_ANGLE,
  },
];

// ── Goals ──────────────────────────────────────────────────────────────────────

/** Goal frame height in metres (real-world 2.44 m). */
export const GOAL_HEIGHT = 2.44;
/** How far the net is drawn behind the goal line, in metres. */
export const GOAL_DEPTH = 2;

/** One goal: posts at (x, y0)→(x, y1), `height` tall, net receding by `depthDir`. */
export interface GoalSpec {
  x: number;
  y0: number;
  y1: number;
  height: number;
  /** −1 for the home goal (net recedes off the −x side), +1 for the away goal. */
  depthDir: number;
}

/** Both goals, sized from the shared GOAL_WIDTH so they line up with the engine's goal mouth. */
export const GOALS: readonly GoalSpec[] = [
  { x: 0, y0: GOAL_Y_MIN, y1: GOAL_Y_MAX, height: GOAL_HEIGHT, depthDir: -1 },
  { x: PITCH_LENGTH, y0: GOAL_Y_MIN, y1: GOAL_Y_MAX, height: GOAL_HEIGHT, depthDir: 1 },
];
