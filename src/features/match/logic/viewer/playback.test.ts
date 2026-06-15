// ── playback.test.ts ────────────────────────────────────────────────────────
// Verifies real→game time compression, frame indexing, interpolation, derived
// velocity, and the hold-at-edges behaviour.

import { describe, it, expect } from 'vitest';

import type { PositionSnapshot } from '../../api/matchPositions';
import {
  TOTAL_GAME_SECONDS,
  realToGameSeconds,
  frameGameSeconds,
  sampleFrames,
} from './playback';

/** Build a minimal snapshot: one player "p1" and a ball at given coords. */
function snap(minute: number, second: number, px: number, py: number, bx: number, by: number): PositionSnapshot {
  return {
    minute,
    second,
    snapshots: {
      players: [{ id: 'p1', x: px, y: py, hasBall: false }],
      ball: { x: bx, y: by, ownerId: null },
    },
  };
}

describe('realToGameSeconds', () => {
  it('compresses the pacing window onto the full 90 minutes', () => {
    // Halfway through a 600s window → halfway through 5400 game-seconds.
    expect(realToGameSeconds(300, 600)).toBeCloseTo(TOTAL_GAME_SECONDS / 2, 5);
  });
  it('clamps pre-kickoff time to zero', () => {
    expect(realToGameSeconds(-5, 600)).toBe(0);
  });
  it('falls back to 1× when duration is non-positive', () => {
    expect(realToGameSeconds(42, 0)).toBe(42);
  });
});

describe('frameGameSeconds', () => {
  it('converts (minute, second) to seconds since kickoff', () => {
    expect(frameGameSeconds(snap(1, 0, 0, 0, 0, 0))).toBe(0);
    expect(frameGameSeconds(snap(2, 30, 0, 0, 0, 0))).toBe(90);
  });
});

describe('sampleFrames', () => {
  it('reports no data for an empty frame list', () => {
    const out = sampleFrames([], 10);
    expect(out.hasData).toBe(false);
    expect(out.ball).toBeNull();
    expect(out.players.size).toBe(0);
  });

  it('interpolates position halfway between two frames', () => {
    const frames = [snap(1, 0, 0, 0, 10, 10), snap(1, 2, 20, 40, 30, 50)];
    const out = sampleFrames(frames, 1); // game-second 1 = midpoint of [0, 2]
    const p = out.players.get('p1')!;
    expect(p.x).toBeCloseTo(10, 5);
    expect(p.y).toBeCloseTo(20, 5);
    expect(out.ball!.x).toBeCloseTo(20, 5);
    expect(out.ball!.y).toBeCloseTo(30, 5);
  });

  it('derives velocity in metres per game-second from the frame delta', () => {
    const frames = [snap(1, 0, 0, 0, 0, 0), snap(1, 2, 20, 0, 0, 0)];
    const out = sampleFrames(frames, 1);
    // 20 m over a 2 game-second gap → 10 m/s.
    expect(out.players.get('p1')!.vx).toBeCloseTo(10, 5);
    expect(out.players.get('p1')!.vy).toBeCloseTo(0, 5);
  });

  it('holds the first frame (zero velocity) before kickoff', () => {
    const frames = [snap(1, 0, 5, 5, 1, 1), snap(1, 2, 99, 99, 9, 9)];
    const out = sampleFrames(frames, -100);
    const p = out.players.get('p1')!;
    expect(p.x).toBe(5);
    expect(p.vx).toBe(0);
  });

  it('holds the last frame (zero velocity) past the end', () => {
    const frames = [snap(1, 0, 0, 0, 0, 0), snap(1, 2, 20, 40, 30, 50)];
    const out = sampleFrames(frames, 9999);
    const p = out.players.get('p1')!;
    expect(p.x).toBe(20);
    expect(p.y).toBe(40);
    expect(p.vx).toBe(0);
  });
});
