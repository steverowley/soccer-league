// ── features/match/ui/viewer/renderEvents.test.ts ───────────────────────────
// The event layer against a recording 2D context (like render.test.ts):
// what each mark is drawn with.  Guards the colour rules of
// docs/match-viewer.md section 5B (red only for a red card, the card-yellow
// token for a yellow, never the Architect's purple), the label style, and
// the new body poses and trail styles in render.ts.

import { describe, expect, it } from 'vitest';
import { canvasColor } from '../../../../shared/design';
import { STATIC_POSE, actionBody, makeAppearance, resolveKits, type Projected, type TrailKind } from '../../logic/viewer';
import { PIXEL_SCALE, TRAIL_STYLE, armAngles, drawBall, drawDude, type DudeRender, type ProjectFn } from './render';
import {
  LABEL_MIN_PX,
  LABEL_PX,
  drawCard,
  drawDust,
  drawNetRipple,
  drawOffsideMark,
  drawPitchLabel,
  drawSpotMarker,
  drawSubArrows,
  drawTargetMark,
  drawWhistleMark,
  drawWoodworkFlash,
  labelPxFor,
  labelTextWidth,
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
  letterSpacing = '0px';
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
  beginPath(): void {}
  closePath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  arcTo(): void {}
  roundRect(): void {}
}

function recorder(): { ctx: CanvasRenderingContext2D; ops: Op[]; r: Recorder } {
  const r = new Recorder();
  return { ctx: r as unknown as CanvasRenderingContext2D, ops: r.ops, r };
}

const project: ProjectFn = (wx, wy, wz): Projected => ({ x: wx * 6, y: wy * 6 - wz * 4, sc: 1.2 * PIXEL_SCALE });
const VP = { width: 640, height: 416 };
const kits = resolveKits('#556B2F', '#A9A9A9');

/** Every colour any op was drawn in. */
const colours = (ops: Op[]): Set<string> => new Set(ops.flatMap((o) => [o.fill, o.stroke]).filter(Boolean));

describe('cards', () => {
  it('a yellow card uses the card-yellow token, a red card the live/red token', () => {
    const y = recorder();
    drawCard(y.ctx, project, 50, 30, 'yellow', 0.5);
    expect(y.ops.some((o) => o.op === 'fillRect' && o.fill === canvasColor.cardYellow)).toBe(true);
    expect(colours(y.ops).has(canvasColor.cardRed)).toBe(false);
    const r = recorder();
    drawCard(r.ctx, project, 50, 30, 'red', 0.5);
    expect(r.ops.some((o) => o.op === 'fillRect' && o.fill === canvasColor.cardRed)).toBe(true);
    expect(colours(r.ops).has(canvasColor.cardYellow)).toBe(false);
  });

  it('the card tokens are the page tokens', () => {
    expect(canvasColor.cardYellow).toBe('#F5C518');
    expect(canvasColor.cardRed).toBe('#FF4F5E');
  });

  it('is held above the offender\'s head', () => {
    const { ctx, ops } = recorder();
    drawCard(ctx, project, 50, 30, 'yellow', 0.5);
    const card = ops.find((o) => o.op === 'fillRect' && o.fill === canvasColor.cardYellow)!;
    expect((card.args[1] as number) + (card.args[3] as number)).toBeLessThan(project(50, 30, 0).y - 12 * project(50, 30, 0).sc);
  });
});

describe('no red or purple outside a red card', () => {
  it('every other event mark avoids the red-card colour and the Architect purple', () => {
    const { ctx, ops } = recorder();
    drawSpotMarker(ctx, project, 105, 0);
    drawDust(ctx, project, 50, 30, 1, 0.3);
    drawWhistleMark(ctx, project, 50, 30, 0.4);
    drawNetRipple(ctx, project, 105, 0.3);
    drawWoodworkFlash(ctx, project, 105, 30, 2.4, 0.2);
    drawTargetMark(ctx, project, 80, 20, 0.5);
    drawOffsideMark(ctx, project, 80, 0.5);
    drawSubArrows(ctx, project, 0.5);
    drawPitchLabel(ctx, VP, 'CORNER');
    const used = colours(ops);
    expect(used.has(canvasColor.cardRed)).toBe(false);
    expect(used.has(canvasColor.architect)).toBe(false);
  });
});

describe('marks', () => {
  it('the restart spot is a phosphor ring on the grass', () => {
    const { ctx, ops } = recorder();
    drawSpotMarker(ctx, project, 105, 0);
    expect(ops.some((o) => o.op === 'stroke' && o.stroke === canvasColor.text)).toBe(true);
  });

  it('the through-ball target is in the ball colour', () => {
    const { ctx, ops } = recorder();
    drawTargetMark(ctx, project, 80, 20, 0.5);
    expect(ops.filter((o) => o.op === 'stroke').every((o) => o.stroke === canvasColor.ball)).toBe(true);
  });

  it('offside: a dashed line in the flag colour and a flag on the touchline', () => {
    const { ctx, ops } = recorder();
    drawOffsideMark(ctx, project, 80, 0.5);
    expect(ops.some((o) => o.op === 'setLineDash' && (o.args[0] as number[]).length > 0)).toBe(true);
    expect(ops.some((o) => o.op === 'fillRect' && o.fill === canvasColor.flag)).toBe(true);
  });

  it('substitution arrows: on in the success green, off in phosphor', () => {
    const { ctx, ops } = recorder();
    drawSubArrows(ctx, project, 0.5);
    const fills = ops.filter((o) => o.op === 'fill').map((o) => o.fill);
    expect(fills).toContain(canvasColor.subOn);
    expect(fills).toContain(canvasColor.text);
  });

  it('dust, ripple, flash and whistle draw in their tokens and fade out by t = 1', () => {
    const d = recorder();
    drawDust(d.ctx, project, 50, 30, 1, 0.5);
    expect(d.ops.some((o) => o.op === 'fill' && o.fill === canvasColor.dust)).toBe(true);
    const n = recorder();
    drawNetRipple(n.ctx, project, 0, 0.5);
    expect(n.ops.some((o) => o.op === 'stroke' && o.stroke === canvasColor.net)).toBe(true);
    const f = recorder();
    drawWoodworkFlash(f.ctx, project, 105, 30, 2.4, 1);
    expect(f.ops.filter((o) => o.op === 'stroke').every((o) => o.alpha === 0)).toBe(true);
    const w = recorder();
    drawWhistleMark(w.ctx, project, 50, 30, 0.5);
    expect(w.ops.some((o) => o.op === 'stroke' && o.stroke === canvasColor.text)).toBe(true);
  });
});

describe('drawPitchLabel', () => {
  it('draws the label style: Space Mono 700, tracked, phosphor on an abyss panel with a hairline', () => {
    const { ctx, ops, r } = recorder();
    drawPitchLabel(ctx, VP, 'FREE KICK');
    const text = ops.find((o) => o.op === 'fillText')!;
    expect(text.args[0]).toBe('FREE KICK');
    expect(text.fill).toBe(canvasColor.text);
    expect(ops[0]).toMatchObject({ op: 'fillRect', fill: canvasColor.labelPanel });
    expect(ops.some((o) => o.op === 'strokeRect')).toBe(true);
    // The recorder does not restore font or tracking, so they read as set.
    expect(r.font).toBe(`700 ${LABEL_PX}px "Space Mono", monospace`);
    expect(r.letterSpacing).toBe(`${LABEL_PX * 0.12}px`);
  });

  it('centres a top label and puts REPLAY in the corner', () => {
    const top = recorder();
    drawPitchLabel(top.ctx, VP, 'GOAL', 'top');
    const panel = top.ops[0]!.args as number[];
    expect(panel[0]! + panel[2]! / 2).toBeCloseTo(VP.width / 2, 0);
    const corner = recorder();
    drawPitchLabel(corner.ctx, VP, 'REPLAY', 'corner');
    expect((corner.ops[0]!.args as number[])[0]).toBeLessThan(20);
  });

  it('the panel fits the text (monospace width with tracking)', () => {
    expect(labelTextWidth('CORNER')).toBeCloseTo(6 * LABEL_PX * 0.72);
  });

  it('label size: the design label on a phone, not a banner on a desktop', () => {
    expect((labelPxFor(358, 640) * 358) / 640).toBeCloseTo(11.2, 0); // about 11 CSS px on a phone
    const desk = labelPxFor(928, 640);
    expect(desk).toBe(LABEL_MIN_PX);
    expect((desk * 928) / 640).toBeLessThan(18);
    expect(labelPxFor(0, 640)).toBe(LABEL_PX);
  });
});

describe('drawDude with an event animation', () => {
  const base: DudeRender = { wx: 50, wy: 30, pose: STATIC_POSE, appearance: makeAppearance('p1'), kit: kits.home.outfield, number: 7, face: 1 };

  it('a fall leans the whole body about the feet the way he faces', () => {
    const { ctx, ops } = recorder();
    drawDude(ctx, project, { ...base, face: -1, act: actionBody({ kind: 'fall', t: 0.5, contact: 0 }) });
    const rot = ops.find((o) => o.op === 'rotate');
    expect(rot).toBeDefined();
    expect(rot!.args[0] as number).toBeLessThan(-1.3);
  });

  it('no animation, no rotation (the gait-only figure is unchanged)', () => {
    const { ctx, ops } = recorder();
    drawDude(ctx, project, base);
    expect(ops.some((o) => o.op === 'rotate')).toBe(false);
  });

  it('a kick swings the front leg forward of where it stands', () => {
    const legX = (d: DudeRender): number[] => {
      const { ctx, ops } = recorder();
      drawDude(ctx, project, d);
      return ops.filter((o) => o.op === 'fillRect' && o.fill === d.kit.shorts).map((o) => o.args[0] as number);
    };
    const rest = legX(base);
    const kick = legX({ ...base, act: actionBody({ kind: 'kick', t: 0.45, contact: 0.3 }) });
    expect(Math.max(...kick)).toBeGreaterThan(Math.max(...rest));
  });

  it('arm presets: up is above the shoulders, out is level, rest hangs down', () => {
    const [ur, ul] = armAngles('up', 1);
    expect(Math.sin(ur)).toBeLessThan(-0.8);
    expect(Math.sin(ul)).toBeLessThan(-0.8);
    const [or] = armAngles('out', 1);
    expect(Math.abs(Math.sin(or))).toBeLessThan(0.3);
    expect(Math.sin(armAngles('rest', 1)[0])).toBeGreaterThan(0.9);
    expect(Math.cos(armAngles('forward', -1)[0])).toBeLessThan(0);
  });

  it('a celebration lifts the body off the grass (arms up, hop)', () => {
    const feetTop = (d: DudeRender): number => {
      const { ctx, ops } = recorder();
      drawDude(ctx, project, d);
      return Math.min(...ops.filter((o) => o.op === 'fillRect' && o.fill === d.kit.shorts).map((o) => o.args[1] as number));
    };
    expect(feetTop({ ...base, act: actionBody({ kind: 'celebrate', t: 1 / 6, contact: 0 }) })).toBeLessThan(feetTop(base));
  });
});

describe('drawBall trail styles and a held ball', () => {
  const trail = [
    { x: 40, y: 30, z: 0 },
    { x: 44, y: 30, z: 0.5 },
    { x: 48, y: 30, z: 0.8 },
  ];
  it('styles the trail by the kick kind; a shot is wider, white and glows', () => {
    const strokes = (trailKind: TrailKind | null) => {
      const { ctx, ops } = recorder();
      drawBall(ctx, project, { wx: 50, wy: 30, wz: 1, trail, trailKind });
      return ops.filter((o) => o.op === 'stroke');
    };
    expect(strokes('cross').every((o) => o.stroke === canvasColor.trailCross)).toBe(true);
    expect(strokes('long').every((o) => o.stroke === canvasColor.trailLong)).toBe(true);
    expect(strokes('clear').every((o) => o.stroke === canvasColor.trailClear)).toBe(true);
    expect(strokes('shot').every((o) => o.stroke === canvasColor.trailShot)).toBe(true);
    expect(strokes(null).every((o) => o.stroke === canvasColor.ball)).toBe(true);
    expect(TRAIL_STYLE.shot.width).toBeGreaterThan(TRAIL_STYLE.pass.width);
    expect(TRAIL_STYLE.shot.glow).toBe(true);
  });

  it('a held ball sits on the holder\'s sprite, above his feet', () => {
    const { ctx, ops } = recorder();
    drawBall(ctx, project, { wx: 50, wy: 30, wz: 0, heldLift: 14 });
    const ball = ops.filter((o) => o.op === 'arc' && o.fill === canvasColor.ball)[0]!;
    const ground = project(50, 30, 0);
    expect(ball.args[1] as number).toBeCloseTo(ground.y - 14 * ground.sc);
  });
});
