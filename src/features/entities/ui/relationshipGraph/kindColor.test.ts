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

  it('returns ASTRO for club-adjacent people (warm orange tier)', () => {
    expect(kindColor('manager')).toBe(COLORS.astro);
    expect(kindColor('managing_staff')).toBe(COLORS.astro);
    expect(kindColor('journalist')).toBe(COLORS.astro);
    expect(kindColor('sports_writer')).toBe(COLORS.astro);
  });

  it('returns QUANTUM for the commentary and media family', () => {
    expect(kindColor('pundit')).toBe(COLORS.quantum);
    expect(kindColor('commentator')).toBe(COLORS.quantum);
    expect(kindColor('media_company')).toBe(COLORS.quantum);
    expect(kindColor('social_media')).toBe(COLORS.quantum);
  });

  it('returns TERRA NOVA for officiating + governance (positive authority)', () => {
    expect(kindColor('referee')).toBe(COLORS.terraNova);
    expect(kindColor('association')).toBe(COLORS.terraNova);
    expect(kindColor('officials_association')).toBe(COLORS.terraNova);
  });

  it('returns FLARE for risk/disruption kinds (bookies + political tier)', () => {
    expect(kindColor('bookie')).toBe(COLORS.flare);
    expect(kindColor('political_body')).toBe(COLORS.flare);
    expect(kindColor('political_party')).toBe(COLORS.flare);
    expect(kindColor('politician')).toBe(COLORS.flare);
  });

  // ── Team (isl-3ov) ───────────────────────────────────────────────────
  // Clubs use the astro hue to read as their own identity tier —
  // distinct from quantum (commentary) and flare (risk).
  it('returns ASTRO for the team kind (shadow team entities)', () => {
    expect(kindColor('team')).toBe(COLORS.astro);
  });

  // ── Places and venues ────────────────────────────────────────────────
  // Stadiums share DUST 70 with planets (both are physical locations that
  // frame activity without themselves acting).  Training facilities and
  // colonies sit at the quietest DUST 50 tier.
  it('returns muted DUST tints for places and venues', () => {
    expect(kindColor('planet')).toBe(COLORS.dust70);
    expect(kindColor('stadium')).toBe(COLORS.dust70);
    expect(kindColor('colony')).toBe(COLORS.dust50);
    expect(kindColor('training_facility')).toBe(COLORS.dust50);
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
