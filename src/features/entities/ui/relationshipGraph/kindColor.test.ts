// ── kindColor.test.ts ──────────────────────────────────────────────────────
// Unit tests for the entity-kind → palette colour mapping.
//
// These tests pin the documented map so a future palette tweak that
// renames a token (or a kind addition with the wrong fallback) gets
// caught in CI rather than landing as a colour drift in production.

import { describe, it, expect } from 'vitest';

import { COLORS } from '../../../../components/Layout';
import { kindColor } from './kindColor';

describe('kindColor', () => {
  // ── People mappings ───────────────────────────────────────────────────
  it('returns DUST for the canonical player kind', () => {
    expect(kindColor('player')).toBe(COLORS.dust);
  });

  it('returns ASTRO for managers and journalists (warm orange tier)', () => {
    expect(kindColor('manager')).toBe(COLORS.astro);
    expect(kindColor('journalist')).toBe(COLORS.astro);
  });

  it('returns QUANTUM for the commentary family', () => {
    expect(kindColor('pundit')).toBe(COLORS.quantum);
    expect(kindColor('commentator')).toBe(COLORS.quantum);
    expect(kindColor('media_company')).toBe(COLORS.quantum);
  });

  it('returns TERRA NOVA for officiating + governance (positive authority)', () => {
    expect(kindColor('referee')).toBe(COLORS.terraNova);
    expect(kindColor('association')).toBe(COLORS.terraNova);
  });

  it('returns FLARE for risk/disruption kinds (bookies + political bodies)', () => {
    expect(kindColor('bookie')).toBe(COLORS.flare);
    expect(kindColor('political_body')).toBe(COLORS.flare);
  });

  // ── Places ────────────────────────────────────────────────────────────
  it('returns muted DUST tints for places', () => {
    expect(kindColor('planet')).toBe(COLORS.dust70);
    expect(kindColor('colony')).toBe(COLORS.dust50);
  });

  // ── Fallback ──────────────────────────────────────────────────────────
  it('falls back to DUST 70 for unknown / future kinds', () => {
    expect(kindColor('coach')).toBe(COLORS.dust70);
    expect(kindColor('physio')).toBe(COLORS.dust70);
    expect(kindColor('doctor')).toBe(COLORS.dust70);
    expect(kindColor('owner')).toBe(COLORS.dust70);
    expect(kindColor('analyst')).toBe(COLORS.dust70);
    expect(kindColor('scout')).toBe(COLORS.dust70);
    // Hypothetical future kind — still renders, no exception thrown.
    expect(kindColor('cyborg_overlord')).toBe(COLORS.dust70);
    expect(kindColor('')).toBe(COLORS.dust70);
  });
});
