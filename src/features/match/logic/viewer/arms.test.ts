// ── arms.test.ts ────────────────────────────────────────────────────────────
// The floppy spring arms: they hang at rest, trail when the body sets off,
// fling and settle after an impulse, make a V overhead to celebrate, follow a
// pose's hold, are frame-rate independent, and allocate nothing per step.

import { describe, it, expect } from 'vitest';

import { ARM_HOLDS, FLOPPY, REST_ANGLE, holdArms, kickArms, newArms, newDrive, stepArms, stepJolt } from './arms';

/** Run the springs for `sec` real seconds at 60 fps. */
function run(st: ReturnType<typeof newArms>, sec: number, set: (d: ReturnType<typeof newDrive>, t: number) => void = () => {}) {
  const d = newDrive();
  for (let i = 0; i < Math.round(sec * 60); i++) {
    d.t = i / 60;
    set(d, i / 60);
    stepArms(st, 1 / 60, d);
  }
  return st;
}

describe('arms', () => {
  it('uses the owner preset "Floppy"', () => {
    expect(FLOPPY).toEqual({ K: 22, D: 3.4, G: 0.9, kick: 10, step: 2.2 });
  });

  it('hang near rest when nothing happens (gravity pulls them a little lower)', () => {
    const st = run(newArms(0.3), 3);
    for (const arm of [st.back, st.front]) {
      expect(arm.a).toBeGreaterThan(0.3);
      expect(arm.a).toBeLessThanOrEqual(REST_ANGLE + 1e-9);
      expect(Math.abs(arm.av)).toBeLessThan(0.05);
    }
  });

  it('an impulse flings both arms up, then they settle back (damped, not a loop)', () => {
    const st = run(newArms(0.3), 2);
    const before = st.front.a;
    kickArms(st, 1);
    run(st, 0.15);
    expect(st.front.a).toBeGreaterThan(before + 0.4);
    run(st, 4);
    expect(Math.abs(st.front.a - before)).toBeLessThan(0.05);
  });

  it('trail when the body sets off: the arms on each side swing opposite ways', () => {
    const st = run(newArms(0.3), 2);
    const rest = st.front.a;
    run(st, 0.2, (d) => { d.ax = 8; });
    expect(st.front.a).toBeLessThan(rest);
    expect(st.back.a).toBeGreaterThan(rest);
  });

  it('a celebration makes a V overhead; a hold pulls the arms to its pose', () => {
    const cel = run(newArms(0.5), 1.5, (d) => holdArms(d, 'celebrate'));
    expect(cel.front.a).toBeGreaterThan(1.8);
    expect(cel.back.a).toBeGreaterThan(1.8);
    const over = run(newArms(0.5), 1.5, (d) => holdArms(d, 'overhead'));
    expect(over.front.a).toBeCloseTo(ARM_HOLDS.overhead.a, 0);
    const free = newDrive();
    holdArms(free, 'rest');
    expect(free.hold).toBeNull();
    expect(free.celebrate).toBe(false);
  });

  it('is deterministic per seed and frame-rate independent', () => {
    const a = newArms(0.42);
    const b = newArms(0.42);
    kickArms(a, 1);
    kickArms(b, 1);
    stepJolt(a);
    stepJolt(b);
    expect(a).toEqual(b);
    const d = newDrive();
    for (let i = 0; i < 60; i++) stepArms(a, 1 / 60, d);
    for (let i = 0; i < 30; i++) stepArms(b, 1 / 30, d);
    expect(Math.abs(a.front.a - b.front.a)).toBeLessThan(0.02);
  });

  it('a zero or broken time step freezes them (reduced motion)', () => {
    const st = newArms(0.1);
    kickArms(st, 1);
    const snap = JSON.stringify(st);
    stepArms(st, 0, newDrive());
    stepArms(st, Number.NaN, newDrive());
    expect(JSON.stringify(st)).toBe(snap);
  });

  it('stays within the joint limits however hard it is hit', () => {
    const st = newArms(0.9);
    for (let i = 0; i < 20; i++) kickArms(st, 3);
    run(st, 2);
    for (const arm of [st.back, st.front]) {
      expect(arm.a).toBeGreaterThanOrEqual(-0.7);
      expect(arm.a).toBeLessThanOrEqual(3.4);
      expect(Math.abs(arm.b)).toBeLessThanOrEqual(2);
    }
  });
});
