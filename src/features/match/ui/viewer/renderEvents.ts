// ── features/match/ui/viewer/renderEvents.ts ────────────────────────────────
// Canvas drawing for the few event marks left on the pitch
// (docs/match-viewer.md section 7): the restart spot, a hairline ring round
// the player at the centre of a tackle, foul or save, a small card glyph
// beside the offender, and the goal frame flaring after a goal or a shot off
// the woodwork.  Everything else an event says is WORDS, and words belong in
// the event strip under the pitch (EventStrip.tsx), not on it.
//
// Like render.ts, every function takes the context and the active camera's
// `project` closure and knows nothing about React or timing: the WHEN lives
// in logic/viewer/actionAnim.ts (each mark arrives with its progress `t`,
// 0..1 through its real-time window).
//
// BRAND: hairline Lunar Dust on the Abyss pitch, emphasis by brightness, no
// new hues.  The one colour is the card glyph's (the card-yellow token, or
// the live red for a red card), because there it means something.

import { canvasColor } from '../../../../shared/design';
import { GOALS } from '../../logic/viewer';
import { PITCH_LENGTH } from '../../logic/spatial/types';
import { pixelRing, px, resetFill, setGrid } from './figure';
import { PIXEL_SCALE, drawGoalFrame, drawGoalNet, type ProjectFn } from './render';

const PX = PIXEL_SCALE;

// ── The restart spot ─────────────────────────────────────────────────────────

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

// ── The ring round a player ──────────────────────────────────────────────────

/**
 * Ring half-axes in art pixels per unit of art-space depth scale: well
 * outside the carrier ring (5.3 x 2.15, render.ts), so it never hides it and
 * reaches past a crowd of figures, and on the grass round his feet, so it
 * never crosses his face.
 */
export const EVENT_RING_RX = 9;
export const EVENT_RING_RY = 3.6;
/** The ring's opacity when it appears (it fades to nothing over its window). */
const RING_ALPHA = 0.9;

/**
 * Which part of the ring to draw.  It lies on the grass, so its far half
 * goes behind the figures standing in it and its near half in front of
 * them (the caller draws the near half in depth order, before the figures
 * nearer the camera): in a crowd at a foul the ring stays visible without
 * ever being drawn over a face.
 */
export type RingPart = 'back' | 'front' | 'whole';

/**
 * A hairline Lunar Dust ring on the grass round a player's feet, so the eye
 * finds the tackle, foul or save the strip has just named.
 *
 * @param x      His drawn position (metres), across.
 * @param y      His drawn position (metres), along.
 * @param t      Progress 0..1 through the ring's real-time window.
 * @param still  Reduced motion: no fade, the ring shows whole for its window.
 * @param part   The far half, the near half, or both.
 */
export function drawEventRing(
  ctx: CanvasRenderingContext2D,
  project: ProjectFn,
  x: number,
  y: number,
  t: number,
  still = false,
  part: RingPart = 'whole',
): void {
  const p = project(x, y, 0);
  const as = p.sc / PX;
  const cx = p.x / PX;
  const cy = p.y / PX;
  const rx = EVENT_RING_RX * as;
  const ry = EVENT_RING_RY * as;
  ctx.save();
  ctx.globalAlpha *= RING_ALPHA * (still ? 1 : 1 - Math.min(1, Math.max(0, t)));
  if (part !== 'whole') {
    // Keep the rows above (back) or from (front) his feet's row.
    const split = Math.round(cy) * PX;
    const left = (cx - rx - 2) * PX;
    const width = (2 * rx + 4) * PX;
    const top = (cy - ry - 2) * PX;
    const bottom = (cy + ry + 2) * PX;
    ctx.beginPath();
    if (part === 'back') ctx.rect(left, top, width, split - top);
    else ctx.rect(left, split, width, bottom - split);
    ctx.clip();
  }
  resetFill();
  setGrid(PX);
  pixelRing(ctx, cx, cy, rx, ry, canvasColor.text);
  resetFill();
  ctx.restore();
}

// ── The card glyph beside the offender ───────────────────────────────────────

/** A figure on screen, in art pixels: his feet and his art-space depth scale. */
export interface FigureAt {
  x: number;
  y: number;
  as: number;
}

/** A rectangle in art pixels. */
export interface ArtRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Half-width and height of a standing figure's box, in art pixels per unit of depth scale (arms at rest included). */
const FIGURE_HALF_W = 4.5;
const FIGURE_H = 14;
/** The glyph's inner edge sits this far from his centre (clear of his head and resting arms). */
const GLYPH_OFFSET = 5.5;
/** Its top sits this far above his feet (beside his head). */
const GLYPH_TOP = 12;

/** The box a standing figure takes, in art pixels. */
export function figureBox(f: FigureAt): ArtRect {
  return { x: f.x - FIGURE_HALF_W * f.as, y: f.y - FIGURE_H * f.as, w: 2 * FIGURE_HALF_W * f.as, h: FIGURE_H * f.as };
}

/** Area two rectangles share. */
export function overlapArea(a: ArtRect, b: ArtRect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Where the card glyph goes: a few art pixels beside the offender's head,
 * on the side where it covers no other player (the right first, else the
 * left, else whichever covers less).  Never over his own head.
 *
 * @param him     The offender.
 * @param others  Every other figure on screen.
 * @returns       The glyph's rectangle in art pixels (outline included).
 */
export function cardGlyphRect(him: FigureAt, others: readonly FigureAt[]): ArtRect {
  const w = Math.max(2, Math.round(1.5 * him.as));
  const h = Math.round(w * 1.4) + 1;
  const top = Math.round(him.y - GLYPH_TOP * him.as);
  const right: ArtRect = { x: Math.round(him.x + GLYPH_OFFSET * him.as), y: top, w: w + 2, h: h + 2 };
  const left: ArtRect = { x: Math.round(him.x - GLYPH_OFFSET * him.as) - (w + 2), y: top, w: w + 2, h: h + 2 };
  const cost = (r: ArtRect): number => others.reduce((sum, o) => sum + overlapArea(r, figureBox(o)), 0);
  const cr = cost(right);
  if (cr === 0) return right;
  const cl = cost(left);
  return cl < cr ? left : right;
}

/**
 * The card glyph: a small card in its card colour (the card-yellow token,
 * or the live red), edged in Abyss so it reads on any kit.
 *
 * @param rect   From cardGlyphRect (art pixels, outline included).
 * @param t      Progress 0..1 through its window (it fades in and out briefly).
 * @param still  Reduced motion: no fade.
 */
export function drawCardGlyph(ctx: CanvasRenderingContext2D, rect: ArtRect, card: 'yellow' | 'red', t: number, still = false): void {
  ctx.save();
  if (!still) ctx.globalAlpha *= t < 0.06 ? t / 0.06 : t > 0.9 ? Math.max(0, (1 - t) / 0.1) : 1;
  resetFill();
  setGrid(PX);
  px(ctx, rect.x, rect.y, rect.w, rect.h, canvasColor.bg);
  px(ctx, rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2, card === 'red' ? canvasColor.cardRed : canvasColor.cardYellow);
  resetFill();
  ctx.restore();
}

// ── The goal frame flare ─────────────────────────────────────────────────────

/**
 * The goal on line `goalX` lit up: its frame drawn in full Lunar Dust over
 * its usual `goalLine`, with the back of the net, fading back over the
 * flare's window.  Emphasis by brightness, hairlines only, after a goal and
 * when a shot strikes the frame.
 *
 * @param t      Progress 0..1 through the flare's real-time window.
 * @param still  Reduced motion: no fade, the frame is bright for the window.
 */
export function drawGoalFlare(ctx: CanvasRenderingContext2D, project: ProjectFn, goalX: number, t: number, still = false): void {
  const goal = GOALS.find((g) => Math.abs(g.x - goalX) < 1) ?? GOALS[goalX < PITCH_LENGTH / 2 ? 0 : 1];
  if (!goal) return;
  ctx.save();
  ctx.globalAlpha *= still ? 1 : 1 - Math.min(1, Math.max(0, t)) ** 2;
  resetFill();
  setGrid(PX);
  drawGoalFrame(ctx, project, goal, canvasColor.text);
  drawGoalNet(ctx, project, goal, canvasColor.text);
  resetFill();
  ctx.restore();
}
