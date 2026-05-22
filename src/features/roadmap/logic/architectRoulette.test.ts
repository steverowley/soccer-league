// ── architectRoulette.test.ts ──────────────────────────────────────────────
// Unit tests for the weighted idea picker.  Two flavours:
//
//   • Determinism + edge cases (small, fast)  — null on empty,
//     single-item collapse, idea-status filtering, negative-priority
//     clamping.
//   • Statistical convergence — given a fixed RNG seed, run the picker
//     thousands of times and verify the empirical distribution matches
//     the expected inverse-priority weights to within a tolerance.
//     This also pins the "more than uniform random" acceptance line
//     from the issue.

import { describe, it, expect } from 'vitest';

import type { BoardItem, RoadmapItem } from '../types';
import { pickArchitectIdea } from './architectRoulette';

/**
 * Minimal BoardItem builder for the `supabase` variant — picker only
 * reads `id`, `status`, and `priority`, so we don't need to construct
 * the full RoadmapItem payload.
 */
function idea(id: string, priority: number, status: BoardItem['status'] = 'idea'): BoardItem {
  return {
    kind:       'supabase',
    id,
    title:      `Idea ${id}`,
    status,
    priority,
    created_at: '2026-04-01T12:00:00Z',
    updated_at: '2026-04-01T12:00:00Z',
    item:       { id, title: `Idea ${id}`, status, priority } as unknown as RoadmapItem,
  };
}

// ── Edge cases ───────────────────────────────────────────────────────────────

describe('pickArchitectIdea — degenerate inputs', () => {
  it('returns null when no items are provided', () => {
    expect(pickArchitectIdea([])).toBeNull();
  });

  it('returns null when no items are in the idea status', () => {
    const items: BoardItem[] = [
      idea('a', 0, 'planned'),
      idea('b', 1, 'in_progress'),
      idea('c', 2, 'shipped'),
    ];
    expect(pickArchitectIdea(items)).toBeNull();
  });

  it('returns the only idea when there is exactly one', () => {
    const only = idea('only', 5);
    expect(pickArchitectIdea([only])).toBe(only);
  });

  it('ignores non-idea items even when ideas exist alongside them', () => {
    const onlyIdea = idea('seed', 10);
    const items: BoardItem[] = [
      idea('p1', 0, 'planned'),
      onlyIdea,
      idea('s1', 0, 'shipped'),
    ];
    // Only one idea in the input → it must be returned every time.
    for (let i = 0; i < 10; i++) {
      expect(pickArchitectIdea(items, () => Math.random())).toBe(onlyIdea);
    }
  });
});

// ── Determinism with injected RNG ────────────────────────────────────────────

describe('pickArchitectIdea — deterministic with injected RNG', () => {
  it('respects the injected RNG so identical seeds produce identical picks', () => {
    const items: BoardItem[] = [
      idea('low', 0),
      idea('mid', 2),
      idea('hi',  5),
    ];
    // RNG fixed at 0 — picks first item whose cumulative weight ≥ 0,
    // which is `low` (its weight is added first).
    expect(pickArchitectIdea(items, () => 0)?.id).toBe('low');
    // RNG just under 1 — last bucket wins.
    expect(pickArchitectIdea(items, () => 0.9999)?.id).toBe('hi');
  });
});

// ── Statistical weighting ────────────────────────────────────────────────────

/**
 * Tiny mulberry32 PRNG — seedable and pure JS, returns [0, 1).  Lets us
 * pin the random source so the distribution test is deterministic across
 * runs without resorting to flaky tolerance-only assertions.
 */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

describe('pickArchitectIdea — weighted distribution', () => {
  it('biases toward lower-priority (= higher-importance) ideas', () => {
    // Two ideas at extremes:  priority 0 vs priority 9.
    // Expected weights: 1/(0+1) = 1.0  vs  1/(9+1) = 0.1
    // So the priority-0 item wins ~91% of trials.
    const items: BoardItem[] = [
      idea('high', 0),
      idea('low',  9),
    ];
    const rng = mulberry32(1234);
    const counts: Record<string, number> = { high: 0, low: 0 };
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const r = pickArchitectIdea(items, rng);
      if (r) counts[r.id]! += 1;
    }
    // Empirical ratio should hit 91/9 ±2 percentage points easily at N=4000.
    expect(counts.high! / N).toBeGreaterThan(0.85);
    expect(counts.high! / N).toBeLessThan(0.95);
    expect(counts.low!  / N).toBeGreaterThan(0.05);
    expect(counts.low!  / N).toBeLessThan(0.15);
  });

  it('beats uniform random — every priority-0 item should appear strictly more often than 1/N would predict for itself when mixed with low-priority items', () => {
    // Mix one "important" idea (p=0) with three "low-importance" ideas
    // (p=9 each).  Under uniform random each would win 25% of trials.
    // Under inverse weighting:
    //   w_high = 1.0;  w_low = 0.1 (× 3 lows = 0.3 total)
    //   total = 1.3;   share_high = 1.0 / 1.3 ≈ 0.77
    const items: BoardItem[] = [
      idea('high', 0),
      idea('lo1', 9),
      idea('lo2', 9),
      idea('lo3', 9),
    ];
    const rng = mulberry32(99);
    const counts: Record<string, number> = { high: 0, lo1: 0, lo2: 0, lo3: 0 };
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const r = pickArchitectIdea(items, rng);
      if (r) counts[r.id]! += 1;
    }
    // Acceptance line: "Repeated clicks pick deterministically different
    // items more often than uniform random" — the high item must
    // clearly outpace its 25% share, and the lows must clearly trail it.
    expect(counts.high! / N).toBeGreaterThan(0.70);
    expect(counts.lo1!  / N).toBeLessThan(0.15);
    expect(counts.lo2!  / N).toBeLessThan(0.15);
    expect(counts.lo3!  / N).toBeLessThan(0.15);
  });

  it('treats equal-priority ideas uniformly within their tier', () => {
    const items: BoardItem[] = [
      idea('a', 3),
      idea('b', 3),
      idea('c', 3),
    ];
    const rng = mulberry32(7);
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    const N = 3000;
    for (let i = 0; i < N; i++) {
      const r = pickArchitectIdea(items, rng);
      if (r) counts[r.id]! += 1;
    }
    // Each share should hover around 1/3 ± 5pp at N=3000.
    for (const id of ['a', 'b', 'c']) {
      const share = counts[id]! / N;
      expect(share).toBeGreaterThan(0.28);
      expect(share).toBeLessThan(0.38);
    }
  });
});

// ── Defensive — negative priorities ──────────────────────────────────────────

describe('pickArchitectIdea — negative priority clamping', () => {
  it('never assigns Infinity weight when priority is negative', () => {
    // A negative priority would, without clamping, give weight 1/0 = Infinity.
    // We expect clamping to floor at 0 so the weight is 1/(0+1) = 1.0.
    const items: BoardItem[] = [
      idea('neg', -10), // would be Infinity without the clamp
      idea('zero', 0),
    ];
    const rng = mulberry32(42);
    const counts: Record<string, number> = { neg: 0, zero: 0 };
    const N = 2000;
    for (let i = 0; i < N; i++) {
      const r = pickArchitectIdea(items, rng);
      if (r) counts[r.id]! += 1;
    }
    // After clamping both items have weight 1.0, so each ~50%.  Without
    // the clamp the negative one would win >99% as Infinity dominates.
    expect(counts.neg!  / N).toBeGreaterThan(0.4);
    expect(counts.neg!  / N).toBeLessThan(0.6);
    expect(counts.zero! / N).toBeGreaterThan(0.4);
    expect(counts.zero! / N).toBeLessThan(0.6);
  });
});
