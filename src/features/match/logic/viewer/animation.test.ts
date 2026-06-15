// ── animation.test.ts ───────────────────────────────────────────────────────
// Verifies gait classification, time-based phase advance, and the pose curve
// (hop, squash/stretch, swing) including the depth-scale dependency.

import { describe, it, expect } from 'vitest';

import {
  WALK_SPEED_MPS,
  RUN_SPEED_MPS,
  STATIC_POSE,
  animStateFromSpeed,
  advancePhase,
  computePose,
} from './animation';

describe('animStateFromSpeed', () => {
  it('classifies idle / walk / run by the documented thresholds', () => {
    expect(animStateFromSpeed(0)).toBe('idle');
    expect(animStateFromSpeed(WALK_SPEED_MPS - 0.01)).toBe('idle');
    expect(animStateFromSpeed(WALK_SPEED_MPS)).toBe('walk');
    expect(animStateFromSpeed(RUN_SPEED_MPS - 0.01)).toBe('walk');
    expect(animStateFromSpeed(RUN_SPEED_MPS)).toBe('run');
    expect(animStateFromSpeed(8)).toBe('run');
  });
});

describe('advancePhase', () => {
  it('advances faster at a run than at a walk for the same dt', () => {
    const walk = advancePhase(0, 'walk', 0.1);
    const run = advancePhase(0, 'run', 0.1);
    expect(run).toBeGreaterThan(walk);
    expect(walk).toBeGreaterThan(0);
  });

  it('is frame-rate independent (two half-steps == one full step)', () => {
    const one = advancePhase(0, 'run', 0.2);
    const two = advancePhase(advancePhase(0, 'run', 0.1), 'run', 0.1);
    expect(two).toBeCloseTo(one, 10);
  });

  it('never goes backwards on a negative dt', () => {
    expect(advancePhase(5, 'run', -1)).toBe(5);
  });
});

describe('computePose', () => {
  it('produces zero hop at the bottom of the cycle and max at the top', () => {
    const bottom = computePose(0, 'run', 1); // sin(0)=0
    const top = computePose(Math.PI / 2, 'run', 1); // sin=1
    expect(bottom.hop).toBeCloseTo(0, 6);
    expect(top.hop).toBeGreaterThan(bottom.hop);
  });

  it('stretches taller+thinner at the top of the hop', () => {
    const top = computePose(Math.PI / 2, 'run', 1);
    expect(top.scaleY).toBeGreaterThan(1); // stretched
    expect(top.scaleX).toBeLessThan(1); // thinned
  });

  it('scales hop and swing by the depth scale', () => {
    const near = computePose(Math.PI / 2, 'run', 1.1);
    const far = computePose(Math.PI / 2, 'run', 0.9);
    expect(near.hop).toBeGreaterThan(far.hop);
    expect(Math.abs(near.swing)).toBeGreaterThan(Math.abs(far.swing));
  });

  it('swings the limbs through zero across a quarter cycle (cos-driven)', () => {
    const planted = computePose(Math.PI / 2, 'run', 1); // cos=0
    expect(planted.swing).toBeCloseTo(0, 6);
    const splayed = computePose(0, 'run', 1); // cos=1
    expect(Math.abs(splayed.swing)).toBeGreaterThan(1);
  });

  it('STATIC_POSE is fully neutral for reduced-motion rendering', () => {
    expect(STATIC_POSE).toEqual({ hop: 0, h: 0, scaleX: 1, scaleY: 1, swing: 0, cosPhase: 0 });
  });
});
