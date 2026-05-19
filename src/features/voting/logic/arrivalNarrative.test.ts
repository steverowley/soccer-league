// ── voting/logic/arrivalNarrative.test.ts ────────────────────────────────────
// Unit tests for the Phase 3.2 "New Arrival" narrative builder.

import { describe, expect, it } from 'vitest';
import {
  NEW_ARRIVAL_KIND,
  buildArrivalNarrative,
  type ArrivalContext,
} from './arrivalNarrative';

const baseCtx: ArrivalContext = {
  newPlayerName:         'Flux Kowalski',
  teamName:              'Mars Athletic',
  incineratedPlayerName: 'Lira Steele',
  position:              'FW',
  age:                   18,
  nationality:           'Martian',
};

describe('buildArrivalNarrative — substitution', () => {
  it('substitutes every documented token from the WITH_DECEASED bank', () => {
    const line = buildArrivalNarrative(baseCtx, () => 0);
    expect(line).toContain('Flux Kowalski');
    expect(line).toContain('Mars Athletic');
    // At least one of the two banks references the deceased / position / age / nationality.
    // We don't assert ALL appear in every variant — templates pick their own subsets.
    expect(line).not.toMatch(/\{[A-Z]+\}/);
  });

  it('omits {DECEASED} substitution when incineratedPlayerName is null', () => {
    const ctx = { ...baseCtx, incineratedPlayerName: null };
    const line = buildArrivalNarrative(ctx, () => 0);
    expect(line).not.toContain('{DECEASED}');
    expect(line).not.toContain('Lira Steele');
  });

  it('uses the WITH_DECEASED bank when incineratedPlayerName is set', () => {
    const line = buildArrivalNarrative(baseCtx, () => 0);
    // WITH_DECEASED templates all reference {DECEASED}, so the deceased
    // name should always appear in the rendered line.
    expect(line).toContain('Lira Steele');
  });

  it('substitutes age as a string', () => {
    const ctx = { ...baseCtx, age: 21 };
    const line = buildArrivalNarrative(ctx, () => 0);
    expect(line).toContain('21');
  });

  it('substitutes nationality verbatim', () => {
    const ctx = { ...baseCtx, nationality: 'Plutonian' };
    const line = buildArrivalNarrative(ctx, () => 0);
    expect(line).toContain('Plutonian');
  });
});

describe('buildArrivalNarrative — determinism + variety', () => {
  it('is deterministic for the same RNG and context', () => {
    const a = buildArrivalNarrative(baseCtx, () => 0.42);
    const b = buildArrivalNarrative(baseCtx, () => 0.42);
    expect(a).toBe(b);
  });

  it('produces multiple distinct lines across the RNG range', () => {
    let lcg = 1;
    const rng = () => { lcg = (lcg * 1664525 + 1013904223) % 4294967296; return lcg / 4294967296; };
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(buildArrivalNarrative(baseCtx, rng));
    // WITH_DECEASED has 5 templates; sampling 50× should hit at least 3.
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });

  it('never returns an empty string for any combo', () => {
    const combos: ArrivalContext[] = [
      baseCtx,
      { ...baseCtx, incineratedPlayerName: null },
      { ...baseCtx, age: 16, position: 'GK' },
      { ...baseCtx, nationality: 'Earthian', position: 'DF' },
    ];
    for (const ctx of combos) {
      const line = buildArrivalNarrative(ctx, () => 0);
      expect(line.length).toBeGreaterThan(0);
    }
  });
});

describe('NEW_ARRIVAL_KIND constant', () => {
  it('matches the NewsFeedPage filter key', () => {
    expect(NEW_ARRIVAL_KIND).toBe('new_arrival');
  });
});
