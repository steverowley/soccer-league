// ── cooldown.test.ts ────────────────────────────────────────────────────────
// WHY: The cooldown is the fairness guardrail on the training clicker. If
// it misfires — blocking legit fans or letting auto-clickers through — the
// community-effect promise of the training loop breaks. These tests pin
// both behaviours down.

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_COOLDOWN_MS,
  SESSION_MAX_CLICKS,
  SESSION_WINDOW_MS,
  canClick,
  withinSessionCap,
  evaluateClick,
} from './cooldown';

// ── canClick ────────────────────────────────────────────────────────────────

describe('canClick', () => {
  it('allows the first-ever click (null last-click)', () => {
    const r = canClick(null, 1_000_000);
    expect(r.allowed).toBe(true);
    expect(r.msRemaining).toBe(0);
  });

  it('allows a click when the cooldown has elapsed exactly', () => {
    const r = canClick(1_000, 1_000 + DEFAULT_COOLDOWN_MS);
    expect(r.allowed).toBe(true);
  });

  it('allows a click when the cooldown has elapsed with buffer', () => {
    const r = canClick(1_000, 1_000 + DEFAULT_COOLDOWN_MS + 500);
    expect(r.allowed).toBe(true);
    expect(r.msRemaining).toBe(0);
  });

  it('blocks a click during the cooldown window', () => {
    const r = canClick(1_000, 1_000 + 500);
    expect(r.allowed).toBe(false);
    expect(r.msRemaining).toBe(DEFAULT_COOLDOWN_MS - 500);
  });

  it('reports remaining time to the millisecond', () => {
    const now = 5_000;
    const last = now - 123;
    const r = canClick(last, now);
    expect(r.msRemaining).toBe(DEFAULT_COOLDOWN_MS - 123);
  });

  it('forgives clock skew (last-click in the future)', () => {
    const r = canClick(10_000, 5_000);
    expect(r.allowed).toBe(true);
    expect(r.msRemaining).toBe(0);
  });

  it('treats NaN lastClickMs as never-clicked', () => {
    const r = canClick(NaN, 1_000);
    expect(r.allowed).toBe(true);
  });

  it('respects a custom cooldown', () => {
    // 2s gap with a 1s custom cooldown → allowed.
    const r = canClick(1_000, 3_000, 1_000);
    expect(r.allowed).toBe(true);
  });

  it('blocks when custom cooldown is still in effect', () => {
    const r = canClick(1_000, 1_200, 1_000);
    expect(r.allowed).toBe(false);
    expect(r.msRemaining).toBe(800);
  });
});

// ── withinSessionCap ────────────────────────────────────────────────────────

describe('withinSessionCap', () => {
  it('returns true for an empty history', () => {
    expect(withinSessionCap([], 1_000_000)).toBe(true);
  });

  it('ignores clicks outside the rolling window', () => {
    const now = 10_000_000;
    const old = now - SESSION_WINDOW_MS - 1; // 1ms past window
    // A thousand old clicks should not block a new one.
    const history = Array.from({ length: SESSION_MAX_CLICKS + 10 }, () => old);
    expect(withinSessionCap(history, now)).toBe(true);
  });

  it('blocks when the cap is exactly hit in the window', () => {
    const now = 10_000_000;
    const fresh = now - 100; // within window
    const history = Array.from({ length: SESSION_MAX_CLICKS }, () => fresh);
    expect(withinSessionCap(history, now)).toBe(false);
  });

  it('allows when one less than the cap in the window', () => {
    const now = 10_000_000;
    const fresh = now - 100;
    const history = Array.from({ length: SESSION_MAX_CLICKS - 1 }, () => fresh);
    expect(withinSessionCap(history, now)).toBe(true);
  });

  it('counts only in-window clicks when history is mixed', () => {
    const now = 10_000_000;
    const fresh = now - 500;
    const old = now - SESSION_WINDOW_MS - 5_000;
    const history = [
      ...Array.from({ length: SESSION_MAX_CLICKS - 1 }, () => fresh),
      ...Array.from({ length: 10_000 }, () => old),
    ];
    expect(withinSessionCap(history, now)).toBe(true);
  });

  it('filters NaN timestamps defensively', () => {
    const now = 10_000_000;
    const history = [NaN, NaN, now - 500];
    expect(withinSessionCap(history, now, 2)).toBe(true);
  });

  it('respects a custom cap and window', () => {
    const now = 10_000_000;
    const inWindow = now - 100;
    const history = [inWindow, inWindow, inWindow];
    // Cap = 3, so the next click is blocked.
    expect(withinSessionCap(history, now, 3, 60_000)).toBe(false);
    // Cap = 4, allowed.
    expect(withinSessionCap(history, now, 4, 60_000)).toBe(true);
  });
});

// ── evaluateClick ───────────────────────────────────────────────────────────

describe('evaluateClick', () => {
  it('returns ok when both checks pass', () => {
    const now = 10_000_000;
    const last = now - DEFAULT_COOLDOWN_MS - 100;
    const r = evaluateClick(last, [], now);
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe('ok');
  });

  it('blocks with reason cooldown when spam-clicking', () => {
    const now = 10_000_000;
    const last = now - 200;
    const r = evaluateClick(last, [], now);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('cooldown');
    expect(r.msRemaining).toBeGreaterThan(0);
  });

  it('blocks with reason session_cap when at session limit', () => {
    const now = 10_000_000;
    const last = now - DEFAULT_COOLDOWN_MS - 100; // cooldown OK
    const inWindow = now - 500;
    const history = Array.from({ length: SESSION_MAX_CLICKS }, () => inWindow);
    const r = evaluateClick(last, history, now);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('session_cap');
  });

  it('prioritises cooldown over session cap (cheaper check first)', () => {
    const now = 10_000_000;
    const last = now - 100; // cooldown NOT OK
    const history = Array.from({ length: SESSION_MAX_CLICKS }, () => now - 500);
    const r = evaluateClick(last, history, now);
    expect(r.reason).toBe('cooldown');
  });

  it('allows a first-ever click (empty history + null last)', () => {
    const r = evaluateClick(null, [], 1);
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe('ok');
  });
});
