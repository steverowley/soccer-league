// ── appearance.test.ts ──────────────────────────────────────────────────────
// Verifies that per-player looks are deterministic, valid, and varied, and that
// the documented invariants hold (bald ⇒ no hair, antennae only on aliens).

import { describe, it, expect } from 'vitest';

import {
  SKIN_TONES,
  HUMAN_SKIN_COUNT,
  HAIR_COLORS,
  HAT_COLORS,
  hashStringToSeed,
  makeAppearance,
} from './appearance';

describe('hashStringToSeed', () => {
  it('is stable and distinguishes different ids', () => {
    expect(hashStringToSeed('abc')).toBe(hashStringToSeed('abc'));
    expect(hashStringToSeed('abc')).not.toBe(hashStringToSeed('abd'));
  });
});

describe('makeAppearance', () => {
  it('is deterministic for a given id', () => {
    expect(makeAppearance('player-123')).toEqual(makeAppearance('player-123'));
  });

  it('always yields valid palette members', () => {
    for (let i = 0; i < 200; i++) {
      const a = makeAppearance(`id-${i}`);
      expect(SKIN_TONES).toContain(a.skin);
      if (a.hair !== null) expect(HAIR_COLORS).toContain(a.hair);
      if (a.hatColor !== null) expect(HAT_COLORS).toContain(a.hatColor);
      expect(['slim', 'stocky']).toContain(a.build);
      expect(['bald', 'short', 'flat', 'spiky', 'long']).toContain(a.style);
      expect(['none', 'cap', 'beanie', 'tall', 'band']).toContain(a.hat);
    }
  });

  it('keeps invariants: bald ⇒ no hair, bare-headed ⇒ no hat colour, antennae ⇒ alien', () => {
    for (let i = 0; i < 300; i++) {
      const a = makeAppearance(`x-${i}`);
      if (a.style === 'bald') expect(a.hair).toBeNull();
      if (a.hat === 'none') expect(a.hatColor).toBeNull();
      if (a.antennae) {
        const idx = SKIN_TONES.indexOf(a.skin);
        expect(idx).toBeGreaterThanOrEqual(HUMAN_SKIN_COUNT); // antennae only on alien tones
      }
    }
  });

  it('produces a varied crowd (not all identical)', () => {
    const looks = new Set<string>();
    for (let i = 0; i < 50; i++) looks.add(JSON.stringify(makeAppearance(`crowd-${i}`)));
    // 50 ids should yield many distinct appearances, not a single repeated look.
    expect(looks.size).toBeGreaterThan(20);
  });
});
