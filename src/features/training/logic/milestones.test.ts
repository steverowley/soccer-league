// ── training/logic/milestones.test.ts ────────────────────────────────────
// Smoke tests for the milestone-detection helper (#395).

import { describe, expect, it } from 'vitest';
import { crossesMilestone, TRAINING_MILESTONES } from './milestones';

describe('crossesMilestone', () => {
  it('returns null when no milestone sits inside (prev, new]', () => {
    expect(crossesMilestone(0, 4)).toBeNull();
    expect(crossesMilestone(11, 19)).toBeNull();
    expect(crossesMilestone(21, 99)).toBeNull();
  });

  it('fires when a click lands exactly on a milestone count', () => {
    expect(crossesMilestone(4, 5)).toBe(5);
    expect(crossesMilestone(9, 10)).toBe(10);
    expect(crossesMilestone(19, 20)).toBe(20);
  });

  it('fires when a click crosses a milestone without landing on it', () => {
    // (defensive — at current XP_PER_CLICK a single click never adds
    // multiple bumps, but the helper still handles a multi-bump leap.)
    expect(crossesMilestone(3, 5)).toBe(5);
    expect(crossesMilestone(9, 11)).toBe(10);
  });

  it('does not re-fire after the milestone has already been crossed', () => {
    expect(crossesMilestone(5, 6)).toBeNull();
    expect(crossesMilestone(10, 11)).toBeNull();
    expect(crossesMilestone(20, 25)).toBeNull();
  });

  it('returns the smallest milestone when a click leaps past two', () => {
    // Hypothetical click that bumps from 4 → 10 — fire the smallest
    // milestone first; the player picks up the next one on a future click.
    expect(crossesMilestone(4, 10)).toBe(5);
    expect(crossesMilestone(9, 20)).toBe(10);
  });

  it('rejects bad input', () => {
    expect(crossesMilestone(-1, 5)).toBeNull();
    expect(crossesMilestone(0, -1)).toBeNull();
    expect(crossesMilestone(NaN, 5)).toBeNull();
    expect(crossesMilestone(0, Infinity)).toBeNull();
    // Equal previous + new → no progress.
    expect(crossesMilestone(5, 5)).toBeNull();
  });

  it('exposes a sorted-ascending milestone list', () => {
    const sorted = [...TRAINING_MILESTONES].sort((a, b) => a - b);
    expect([...TRAINING_MILESTONES]).toEqual(sorted);
  });
});
