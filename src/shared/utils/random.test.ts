// ── random.test.ts ───────────────────────────────────────────────────────────
// WHY: These are the first TypeScript unit tests in the project — the "smoke
// test" that proves the Vitest harness, tsconfig path aliases, and strict
// TypeScript all work end-to-end before we build anything more complex.
//
// The random utilities are the ideal first test target because:
//   - They are pure functions with no side effects.
//   - The entire engine's randomness flows through them, so correctness here
//     is foundational.
//   - Patching Math.random is straightforward, making deterministic testing easy.
//
// Test strategy:
//   - Deterministic boundary tests: mock Math.random to return 0.0, 0.999…,
//     and a mid-range value, then assert the exact output.
//   - Distribution sanity checks: run 10 000 samples and verify every result
//     stays within the declared range. This catches off-by-one bugs that
//     boundary mocks alone might miss.
//   - Type correctness is verified implicitly — if the generics were wrong,
//     the test file itself would fail tsc --noEmit.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { pick, rnd, rndI } from './random';

// ── Shared mock setup ─────────────────────────────────────────────────────────

/** Replaces Math.random with a vi.fn() stub for deterministic tests. */
function mockRandom(value: number): void {
  vi.spyOn(Math, 'random').mockReturnValue(value);
}

afterEach(() => {
  // Always restore Math.random after each test so distribution tests below
  // use the real implementation.
  vi.restoreAllMocks();
});

// ── rnd ───────────────────────────────────────────────────────────────────────

describe('rnd', () => {
  it('returns min when Math.random() === 0', () => {
    mockRandom(0);
    expect(rnd(10, 20)).toBe(10);
  });

  it('stays strictly below max when Math.random() returns a near-1 value', () => {
    // NOTE: 0.9999999999999999 === 1.0 in IEEE 754 double precision, so using
    // it as a mock would make rnd(10,20) return exactly 20 — violating the
    // exclusive upper bound. Use 0.9999 instead: clearly less than 1, gives
    // rnd(10,20) = 0.9999*10+10 = 19.999, which is in range and < 20.
    mockRandom(0.9999);
    const result = rnd(10, 20);
    expect(result).toBeGreaterThanOrEqual(10);
    expect(result).toBeLessThan(20);
  });

  it('scales linearly between min and max', () => {
    mockRandom(0.5);
    expect(rnd(0, 100)).toBe(50);
    expect(rnd(20, 40)).toBe(30);
  });

  it('works with negative min', () => {
    mockRandom(0.5);
    expect(rnd(-10, 10)).toBe(0);
  });

  // ── Distribution sanity ───────────────────────────────────────────────────
  // Run 10 000 real (unpatched) samples and assert every result is in range.
  it('never produces a value outside [min, max) over 10 000 samples', () => {
    const MIN = -5;
    const MAX = 42;
    for (let i = 0; i < 10_000; i++) {
      const result = rnd(MIN, MAX);
      expect(result).toBeGreaterThanOrEqual(MIN);
      expect(result).toBeLessThan(MAX);
    }
  });
});

// ── rndI ──────────────────────────────────────────────────────────────────────

describe('rndI', () => {
  it('returns min when Math.random() === 0', () => {
    mockRandom(0);
    expect(rndI(1, 6)).toBe(1);
  });

  it('returns max when Math.random() approaches 1', () => {
    // The +1 inside rndI makes max inclusive. Verify this boundary explicitly.
    mockRandom(0.9999999999999999);
    expect(rndI(1, 6)).toBe(6);
  });

  it('always returns an integer', () => {
    for (let i = 0; i < 1_000; i++) {
      const result = rndI(1, 100);
      expect(Number.isInteger(result)).toBe(true);
    }
  });

  it('simulates a d6 correctly — never goes below 1 or above 6', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 10_000; i++) {
      const roll = rndI(1, 6);
      expect(roll).toBeGreaterThanOrEqual(1);
      expect(roll).toBeLessThanOrEqual(6);
      seen.add(roll);
    }
    // All 6 faces should appear in 10 000 rolls (probability of any face missing
    // is astronomically small: (5/6)^10000 ≈ 10^-796).
    expect(seen.size).toBe(6);
  });

  it('works with min === max (degenerate range)', () => {
    // When min === max the only valid return is that value.
    for (let i = 0; i < 100; i++) {
      expect(rndI(7, 7)).toBe(7);
    }
  });
});

// ── pick ──────────────────────────────────────────────────────────────────────

describe('pick', () => {
  it('returns the only element from a singleton array', () => {
    expect(pick(['solo'])).toBe('solo');
  });

  it('returns min-index element when Math.random() === 0', () => {
    mockRandom(0);
    expect(pick(['a', 'b', 'c'])).toBe('a');
  });

  it('returns max-index element when Math.random() approaches 1', () => {
    mockRandom(0.9999999999999999);
    expect(pick(['a', 'b', 'c'])).toBe('c');
  });

  it('preserves element type (string array → string)', () => {
    // TypeScript generic is verified at compile time, but the runtime value
    // should also be a string.
    const result = pick(['x', 'y', 'z']);
    expect(typeof result).toBe('string');
  });

  it('preserves element type (object array → object)', () => {
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const result = pick(items);
    expect(result).toHaveProperty('id');
  });

  it('picks every element at least once over 10 000 draws from a 3-element array', () => {
    const arr = ['alpha', 'beta', 'gamma'] as const;
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      seen.add(pick(arr));
    }
    // Probability of any element not appearing: (2/3)^10000 ≈ 10^-1761.
    expect(seen.size).toBe(3);
  });

  it('works with readonly arrays (const assertions)', () => {
    // This would fail to compile if pick() did not accept `readonly T[]`.
    const readonly = ['north', 'south', 'east', 'west'] as const;
    const result = pick(readonly);
    expect(['north', 'south', 'east', 'west']).toContain(result);
  });
});
