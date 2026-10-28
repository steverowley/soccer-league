// ── features/match/ui/viewer/render.test.ts ─────────────────────────────────
// The renderer against a recording 2D context: what colours each part is
// drawn in.  Guards the section 3 rule (no figure reads as a referee: the
// keeper is drawn in his kit, never as a dark hollow figure), the ball's own
// colour and size, the carrier ring, and the focus halo and dimming.

import { describe, expect, it } from 'vitest';
import { canvasColor } from '../../../../shared/design';
import { STATIC_POSE, makeAppearance, resolveKits, type Kit, type Projected } from '../../logic/viewer';
import { BALL_RADIUS, PIXEL_SCALE, drawBall, drawDude, type DudeRender, type ProjectFn } from './render';

/** One recorded drawing operation with the context state it ran under. */
interface Op {
  op: string;
  fill: string;
  stroke: string;
  alpha: number;
  args: number[];
}

/**
 * A minimal 2D context that records fills, strokes and shapes with the
 * colours and alpha in force when each was drawn.
 */
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
  imageSmoothingEnabled = true;
  readonly ops: Op[] = [];
  private readonly stack: Array<{ fillStyle: string; strokeStyle: string; globalAlpha: number }> = [];
  private rec(op: string, args: number[] = []): void {
    this.ops.push({ op, fill: this.fillStyle, stroke: this.strokeStyle, alpha: this.globalAlpha, args });
  }
  save(): void {
    this.stack.push({ fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, globalAlpha: this.globalAlpha });
  }
  restore(): void {
    Object.assign(this, this.stack.pop());
  }
  fillRect(...a: number[]): void { this.rec('fillRect', a); }
  fill(): void { this.rec('fill'); }
  stroke(): void { this.rec('stroke'); }
  arc(...a: number[]): void { this.rec('arc', a); }
  ellipse(...a: number[]): void { this.rec('ellipse', a); }
  fillText(): void { this.rec('fillText'); }
  beginPath(): void {}
  closePath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  arcTo(): void {}
  roundRect(): void {}
  translate(): void {}
  rotate(): void {}
}

function recorder(): { ctx: CanvasRenderingContext2D; ops: Op[] } {
  const r = new Recorder();
  return { ctx: r as unknown as CanvasRenderingContext2D, ops: r.ops };
}

/** A flat projection at the broadcast far-touchline scale, times PIXEL_SCALE. */
const project: ProjectFn = (wx, wy, wz): Projected => ({ x: wx * 6, y: wy * 6 - wz * 4, sc: 0.9 * PIXEL_SCALE });

function dude(kit: Kit, extra: Partial<DudeRender> = {}): DudeRender {
  return { wx: 50, wy: 30, pose: STATIC_POSE, appearance: makeAppearance('p1'), kit, number: 1, face: 1, ...extra };
}

const kits = resolveKits('#556B2F', '#A9A9A9');

describe('drawDude', () => {
  it('draws a keeper in his keeper kit (shirt, shorts, sleeves), not as a hollow abyss figure', () => {
    const { ctx, ops } = recorder();
    drawDude(ctx, project, dude(kits.home.keeper));
    const k = kits.home.keeper;
    // The torso and shorts are filled boxes in the keeper colour...
    const kitFills = ops.filter((o) => o.op === 'fillRect' && o.fill === k.shirt);
    expect(kitFills.length).toBeGreaterThanOrEqual(3);
    // ...his sleeves are stroked in it...
    expect(ops.some((o) => o.op === 'stroke' && o.stroke === k.sleeves)).toBe(true);
    // ...and no abyss box covers his torso (the old keeper was an abyss torso
    // in a phosphor outline: the referee in black).
    const area = (o: Op) => (o.args[2] ?? 0) * (o.args[3] ?? 0);
    const torso = kitFills.reduce((a, b) => (area(b) > area(a) ? b : a));
    const [tx, ty, tw, th] = torso.args as [number, number, number, number];
    const cx = tx + tw / 2;
    const cy = ty + th / 2;
    const covering = ops.filter(
      (o) => o.op === 'fillRect' && o.fill === canvasColor.bg && o.args[0]! <= cx && cx <= o.args[0]! + o.args[2]! && o.args[1]! <= cy && cy <= o.args[1]! + o.args[3]!,
    );
    expect(covering).toHaveLength(0);
  });

  it('puts a ground marker in the team colour under every player, keeper included', () => {
    for (const kit of [kits.home.outfield, kits.home.keeper]) {
      const { ctx, ops } = recorder();
      drawDude(ctx, project, dude(kit));
      expect(ops.some((o) => o.op === 'ellipse' && o.fill === kits.home.outfield.marker)).toBe(true);
    }
  });

  it('rings the carrier in his team colour', () => {
    const { ctx, ops } = recorder();
    drawDude(ctx, project, dude(kits.away.outfield, { carrier: true }));
    expect(ops.some((o) => o.op === 'stroke' && o.stroke === kits.away.outfield.marker)).toBe(true);
    const plain = recorder();
    drawDude(plain.ctx, project, dude(kits.away.outfield));
    expect(plain.ops.some((o) => o.op === 'stroke' && o.stroke === kits.away.outfield.marker)).toBe(false);
  });

  it('keeps the Architect halo on the selected player and dims the others', () => {
    const sel = recorder();
    drawDude(sel.ctx, project, dude(kits.home.outfield, { highlighted: true }));
    expect(sel.ops.some((o) => o.op === 'stroke' && o.stroke === canvasColor.architect)).toBe(true);
    const dim = recorder();
    drawDude(dim.ctx, project, dude(kits.home.outfield, { dimmed: true }));
    expect(dim.ops.filter((o) => o.op === 'fillRect').every((o) => o.alpha < 0.5)).toBe(true);
  });
});

describe('drawBall', () => {
  it('draws the ball in its own colour over a dark outline, big enough on a phone', () => {
    const { ctx, ops } = recorder();
    drawBall(ctx, project, { wx: 50, wy: 30, wz: 0 });
    const arcs = ops.filter((o) => o.op === 'fill');
    expect(arcs.some((o) => o.fill === canvasColor.ball)).toBe(true);
    expect(arcs.some((o) => o.fill === canvasColor.bg)).toBe(true);
    // Diameter in CSS px on a 356 px wide phone viewer (640 backing px), at
    // the smallest broadcast scale: at least 4.
    const r = BALL_RADIUS * 0.9 * PIXEL_SCALE;
    expect((2 * r * 356) / 640).toBeGreaterThanOrEqual(4);
    const radii = ops.filter((o) => o.op === 'arc').map((o) => o.args[2]!);
    expect(Math.max(...radii)).toBeGreaterThan(r);
  });

  it('lifts the ball off its shadow as it rises, and draws a trail only when given one', () => {
    const ground = recorder();
    drawBall(ground.ctx, project, { wx: 50, wy: 30, wz: 0 });
    const high = recorder();
    drawBall(high.ctx, project, { wx: 50, wy: 30, wz: 3, trail: [{ x: 40, y: 30, z: 2 }, { x: 45, y: 30, z: 2.5 }] });
    const ballY = (ops: Op[]) => ops.filter((o) => o.op === 'arc').map((o) => o.args[1]!)[0]!;
    const shadowY = (ops: Op[]) => ops.find((o) => o.op === 'ellipse')!.args[1]!;
    expect(shadowY(high.ops) - ballY(high.ops)).toBeGreaterThan(shadowY(ground.ops) - ballY(ground.ops) + 5);
    expect(ground.ops.some((o) => o.op === 'stroke')).toBe(false);
    expect(high.ops.filter((o) => o.op === 'stroke' && o.stroke === canvasColor.ball).length).toBeGreaterThan(1);
  });
});
