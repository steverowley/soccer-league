// ── features/match/logic/spatial/rng.test.ts ─────────────────────────────────
// Unit tests for the seeded RNG.  Determinism is the load-bearing property: if
// two RNGs from the same seed ever diverged, every "reproducible match" promise
// downstream would break.

import { describe, it, expect } from 'vitest';
import { makeRng, rngRange, rngInt, rngChance, rngPick, rngGaussian } from './rng';

describe('makeRng determinism', () => {
  it('produces identical sequences for the same seed', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    const seqA = [a(), a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = makeRng(1);
    const b = makeRng(2);
    expect(a()).not.toBe(b());
  });

  it('emits values in [0, 1)', () => {
    const r = makeRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('rng helpers', () => {
  it('rngRange stays within [min, max)', () => {
    const r = makeRng(3);
    for (let i = 0; i < 500; i++) {
      const v = rngRange(r, 10, 20);
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThan(20);
    }
  });

  it('rngInt is inclusive of both ends and stays in range', () => {
    const r = makeRng(9);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const v = rngInt(r, 1, 4);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(4);
      seen.add(v);
    }
    // All four discrete values should appear over 500 draws.
    expect(seen).toEqual(new Set([1, 2, 3, 4]));
  });

  it('rngChance honours the extremes', () => {
    const r = makeRng(11);
    for (let i = 0; i < 50; i++) {
      expect(rngChance(r, 0)).toBe(false);
      expect(rngChance(r, 1)).toBe(true);
    }
  });

  it('rngPick returns an element, undefined for empty', () => {
    const r = makeRng(13);
    expect(['a', 'b', 'c']).toContain(rngPick(r, ['a', 'b', 'c']));
    expect(rngPick(r, [])).toBeUndefined();
  });

  it('rngGaussian centres on its mean', () => {
    const r = makeRng(17);
    let sum = 0;
    const N = 5000;
    for (let i = 0; i < N; i++) sum += rngGaussian(r, 5, 2);
    // Sample mean should land close to 5 over many draws.
    expect(sum / N).toBeCloseTo(5, 0);
  });
});
