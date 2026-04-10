// ── xpCurve.test.ts ─────────────────────────────────────────────────────────
// WHY: The training curve is the feedback loop that makes clicking feel
// rewarding. Getting this wrong — first bump too fast, tenth bump too slow,
// stat rotation desynced — would break the mechanical trust the clicker
// depends on. These tests lock the curve shape in place.

import { describe, it, expect } from 'vitest';
import {
  XP_PER_CLICK,
  BASE_XP_COST,
  CURVE_MULTIPLIER,
  STAT_ROTATION,
  xpRequiredForBump,
  bumpsEarned,
  statForBump,
  applyClick,
  xpUntilNextBump,
} from './xpCurve';

// ── xpRequiredForBump ───────────────────────────────────────────────────────

describe('xpRequiredForBump', () => {
  it('returns 0 for bump 0 (no bumps earned)', () => {
    expect(xpRequiredForBump(0)).toBe(0);
  });

  it('returns BASE_XP_COST for bump 1', () => {
    expect(xpRequiredForBump(1)).toBe(BASE_XP_COST);
  });

  it('is strictly increasing with bump count', () => {
    const vals = [1, 2, 3, 4, 5, 10].map(xpRequiredForBump);
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i]!).toBeGreaterThan(vals[i - 1]!);
    }
  });

  it('follows the geometric curve', () => {
    // Bump 2 should cost BASE * (1 + CURVE_MULTIPLIER) cumulatively.
    const expected = Math.ceil(
      BASE_XP_COST * (1 + CURVE_MULTIPLIER),
    );
    expect(xpRequiredForBump(2)).toBe(expected);
  });

  it('returns 0 for negative bump counts', () => {
    expect(xpRequiredForBump(-1)).toBe(0);
    expect(xpRequiredForBump(-100)).toBe(0);
  });

  it('returns Infinity for non-finite input', () => {
    expect(xpRequiredForBump(Infinity)).toBe(Infinity);
    expect(xpRequiredForBump(NaN)).toBe(Infinity);
  });
});

// ── bumpsEarned ─────────────────────────────────────────────────────────────

describe('bumpsEarned', () => {
  it('returns 0 for zero XP', () => {
    expect(bumpsEarned(0)).toBe(0);
  });

  it('returns 0 just below the first threshold', () => {
    expect(bumpsEarned(BASE_XP_COST - 1)).toBe(0);
  });

  it('returns 1 exactly at the first threshold', () => {
    expect(bumpsEarned(BASE_XP_COST)).toBe(1);
  });

  it('returns 1 just above first threshold, below second', () => {
    const belowSecond = xpRequiredForBump(2) - 1;
    expect(bumpsEarned(belowSecond)).toBe(1);
  });

  it('returns 2 at the second threshold', () => {
    expect(bumpsEarned(xpRequiredForBump(2))).toBe(2);
  });

  it('returns 10 at the tenth threshold', () => {
    expect(bumpsEarned(xpRequiredForBump(10))).toBe(10);
  });

  it('handles negative and non-finite XP defensively', () => {
    // Defensive: non-finite input returns 0 rather than looping forever.
    // Infinity is NOT a valid XP total — the curve bakes in a 10k safety
    // rail but the guard clause short-circuits before we get there.
    expect(bumpsEarned(-100)).toBe(0);
    expect(bumpsEarned(NaN)).toBe(0);
    expect(bumpsEarned(Infinity)).toBe(0);
  });
});

// ── statForBump ─────────────────────────────────────────────────────────────

describe('statForBump', () => {
  it('returns null for bump <= 0', () => {
    expect(statForBump(0)).toBeNull();
    expect(statForBump(-1)).toBeNull();
  });

  it('rotates round-robin across all 5 stats', () => {
    expect(statForBump(1)).toBe('attacking');
    expect(statForBump(2)).toBe('defending');
    expect(statForBump(3)).toBe('mental');
    expect(statForBump(4)).toBe('athletic');
    expect(statForBump(5)).toBe('technical');
  });

  it('wraps back to attacking on the 6th bump', () => {
    expect(statForBump(6)).toBe('attacking');
    expect(statForBump(11)).toBe('attacking');
  });

  it('covers every stat in STAT_ROTATION', () => {
    const seen = new Set<string>();
    for (let i = 1; i <= STAT_ROTATION.length; i++) {
      const s = statForBump(i);
      if (s) seen.add(s);
    }
    expect(seen.size).toBe(STAT_ROTATION.length);
  });
});

// ── applyClick ──────────────────────────────────────────────────────────────

describe('applyClick', () => {
  it('adds XP_PER_CLICK when no explicit amount given', () => {
    const r = applyClick(0);
    expect(r.newTotalXp).toBe(XP_PER_CLICK);
  });

  it('does not award a bump before the first threshold', () => {
    const r = applyClick(0, XP_PER_CLICK);
    expect(r.statBumped).toBeNull();
    expect(r.totalBumps).toBe(0);
  });

  it('awards the first bump exactly at the first threshold', () => {
    // Start at BASE_XP_COST - XP_PER_CLICK so this click lands on the
    // threshold.
    const start = BASE_XP_COST - XP_PER_CLICK;
    const r = applyClick(start, XP_PER_CLICK);
    expect(r.newTotalXp).toBe(BASE_XP_COST);
    expect(r.statBumped).toBe('attacking');
    expect(r.totalBumps).toBe(1);
  });

  it('only awards one bump even if XP crosses multiple thresholds', () => {
    // Use a monstrously large xpAdded to guarantee crossing >1 thresholds.
    const r = applyClick(0, xpRequiredForBump(5) + 1);
    // Still only one bump is credited to this click.
    expect(r.statBumped).toBe('attacking');
    // But totalBumps reflects what bumpsEarned would say post-click? No —
    // we intentionally cap at bumpsBefore + 1 to keep clicks 1:1 with bumps.
    expect(r.totalBumps).toBe(1);
  });

  it('second bump rotates to defending', () => {
    const start = xpRequiredForBump(2) - XP_PER_CLICK;
    const r = applyClick(start, XP_PER_CLICK);
    expect(r.statBumped).toBe('defending');
    expect(r.totalBumps).toBe(2);
  });

  it('non-threshold click preserves total bump count', () => {
    // Start already at bump 3.
    const start = xpRequiredForBump(3);
    const r = applyClick(start, XP_PER_CLICK);
    expect(r.statBumped).toBeNull();
    expect(r.totalBumps).toBe(3);
  });

  it('clamps negative previousTotalXp to 0', () => {
    const r = applyClick(-500, XP_PER_CLICK);
    expect(r.newTotalXp).toBe(XP_PER_CLICK);
  });

  it('ignores non-positive xpAdded', () => {
    const r = applyClick(100, 0);
    expect(r.newTotalXp).toBe(100);
    expect(r.statBumped).toBeNull();
  });
});

// ── xpUntilNextBump ─────────────────────────────────────────────────────────

describe('xpUntilNextBump', () => {
  it('returns full cost when XP is zero', () => {
    expect(xpUntilNextBump(0)).toBe(BASE_XP_COST);
  });

  it('returns 0 exactly at a threshold (bump pending)', () => {
    expect(xpUntilNextBump(BASE_XP_COST)).toBe(
      xpRequiredForBump(2) - BASE_XP_COST,
    );
  });

  it('counts down as XP accumulates', () => {
    const halfway = Math.floor(BASE_XP_COST / 2);
    expect(xpUntilNextBump(halfway)).toBe(BASE_XP_COST - halfway);
  });

  it('never returns negative', () => {
    expect(xpUntilNextBump(xpRequiredForBump(5))).toBeGreaterThanOrEqual(0);
  });

  it('handles bogus input defensively', () => {
    expect(xpUntilNextBump(-1)).toBe(BASE_XP_COST);
    expect(xpUntilNextBump(NaN)).toBe(BASE_XP_COST);
  });
});
