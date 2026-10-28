// ── features/match/ui/viewer/renderEvents.ts ────────────────────────────────
// Canvas drawing for the event layer (docs/match-viewer.md section 5B): the
// marks on the pitch (restart spot, dust puff, whistle mark, card, net
// ripple, woodwork flash, through-ball target, offside flag, substitution
// arrows) and the pitch labels (GOAL, CORNER, REPLAY...).
//
// Like render.ts, every function takes the context and the active camera's
// `project` closure and knows nothing about React or timing: the WHEN lives
// in logic/viewer/actionAnim.ts (each mark arrives with its progress `t`,
// 0..1 through its real-time window) and the replay scheduler.
//
// COLOURS only from `canvasColor` (mirrored in tokens.css): red ONLY for a
// red card (the live token), the card-yellow token for a yellow card,
// purple never (it belongs to the Architect).  LABELS use the design
// system's label style: Space Mono 700, uppercase, 0.12em tracking, on an
// abyss panel with a hairline, radius 0.

import { canvasColor } from '../../../../shared/design';
import { GOALS, GOAL_DEPTH, type Viewport } from '../../logic/viewer';
import { PITCH_LENGTH, PITCH_WIDTH } from '../../logic/spatial/types';
import { PIXEL_SCALE, type ProjectFn } from './render';

const PX = PIXEL_SCALE;

/** Label text size in backing pixels: the design label (11 px) on a phone-sized canvas. */
export const LABEL_PX = 10 * PX;
/** The design label's tracking, as a fraction of the size. */
const LABEL_TRACKING = 0.12;
/** Space Mono's advance width, as a fraction of the size (monospace). */
const MONO_ADVANCE = 0.6;
/** Label panel padding, in backing pixels. */
const LABEL_PAD_X = 6 * PX;
const LABEL_PAD_Y = 3 * PX;
/** Distance of a top label from the canvas edge. */
const LABEL_MARGIN = 6 * PX;

/** Fade in over the first part of a window and out over the last. */
function fade(t: number, inFrac = 0.12, outFrac = 0.25): number {
  if (t < inFrac) return t / inFrac;
  if (t > 1 - outFrac) return Math.max(0, (1 - t) / outFrac);
  return 1;
}

// ── Labels ───────────────────────────────────────────────────────────────────

/** Where a label sits: centred at the top, or in the top-left corner (REPLAY). */
export type LabelPlace = 'top' | 'corner';

/**
 * The width a label's text takes in backing pixels (Space Mono is
 * monospaced, so this needs no text measurement).
 */
export function labelTextWidth(text: string): number {
  return text.length * LABEL_PX * (MONO_ADVANCE + LABEL_TRACKING);
}

/**
 * Draw a pitch label in the design system's label style.
 *
 * @param ctx    Canvas context.
 * @param vp     Canvas size (backing pixels).
 * @param text   Upper-case label text.
 * @param place  'top' (centred) or 'corner' (top-left, for REPLAY).
 */
export function drawPitchLabel(ctx: CanvasRenderingContext2D, vp: Viewport, text: string, place: LabelPlace = 'top'): void {
  const w = labelTextWidth(text) + 2 * LABEL_PAD_X;
  const h = LABEL_PX + 2 * LABEL_PAD_Y;
  const x = place === 'top' ? Math.round((vp.width - w) / 2) : LABEL_MARGIN;
  const y = LABEL_MARGIN;
  ctx.save();
  ctx.fillStyle = canvasColor.labelPanel;
  ctx.fillRect(x, y, Math.round(w), Math.round(h));
  ctx.strokeStyle = canvasColor.goalLine;
  ctx.lineWidth = PX * 0.5;
  ctx.strokeRect(x + PX * 0.25, y + PX * 0.25, Math.round(w) - PX * 0.5, Math.round(h) - PX * 0.5);
  ctx.font = `700 ${LABEL_PX}px "Space Mono", monospace`;
  const withSpacing = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ('letterSpacing' in withSpacing) withSpacing.letterSpacing = `${LABEL_PX * LABEL_TRACKING}px`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = canvasColor.text;
  ctx.fillText(text, x + LABEL_PAD_X, y + h / 2 + PX * 0.5);
  ctx.restore();
}

// ── Marks tied to a place ────────────────────────────────────────────────────

/** A restart's spot: a ring with a cross on the grass where the ball is placed. */
export function drawSpotMarker(ctx: CanvasRenderingContext2D, project: ProjectFn, x: number, y: number): void {
  const p = project(x, y, 0);
  const sc = p.sc;
  ctx.save();
  ctx.strokeStyle = canvasColor.text;
  ctx.lineWidth = Math.max(PX * 0.5, 0.6 * sc);
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, 4.2 * sc, 1.7 * sc, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(p.x - 5.6 * sc, p.y);
  ctx.lineTo(p.x - 3 * sc, p.y);
  ctx.moveTo(p.x + 3 * sc, p.y);
  ctx.lineTo(p.x + 5.6 * sc, p.y);
  ctx.stroke();
  ctx.restore();
}

/** The net of the goal on line `goalX` rippling after a goal (t: 0..1). */
export function drawNetRipple(ctx: CanvasRenderingContext2D, project: ProjectFn, goalX: number, t: number): void {
  const goal = GOALS.find((g) => Math.abs(g.x - goalX) < 1) ?? GOALS[goalX < PITCH_LENGTH / 2 ? 0 : 1];
  if (!goal) return;
  const amp = 0.55 * (1 - t);
  const strands = 9;
  ctx.save();
  ctx.strokeStyle = canvasColor.net;
  ctx.lineWidth = PX * 0.5;
  ctx.globalAlpha = fade(t, 0.05, 0.4);
  for (let i = 0; i <= strands; i++) {
    const y = goal.y0 + ((goal.y1 - goal.y0) * i) / strands;
    const bulge = amp * Math.sin(t * Math.PI * 6 + i * 0.9);
    const back = project(goal.x + (GOAL_DEPTH + bulge) * goal.depthDir, y, goal.height * 0.5);
    const top = project(goal.x, y, goal.height);
    const foot = project(goal.x + GOAL_DEPTH * goal.depthDir, y, 0);
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(back.x, back.y);
    ctx.lineTo(foot.x, foot.y);
    ctx.stroke();
  }
  ctx.restore();
}

/** A flash where a shot struck the frame (t: 0..1). */
export function drawWoodworkFlash(ctx: CanvasRenderingContext2D, project: ProjectFn, x: number, y: number, z: number, t: number): void {
  const p = project(x, y, Math.max(0, z));
  const sc = p.sc;
  const r0 = 2 * sc;
  const r1 = (4 + 6 * t) * sc;
  ctx.save();
  ctx.strokeStyle = canvasColor.trailShot;
  ctx.lineWidth = Math.max(PX * 0.5, 0.9 * sc);
  ctx.globalAlpha = 1 - t;
  ctx.beginPath();
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    ctx.moveTo(p.x + Math.cos(a) * r0, p.y + Math.sin(a) * r0);
    ctx.lineTo(p.x + Math.cos(a) * r1, p.y + Math.sin(a) * r1);
  }
  ctx.stroke();
  ctx.restore();
}

/** Where a through ball is met: a small target mark in the ball's colour. */
export function drawTargetMark(ctx: CanvasRenderingContext2D, project: ProjectFn, x: number, y: number, t: number): void {
  const p = project(x, y, 0);
  const sc = p.sc;
  ctx.save();
  ctx.strokeStyle = canvasColor.ball;
  ctx.lineWidth = Math.max(PX * 0.5, 0.6 * sc);
  ctx.globalAlpha = 0.9 * fade(t, 0.1, 0.2);
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, 3.2 * sc, 1.3 * sc, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(p.x - 1.6 * sc, p.y - 0.65 * sc);
  ctx.lineTo(p.x + 1.6 * sc, p.y + 0.65 * sc);
  ctx.moveTo(p.x + 1.6 * sc, p.y - 0.65 * sc);
  ctx.lineTo(p.x - 1.6 * sc, p.y + 0.65 * sc);
  ctx.stroke();
  ctx.restore();
}

/**
 * Offside: a dashed line across the pitch at the offending player's x and
 * a flag raised on the near touchline there.
 */
export function drawOffsideMark(ctx: CanvasRenderingContext2D, project: ProjectFn, x: number, t: number): void {
  const a = project(x, 0, 0);
  const b = project(x, PITCH_WIDTH, 0);
  ctx.save();
  ctx.globalAlpha = fade(t);
  ctx.strokeStyle = canvasColor.flag;
  ctx.lineWidth = PX * 0.5;
  ctx.setLineDash([3 * PX, 2 * PX]);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.setLineDash([]);
  // The flag on the near touchline, just outside the line.
  const foot = project(x, PITCH_WIDTH + 1, 0);
  const top = project(x, PITCH_WIDTH + 1, 2);
  const sc = foot.sc;
  ctx.strokeStyle = canvasColor.text;
  ctx.lineWidth = Math.max(PX * 0.5, 0.6 * sc);
  ctx.beginPath();
  ctx.moveTo(foot.x, foot.y);
  ctx.lineTo(top.x, top.y);
  ctx.stroke();
  ctx.fillStyle = canvasColor.flag;
  ctx.fillRect(Math.round(top.x), Math.round(top.y), Math.round(4 * sc), Math.round(3 * sc));
  ctx.restore();
}

/** A substitution: an arrow in (success green) and an arrow out (phosphor) at the halfway touchline. */
export function drawSubArrows(ctx: CanvasRenderingContext2D, project: ProjectFn, t: number): void {
  const at = project(PITCH_LENGTH / 2, PITCH_WIDTH + 1.5, 0);
  const sc = at.sc;
  const s = 2.6 * sc;
  const gapX = 3.2 * sc;
  ctx.save();
  ctx.globalAlpha = fade(t, 0.08, 0.2);
  const arrow = (cx: number, up: boolean, fill: string): void => {
    const dir = up ? -1 : 1;
    const tipY = at.y - 3 * sc + dir * s;
    ctx.fillStyle = canvasColor.bg;
    ctx.beginPath();
    ctx.moveTo(cx, tipY + dir * 0.6 * sc);
    ctx.lineTo(cx - s - 0.6 * sc, at.y - 3 * sc - dir * 0.4 * sc);
    ctx.lineTo(cx + s + 0.6 * sc, at.y - 3 * sc - dir * 0.4 * sc);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(cx, tipY);
    ctx.lineTo(cx - s, at.y - 3 * sc);
    ctx.lineTo(cx + s, at.y - 3 * sc);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(Math.round(cx - 0.6 * sc), Math.round(at.y - 3 * sc - (up ? 0 : 2.4 * sc)), Math.round(1.2 * sc), Math.round(2.4 * sc));
  };
  arrow(at.x - gapX, true, canvasColor.subOn);
  arrow(at.x + gapX, false, canvasColor.text);
  ctx.restore();
}

// ── Marks tied to a player (drawn where his figure is drawn) ───────────────────

/** Dust kicked up by a slide tackle at the tackler's feet (t: 0..1). */
export function drawDust(ctx: CanvasRenderingContext2D, project: ProjectFn, x: number, y: number, face: number, t: number): void {
  const p = project(x, y, 0);
  const sc = p.sc;
  ctx.save();
  ctx.fillStyle = canvasColor.dust;
  ctx.globalAlpha = 1 - t;
  for (let k = 0; k < 4; k++) {
    const off = (-1.5 - k * 1.6) * face * sc * (0.6 + t);
    const r = (1.1 + 0.5 * k) * sc * (0.7 + 0.8 * t);
    ctx.beginPath();
    ctx.ellipse(p.x + off, p.y - (0.4 + 0.5 * k) * sc * t, r, r * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Height of a mark above a player's feet, in sprite units (just over his head). */
const OVER_HEAD = 15;

/** The whistle mark over a fouled player: sound arcs either side of a dot. */
export function drawWhistleMark(ctx: CanvasRenderingContext2D, project: ProjectFn, x: number, y: number, t: number): void {
  const p = project(x, y, 0);
  const sc = p.sc;
  const cy = p.y - OVER_HEAD * sc;
  ctx.save();
  ctx.globalAlpha = fade(t, 0.08, 0.3);
  ctx.fillStyle = canvasColor.text;
  ctx.beginPath();
  ctx.arc(p.x, cy, 0.9 * sc, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = canvasColor.text;
  ctx.lineWidth = Math.max(PX * 0.5, 0.5 * sc);
  for (const r of [2, 3.4]) {
    ctx.beginPath();
    ctx.arc(p.x, cy, r * sc, -0.6, 0.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.x, cy, r * sc, Math.PI - 0.6, Math.PI + 0.6);
    ctx.stroke();
  }
  ctx.restore();
}

/** A card held up over the offender: yellow (the card-yellow token) or red (the live token). */
export function drawCard(ctx: CanvasRenderingContext2D, project: ProjectFn, x: number, y: number, card: 'yellow' | 'red', t: number): void {
  const p = project(x, y, 0);
  const sc = p.sc;
  const pop = t < 0.1 ? 0.6 + 4 * t : 1;
  const w = 3.2 * sc * pop;
  const h = 4.4 * sc * pop;
  const cx = p.x;
  const top = p.y - (OVER_HEAD + 4) * sc;
  ctx.save();
  ctx.globalAlpha = fade(t, 0.05, 0.15);
  ctx.fillStyle = canvasColor.bg;
  ctx.fillRect(Math.round(cx - w / 2 - PX * 0.5), Math.round(top - PX * 0.5), Math.round(w + PX), Math.round(h + PX));
  ctx.fillStyle = card === 'red' ? canvasColor.cardRed : canvasColor.cardYellow;
  ctx.fillRect(Math.round(cx - w / 2), Math.round(top), Math.round(w), Math.round(h));
  ctx.restore();
}
