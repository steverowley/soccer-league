// ── features/match/logic/viewer/ball.test.ts ────────────────────────────────

import { describe, expect, it } from 'vitest';
import {
  FEET_FORWARD_M,
  FEET_OFFSET_M,
  GLIDE_GAP_M,
  GLIDE_MS,
  TRAIL_GAME_SEC,
  ballAtFeet,
  glideBall,
  pushTrail,
  trailToDraw,
  type TrailPoint,
} from './ball';

describe('ballAtFeet', () => {
  it('sits ahead of a running player, in his running direction', () => {
    const b = ballAtFeet({ x: 50, y: 30, vx: 6, vy: 0 }, -1);
    expect(b.x).toBeCloseTo(50 + FEET_OFFSET_M);
    expect(b.y).toBeCloseTo(30 + FEET_FORWARD_M);
    expect(b.z).toBe(0);
  });

  it('uses the facing when he stands still', () => {
    expect(ballAtFeet({ x: 50, y: 30, vx: 0, vy: 0 }, -1).x).toBeCloseTo(50 - FEET_OFFSET_M);
    expect(ballAtFeet({ x: 50, y: 30, vx: 0, vy: 0 }, 1).x).toBeCloseTo(50 + FEET_OFFSET_M);
  });

  it('never puts the ball behind his legs (always toward the camera)', () => {
    const b = ballAtFeet({ x: 50, y: 30, vx: 0, vy: -7 }, 1);
    expect(b.y).toBeGreaterThanOrEqual(30 + FEET_FORWARD_M);
    expect(Math.hypot(b.x - 50, b.y - 30)).toBeLessThan(1.5);
  });

  it('follows the dribbler exactly: no drift however far apart the snapshots are', () => {
    for (let x = 0; x < 100; x += 7) {
      const b = ballAtFeet({ x, y: 20, vx: 5, vy: 1 }, 1);
      expect(Math.hypot(b.x - x, b.y - 20)).toBeLessThan(1.2);
    }
  });
});

describe('glideBall', () => {
  const a = { x: 10, y: 10, z: 0 };
  const far = { x: 30, y: 10, z: 0 };

  it('draws small moves as they are', () => {
    const near = { x: 11, y: 10, z: 0 };
    expect(glideBall(a, near, null, 0, true)).toEqual({ shown: near, glide: null });
  });

  it('turns a jump into a glide that ends exactly on the target', () => {
    const s0 = glideBall(a, far, null, 1000, true);
    expect(s0.shown).toEqual(a);
    expect(s0.glide).not.toBeNull();
    const mid = glideBall(s0.shown, far, s0.glide, 1000 + GLIDE_MS / 2, true);
    expect(mid.shown.x).toBeGreaterThan(a.x);
    expect(mid.shown.x).toBeLessThan(far.x);
    // The target keeps moving (a receiver running on): the glide still lands on it.
    const moved = { x: 33, y: 12, z: 0 };
    const end = glideBall(mid.shown, moved, mid.glide, 1000 + GLIDE_MS, true);
    expect(end).toEqual({ shown: moved, glide: null });
  });

  it('snaps when disabled (reduced motion, seek) or on the first frame', () => {
    expect(glideBall(a, far, null, 0, false).shown).toEqual(far);
    expect(glideBall(null, far, null, 0, true).shown).toEqual(far);
  });

  it('only glides over gaps above the threshold', () => {
    const edge = { x: a.x + GLIDE_GAP_M, y: 10, z: 0 };
    expect(glideBall(a, edge, null, 0, true).glide).toBeNull();
  });
});

describe('trail', () => {
  const run = (speed: number): TrailPoint[] => {
    let h: TrailPoint[] = [];
    for (let i = 0; i <= 30; i++) {
      const t = 100 + i * 0.05;
      h = pushTrail(h, { t, x: 10 + speed * (t - 100), y: 20, z: 0 });
    }
    return h;
  };

  it('keeps only the trail window', () => {
    const h = run(20);
    expect(h[h.length - 1]!.t - h[0]!.t).toBeLessThanOrEqual(TRAIL_GAME_SEC + 1e-9);
  });

  it('shows behind a pass or shot', () => {
    expect(trailToDraw(run(18)).length).toBeGreaterThan(2);
  });

  it('is absent while dribbling or still', () => {
    expect(trailToDraw(run(6))).toEqual([]);
    expect(trailToDraw(run(0))).toEqual([]);
  });

  it('clears on a restart (time goes backwards) or a long gap', () => {
    const h = run(20);
    expect(pushTrail(h, { t: 10, x: 0, y: 0, z: 0 })).toHaveLength(1);
    expect(pushTrail(h, { t: 200, x: 0, y: 0, z: 0 })).toHaveLength(1);
  });
});
