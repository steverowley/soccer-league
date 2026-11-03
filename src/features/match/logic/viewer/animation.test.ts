// ── animation.test.ts ───────────────────────────────────────────────────────
// The stride: run amount from measured speed, a phase advanced in real time
// (faster at a sprint, stopped when standing), and footfalls every half cycle.

import { describe, it, expect } from 'vitest';

import { FULL_RUN_MPS, STRIDE_MIN_RUN, advanceStride, footfall, runAmount } from './animation';

describe('runAmount', () => {
  it('maps ground speed onto 0..1 and clamps', () => {
    expect(runAmount(0)).toBe(0);
    expect(runAmount(-2)).toBe(0);
    expect(runAmount(FULL_RUN_MPS / 2)).toBeCloseTo(0.5);
    expect(runAmount(FULL_RUN_MPS * 3)).toBe(1);
    expect(runAmount(Number.NaN)).toBe(0);
  });
});

describe('advanceStride', () => {
  it('stands still below the stride threshold or with no time passing', () => {
    expect(advanceStride(1.5, STRIDE_MIN_RUN / 2, 0.1)).toBe(1.5);
    expect(advanceStride(1.5, 1, 0)).toBe(1.5);
  });

  it('strides faster at a sprint than at a jog for the same real time', () => {
    const jog = advanceStride(0, 0.3, 0.1);
    const sprint = advanceStride(0, 1, 0.1);
    expect(jog).toBeGreaterThan(0);
    expect(sprint).toBeGreaterThan(jog);
  });

  it('is frame-rate independent: two half steps equal one whole step', () => {
    const one = advanceStride(0, 0.7, 0.1);
    const two = advanceStride(advanceStride(0, 0.7, 0.05), 0.7, 0.05);
    expect(two).toBeCloseTo(one, 10);
  });
});

describe('footfall', () => {
  it('fires each time the phase crosses a multiple of PI', () => {
    expect(footfall(0.1, 0.2)).toBe(false);
    expect(footfall(3.1, 3.2)).toBe(true);
    expect(footfall(6.2, 6.4)).toBe(true);
  });
});
