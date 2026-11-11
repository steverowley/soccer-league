// ── features/match/ui/viewer/renderEvents.test.ts ───────────────────────────
// The few event marks left on the pitch (docs/match-viewer.md section 7)
// against a recording 2D context (like render.test.ts): hairline Lunar Dust
// for the spot, the ring and the frame flare; the card colour only on the
// card glyph, which sits beside the offender's head and off other players;
// plus the event poses and the plain ball trail in render.ts.

import { describe, expect, it } from 'vitest';
import { canvasColor } from '../../../../shared/design';
import { actionBody, makeAppearance, newArms, resolveKits, type Projected } from '../../logic/viewer';
import { PIXEL_SCALE, drawBall, drawDude, type DudeRender, type ProjectFn } from './render';
import {
  EVENT_RING_RX,
  cardGlyphRect,
  drawCardGlyph,
  drawEventRing,
  drawGoalFlare,
  drawSpotMarker,
  figureBox,
  overlapArea,
  type FigureAt,
} from './renderEvents';

/** One recorded drawing operation with the context state it ran under. */
interface Op {
  op: string;
  fill: string;
  stroke: string;
  alpha: number;
  args: unknown[];
}

/** A minimal 2D context that records what is drawn and in which colours. */
class Recorder {
  fillStyle = '';
  strokeStyle = '';
  globalAlpha = 1;
  lineWidth = 1;
  lineCap = 'butt';
  lineJoin = 'miter';
  shadowColor = '';
  shadowBlur = 0;
  font = '';
  textAlign = 'start';
  textBaseline = 'alphabetic';
  readonly ops: Op[] = [];
  private readonly stack: Array<Record<string, unknown>> = [];
  private rec(op: string, args: unknown[] = []): void {
    this.ops.push({ op, fill: this.fillStyle, stroke: this.strokeStyle, alpha: this.globalAlpha, args });
  }
  save(): void {
    this.stack.push({ fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, globalAlpha: this.globalAlpha, shadowColor: this.shadowColor, shadowBlur: this.shadowBlur });
  }
  restore(): void { Object.assign(this, this.stack.pop()); }
  fillRect(...a: number[]): void { this.rec('fillRect', a); }
  strokeRect(...a: number[]): void { this.rec('strokeRect', a); }
  fill(): void { this.rec('fill'); }
  stroke(): void { this.rec('stroke'); }
  arc(...a: number[]): void { this.rec('arc', a); }
  ellipse(...a: number[]): void { this.rec('ellipse', a); }
  fillText(...a: unknown[]): void { this.rec('fillText', a); }
  rotate(...a: number[]): void { this.rec('rotate', a); }
  translate(...a: number[]): void { this.rec('translate', a); }
  setLineDash(...a: unknown[]): void { this.rec('setLineDash', a); }
  rect(...a: number[]): void { this.rec('rect', a); }
  clip(): void { this.rec('clip'); }
  beginPath(): void {}
  closePath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  arcTo(): void {}
  roundRect(): void {}
}

function recorder(): { ctx: CanvasRenderingContext2D; ops: Op[] } {
  const r = new Recorder();
  return { ctx: r as unknown as CanvasRenderingContext2D, ops: r.ops };
}

const project: ProjectFn = (wx, wy, wz): Projected => ({ x: wx * 6, y: wy * 6 - wz * 4, sc: 1.2 * PIXEL_SCALE });
const kits = resolveKits('#556B2F', '#A9A9A9');

/** Every colour any op was drawn in. */
const colours = (ops: Op[]): Set<string> => new Set(ops.flatMap((o) => [o.fill, o.stroke]).filter(Boolean));

describe('the marks left on the pitch are hairline Lunar Dust', () => {
  it('the restart spot is a Lunar Dust ring on the grass', () => {
    const { ctx, ops } = recorder();
    drawSpotMarker(ctx, project, 105, 0);
    expect(ops.some((o) => o.op === 'stroke' && o.stroke === canvasColor.text)).toBe(true);
  });

  it('the event ring: Lunar Dust pixels round his feet, fading to nothing over its window', () => {
    const at = (t: number, still = false) => {
      const { ctx, ops } = recorder();
      drawEventRing(ctx, project, 50, 30, t, still);
      return ops.filter((o) => o.op === 'fillRect');
    };
    const ring = at(0);
    expect(ring.length).toBeGreaterThan(8);
    expect(ring.every((o) => o.fill === canvasColor.text)).toBe(true);
    // On the grass, round the feet: never above them by more than its own half-height (so never over a face).
    const feet = project(50, 30, 0);
    const as = feet.sc / PIXEL_SCALE;
    for (const o of ring) {
      const [x, y] = o.args as number[];
      expect(y!).toBeGreaterThan(feet.y - 4 * as * PIXEL_SCALE);
      expect(Math.abs(x! - feet.x)).toBeLessThanOrEqual((EVENT_RING_RX * as + 1) * PIXEL_SCALE);
    }
    expect(at(0.5)[0]!.alpha).toBeLessThan(ring[0]!.alpha);
    expect(at(1).every((o) => o.alpha === 0)).toBe(true);
    // Reduced motion: still, whole for its window.
    expect(at(0.9, true)[0]!.alpha).toBe(ring[0]!.alpha);
  });

  it('the ring splits at his feet into a far half (behind the figures) and a near half (in front)', () => {
    const half = (part: 'back' | 'front') => {
      const { ctx, ops } = recorder();
      drawEventRing(ctx, project, 50, 30, 0, false, part);
      return ops;
    };
    const feetY = project(50, 30, 0).y;
    const clipOf = (ops: Op[]) => ops.find((o) => o.op === 'rect')!.args as number[];
    const back = clipOf(half('back'));
    const front = clipOf(half('front'));
    expect(back[1]! + back[3]!).toBeCloseTo(feetY, 0); // the far half ends at his feet
    expect(front[1]).toBeCloseTo(feetY, 0); // the near half starts there
    expect(half('back').some((o) => o.op === 'clip')).toBe(true);
  });

  it('the goal frame flare redraws the frame in full Lunar Dust and fades back', () => {
    const { ctx, ops } = recorder();
    drawGoalFlare(ctx, project, 105, 0);
    const rects = ops.filter((o) => o.op === 'fillRect');
    expect(rects.length).toBeGreaterThanOrEqual(3);
    expect(rects.every((o) => o.fill === canvasColor.text && o.alpha === 1)).toBe(true);
    // Only the right-hand goal: every pixel sits near x = 105 m.
    expect(rects.every((o) => (o.args[0] as number) > 100 * 6 - 20)).toBe(true);
    const late = recorder();
    drawGoalFlare(late.ctx, project, 105, 1);
    expect(late.ops.filter((o) => o.op === 'fillRect').every((o) => o.alpha === 0)).toBe(true);
  });

  it('no red, purple or new hue outside the card glyph', () => {
    const { ctx, ops } = recorder();
    drawSpotMarker(ctx, project, 105, 0);
    drawEventRing(ctx, project, 50, 30, 0.2);
    drawGoalFlare(ctx, project, 0, 0.2);
    expect([...colours(ops)]).toEqual([canvasColor.text]);
  });
});

describe('the card glyph', () => {
  const him: FigureAt = { x: 160, y: 100, as: 1.2 };

  it('is a card in the card-yellow token or the live red, edged in Abyss', () => {
    const rect = cardGlyphRect(him, []);
    const y = recorder();
    drawCardGlyph(y.ctx, rect, 'yellow', 0.5);
    expect(y.ops.map((o) => o.fill)).toEqual([canvasColor.bg, canvasColor.cardYellow]);
    const r = recorder();
    drawCardGlyph(r.ctx, rect, 'red', 0.5);
    expect(r.ops.map((o) => o.fill)).toEqual([canvasColor.bg, canvasColor.cardRed]);
    expect(canvasColor.cardYellow).toBe('#F5C518');
    expect(canvasColor.cardRed).toBe('#FF4F5E');
  });

  it('sits beside his head, never over it', () => {
    const rect = cardGlyphRect(him, []);
    const head = { x: him.x - 3 * him.as, y: him.y - 14 * him.as, w: 6 * him.as, h: 7 * him.as };
    expect(overlapArea(rect, head)).toBe(0);
    expect(rect.y + rect.h).toBeLessThan(him.y - 4 * him.as); // up at head height, not at his feet
    expect(rect.w).toBeLessThanOrEqual(6); // a few art pixels
  });

  it('moves to the side where it covers no other player', () => {
    const right = cardGlyphRect(him, []);
    expect(right.x).toBeGreaterThan(him.x);
    const neighbour: FigureAt = { x: him.x + 9 * him.as, y: him.y, as: him.as };
    const moved = cardGlyphRect(him, [neighbour]);
    expect(moved.x).toBeLessThan(him.x);
    expect(overlapArea(moved, figureBox(neighbour))).toBe(0);
  });
});

describe('drawDude with an event animation', () => {
  const base: DudeRender = { wx: 50, wy: 30, phase: 0, run: 0, appearance: makeAppearance('p1'), kit: kits.home.outfield, face: 1 };
  /** Bounding box of the figure's own pixels (not its marker or shadow). */
  const box = (d: DudeRender) => {
    const { ctx, ops } = recorder();
    drawDude(ctx, project, d);
    const rects = ops.filter((o) => o.op === 'fillRect' && o.fill !== d.kit.marker && o.fill !== canvasColor.shadow).map((o) => o.args as number[]);
    return {
      x0: Math.min(...rects.map((r) => r[0]!)),
      x1: Math.max(...rects.map((r) => r[0]! + r[2]!)),
      y0: Math.min(...rects.map((r) => r[1]!)),
      y1: Math.max(...rects.map((r) => r[1]! + r[3]!)),
      feet: ops.filter((o) => o.op === 'fillRect' && o.fill === canvasColor.figureMid).map((o) => o.args[0] as number),
    };
  };

  it('a fall lays him on the grass: wider than tall, his feet still on the ground', () => {
    const stand = box(base);
    const down = box({ ...base, act: actionBody({ kind: 'fall', t: 0.5, contact: 0 }) });
    expect(stand.y1 - stand.y0).toBeGreaterThan(stand.x1 - stand.x0);
    expect(down.x1 - down.x0).toBeGreaterThan(down.y1 - down.y0);
    expect(down.y1).toBeLessThanOrEqual(stand.y1 + PIXEL_SCALE);
  });

  it('a slide goes feet first along the grass, and a dive lays the keeper out', () => {
    const slide = box({ ...base, act: actionBody({ kind: 'slide', t: 0.5, contact: 0.18 }) });
    expect(slide.y1 - slide.y0).toBeLessThan(box(base).y1 - box(base).y0);
    const dive = box({ ...base, kit: kits.home.keeper, act: actionBody({ kind: 'dive', t: 0.6, contact: 0, toZ: 0 }) });
    expect(dive.x1 - dive.x0).toBeGreaterThan(dive.y1 - dive.y0);
  });

  it('a kick swings the kicking foot forward of where it stands', () => {
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const rest = box(base).feet;
    const through = box({ ...base, act: actionBody({ kind: 'kick', t: 0.51, contact: 0.3 }) }).feet;
    const back = box({ ...base, act: actionBody({ kind: 'kick', t: 0.2, contact: 0.3 }) }).feet;
    expect(mean(through)).toBeGreaterThan(mean(rest));
    expect(mean(back)).toBeLessThan(mean(rest));
  });

  it('the spring arms decide where the hands are: arms out make him wider', () => {
    const arms = newArms(0.2);
    arms.back.a = Math.PI / 2;
    arms.front.a = Math.PI / 2;
    arms.back.b = 0;
    arms.front.b = 0;
    const out = box({ ...base, arms });
    const rest = box(base);
    expect(out.x1 - out.x0).toBeGreaterThan(rest.x1 - rest.x0 + 2 * PIXEL_SCALE);
  });

  it('a celebration keeps his feet on the grass (no hop)', () => {
    for (const t of [1 / 6, 0.5]) {
      expect(box({ ...base, act: actionBody({ kind: 'celebrate', t, contact: 0 }) }).y1).toBe(box(base).y1);
    }
  });
});

describe('drawBall: the plain trail and a held ball', () => {
  it('the trail is the ball\'s own colour, no glow, whatever the kick', () => {
    const { ctx, ops, } = recorder();
    const trail = [
      { x: 40, y: 30, z: 0 },
      { x: 44, y: 30, z: 0.5 },
      { x: 48, y: 30, z: 0.8 },
    ];
    drawBall(ctx, project, { wx: 50, wy: 30, wz: 1, trail });
    const strokes = ops.filter((o) => o.op === 'stroke');
    expect(strokes.length).toBe(3);
    expect(strokes.every((o) => o.stroke === canvasColor.ball)).toBe(true);
  });

  it('a held ball sits on the holder\'s sprite, above his feet', () => {
    const { ctx, ops } = recorder();
    drawBall(ctx, project, { wx: 50, wy: 30, wz: 0, heldLift: 14 });
    const ball = ops.filter((o) => o.op === 'arc' && o.fill === canvasColor.ball)[0]!;
    const ground = project(50, 30, 0);
    expect(ball.args[1] as number).toBeCloseTo(ground.y - 14 * ground.sc);
  });
});
