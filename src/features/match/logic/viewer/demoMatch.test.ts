// ── demoMatch.test.ts ───────────────────────────────────────────────────────
// Verifies the synthetic showcase match: determinism, frame shape, in-range
// coordinates, and that exactly one ball carrier (if any) is flagged per frame.

import { describe, it, expect, vi } from 'vitest';

import { generateDemoMatch } from './demoMatch';

// Each test runs at least one full 90-minute spatial sim (~2–3s); the
// determinism test runs two.  A slower CI runner tips two sims past vitest's
// 5s default, so give the whole file generous headroom.
vi.setConfig({ testTimeout: 30000 });

describe('generateDemoMatch', () => {
  it('is deterministic for a given seed', () => {
    const a = generateDemoMatch(3);
    const b = generateDemoMatch(3);
    expect(a.finalScore).toEqual(b.finalScore);
    expect(a.frames.length).toBe(b.frames.length);
    expect(a.frames[0]).toEqual(b.frames[0]);
  });

  it('produces a full match of frames with 22 players each', () => {
    const m = generateDemoMatch();
    expect(m.frames.length).toBeGreaterThan(1000); // ~2700 at 1 frame / 2s
    expect(m.homePlayers).toHaveLength(11);
    expect(m.awayPlayers).toHaveLength(11);
    for (const f of [m.frames[0]!, m.frames[m.frames.length - 1]!]) {
      expect(f.snapshots.players).toHaveLength(22);
    }
  });

  it('keeps coordinates finite + pitch-scale and time monotonic', () => {
    const m = generateDemoMatch();
    let prev = -1;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const f of m.frames) {
      const g = (f.minute - 1) * 60 + f.second;
      expect(g).toBeGreaterThanOrEqual(prev); // non-decreasing game time
      prev = g;
      for (const p of f.snapshots.players) {
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
    }
    // The engine clamps to the pitch but a rounded edge value can sit a hair
    // past the line; assert pitch-scale with a small margin (catches NaN/garbage).
    expect(minX).toBeGreaterThanOrEqual(-2);
    expect(maxX).toBeLessThanOrEqual(107);
    expect(minY).toBeGreaterThanOrEqual(-2);
    expect(maxY).toBeLessThanOrEqual(70);
  });

  it('flags at most one ball carrier per frame, matching the ball owner', () => {
    const m = generateDemoMatch();
    for (const f of m.frames) {
      const carriers = f.snapshots.players.filter((p) => p.hasBall);
      expect(carriers.length).toBeLessThanOrEqual(1);
      if (f.snapshots.ball.ownerId) {
        expect(carriers[0]?.id).toBe(f.snapshots.ball.ownerId);
      }
    }
  });

  it('viewer rosters reference the same ids the frames use', () => {
    const m = generateDemoMatch();
    const frameIds = new Set(m.frames[0]!.snapshots.players.map((p) => p.id));
    for (const p of [...m.homePlayers, ...m.awayPlayers]) {
      expect(frameIds.has(p.id)).toBe(true);
    }
  });
});
