// ── playback.v3.test.ts ─────────────────────────────────────────────────────
// sampleFrames on v3 frames (docs/match-viewer.md, section 2B): players on a
// monotone cubic Hermite through 0.5 s frames (curved, never overshooting a
// frame, broken at a jump), the ball from its keyframes with the engine's
// physics, and v2 frames untouched (linear, ball height 0).

import { describe, it, expect } from 'vitest';

import type { PositionSnapshot } from '../../api/matchPositions';
import type { BallTrack } from '../replay/ballTrack';
import { stepBall, type BallBody } from '../spatial/ball';
import { vec } from '../spatial/vec2';
import { sampleFrames, frameGameSeconds } from './playback';

/** A ball at rest at the centre spot for the whole clip. */
const REST: BallTrack = {
  dtSec: 0.1,
  endTick: 1000,
  keys: [{ tick: 0, x: 52.5, y: 34, z: 0, vx: 0, vy: 0, vz: 0, ownerId: null }],
};

/** v3 frames for one player "p" at the given x positions, 0.5 s apart. */
function v3(xs: number[], ball: BallTrack = REST): PositionSnapshot[] {
  return xs.map((x, i) => ({
    minute: 1,
    second: Math.floor(i * 0.5),
    tSec: i * 0.5,
    ballTrack: ball,
    snapshots: { players: [{ id: 'p', x, y: 10, hasBall: false }], ball: { x: 52.5, y: 34, ownerId: null } },
  }));
}

describe('sampleFrames on v3 frames: players', () => {
  it('uses the exact frame time, not whole seconds', () => {
    expect(frameGameSeconds(v3([0, 1])[1]!)).toBe(0.5);
  });

  it('passes through every frame exactly', () => {
    const frames = v3([10, 12, 15, 19, 24]);
    frames.forEach((f, i) => expect(sampleFrames(frames, i * 0.5).players.get('p')!.x).toBeCloseTo(f.snapshots.players[0]!.x, 9));
  });

  it('curves through a steady acceleration instead of a polyline', () => {
    // x = t^2: a straight line between frames would sit above the curve.
    const xs = [0, 1, 2, 3, 4, 5].map((i) => (i * 0.5) ** 2 * 4);
    const frames = v3(xs);
    const mid = sampleFrames(frames, 1.25).players.get('p')!.x; // between 4 and 9
    const linear = (xs[2]! + xs[3]!) / 2;
    expect(mid).toBeLessThan(linear);
    expect(mid).toBeGreaterThan(xs[2]!);
  });

  it('never overshoots a player who stops dead (no swing past his mark)', () => {
    const frames = v3([0, 4, 8, 8, 8, 8]);
    for (let t = 0; t <= 2.5; t += 0.01) {
      const x = sampleFrames(frames, t).players.get('p')!.x;
      expect(x).toBeGreaterThanOrEqual(-1e-9);
      expect(x).toBeLessThanOrEqual(8 + 1e-9);
    }
  });

  it('never overshoots a turn (stays between the frames either side)', () => {
    const frames = v3([0, 3, 6, 4, 2]);
    for (let t = 1; t <= 1.5; t += 0.01) {
      const x = sampleFrames(frames, t).players.get('p')!.x;
      expect(x).toBeLessThanOrEqual(6 + 1e-9);
      expect(x).toBeGreaterThanOrEqual(4 - 1e-9);
    }
  });

  it('is continuous in velocity across a frame', () => {
    const frames = v3([0, 2, 5, 9, 14, 20]);
    const a = sampleFrames(frames, 1 - 1e-6).players.get('p')!.vx;
    const b = sampleFrames(frames, 1 + 1e-6).players.get('p')!.vx;
    expect(Math.abs(a - b)).toBeLessThan(1e-3);
  });

  it('breaks the spline at a jump no runner could make: holds, then appears there', () => {
    // A sent-off man parked on the touchline: 30 m in half a second.
    const frames = v3([20, 21, 22, 52, 52]);
    const before = sampleFrames(frames, 1.4).players.get('p')!;
    expect(before.x).toBe(22);
    expect(before.vx).toBe(0);
    expect(sampleFrames(frames, 1.5).players.get('p')!.x).toBe(52);
    // And the jump does not bend the segment before it.
    for (let t = 0.5; t <= 1; t += 0.05) {
      const x = sampleFrames(frames, t).players.get('p')!.x;
      expect(x).toBeGreaterThanOrEqual(21 - 1e-9);
      expect(x).toBeLessThanOrEqual(22 + 1e-9);
    }
  });

  it('names the player in possession from the ball track', () => {
    const owned: BallTrack = { ...REST, keys: [{ ...REST.keys[0]!, ownerId: 'p' }] };
    const out = sampleFrames(v3([1, 2, 3], owned), 0.7);
    expect(out.ball!.ownerId).toBe('p');
    expect(out.players.get('p')!.hasBall).toBe(true);
  });
});

describe('sampleFrames on v3 frames: the ball', () => {
  // A chip: struck at tick 0, free flight under the engine's physics.
  const chip: BallTrack = {
    dtSec: 0.1,
    endTick: 1000,
    keys: [{ tick: 0, x: 30, y: 34, z: 0, vx: 18, vy: 0, vz: 9, ownerId: null }],
  };

  it('replays the flight with the engine physics, tick for tick', () => {
    const frames = v3([10, 10, 10, 10, 10, 10, 10, 10], chip);
    const body: BallBody = { pos: vec(30, 34), vel: vec(18, 0), z: 0, vz: 9 };
    for (let tick = 1; tick <= 30; tick++) {
      stepBall(body, 0.1);
      const s = sampleFrames(frames, Math.round(tick) / 10).ball!;
      expect(s.x).toBeCloseTo(body.pos.x, 9);
      expect(s.z).toBeCloseTo(body.z, 9);
    }
  });

  it('rises above the grass mid-flight and has height 0 before the kick', () => {
    const frames = v3([10, 10, 10, 10], chip);
    expect(sampleFrames(frames, 0).ball!.z).toBe(0);
    expect(sampleFrames(frames, 0.9).ball!.z).toBeGreaterThan(2);
  });

  it('starts a new flight exactly at the next keyframe', () => {
    const kicked: BallTrack = {
      dtSec: 0.1,
      endTick: 1000,
      keys: [
        { tick: 0, x: 30, y: 34, z: 0, vx: 0, vy: 0, vz: 0, ownerId: 'p' },
        { tick: 7, x: 31.5, y: 34, z: 0, vx: 0, vy: 12, vz: 0, ownerId: null },
      ],
    };
    const frames = v3([10, 10, 10, 10], kicked);
    expect(sampleFrames(frames, 0.6).ball!.x).toBe(30);
    expect(sampleFrames(frames, 0.7).ball).toEqual({ x: 31.5, y: 34, z: 0, ownerId: null });
    // Halfway through tick 6 to 7 the ball is halfway to the keyframe, and
    // still his until the touch.
    expect(sampleFrames(frames, 0.65).ball!.x).toBeCloseTo(30.75, 9);
    expect(sampleFrames(frames, 0.65).ball!.ownerId).toBe('p');
  });
});

describe('sampleFrames on v2 frames is unchanged', () => {
  it('reports the ball at height 0 and keeps the linear glide', () => {
    const frames: PositionSnapshot[] = [
      { minute: 1, second: 0, snapshots: { players: [], ball: { x: 10, y: 10, ownerId: null } } },
      { minute: 1, second: 2, snapshots: { players: [], ball: { x: 30, y: 50, ownerId: 'q' } } },
    ];
    expect(sampleFrames(frames, 1).ball).toEqual({ x: 20, y: 30, z: 0, ownerId: 'q' });
    expect(sampleFrames(frames, 0.5).ball).toEqual({ x: 15, y: 20, z: 0, ownerId: null });
  });
});
