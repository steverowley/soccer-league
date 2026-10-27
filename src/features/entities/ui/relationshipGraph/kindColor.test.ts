// ── kindColor.test.ts ──────────────────────────────────────────────────────
// Unit tests for the entity-kind -> tier, glyph and token-colour mapping.
//
// These pin the documented map (see kindColor.ts) and the design-language
// rule behind it: an entity kind is never drawn in red (live or error),
// orange (the primary action) or green (a good outcome), and purple belongs
// to the cosmic voices alone.

import { describe, it, expect } from 'vitest';

import { color } from '../../../../shared/design';
import { kindColor, kindShape, kindTier, KIND_TIER_LABEL } from './kindColor';

describe('kindTier', () => {
  it('groups every known kind into its tier', () => {
    expect(kindTier('player')).toBe('player');
    expect(kindTier('team')).toBe('club');
    for (const k of ['manager', 'managing_staff']) expect(kindTier(k)).toBe('staff');
    for (const k of ['pundit', 'commentator', 'journalist', 'sports_writer', 'media_company', 'social_media']) {
      expect(kindTier(k)).toBe('media');
    }
    for (const k of ['referee', 'association', 'officials_association']) expect(kindTier(k)).toBe('officials');
    for (const k of ['politician', 'political_party', 'political_body', 'bookie']) expect(kindTier(k)).toBe('politics');
    for (const k of ['planet', 'colony', 'stadium', 'training_facility']) expect(kindTier(k)).toBe('place');
    expect(kindTier('cosmic_voice')).toBe('cosmic');
  });

  it('falls back to other for unknown or future kinds', () => {
    expect(kindTier('cyborg_overlord')).toBe('other');
    expect(kindTier('')).toBe('other');
  });
});

describe('kindShape', () => {
  it('draws each tier with its own glyph', () => {
    expect(kindShape('player')).toBe('circle');
    expect(kindShape('team')).toBe('shield');
    expect(kindShape('manager')).toBe('square');
    expect(kindShape('pundit')).toBe('diamond');
    expect(kindShape('referee')).toBe('triangle');
    expect(kindShape('bookie')).toBe('triangleDown');
    expect(kindShape('stadium')).toBe('ring');
  });
});

describe('kindColor', () => {
  it('uses only the text tones, plus architect for the cosmic voices', () => {
    expect(kindColor('player')).toBe(color.text);
    expect(kindColor('manager')).toBe(color.text);
    expect(kindColor('pundit')).toBe(color.textSecondary);
    expect(kindColor('politician')).toBe(color.textSecondary);
    expect(kindColor('planet')).toBe(color.textTertiary);
    expect(kindColor('cosmic_voice')).toBe(color.architect);
    expect(kindColor('')).toBe(color.textTertiary);
  });

  it('never draws a kind in live red, action orange or success green', () => {
    const kinds = [
      'player', 'team', 'manager', 'managing_staff', 'pundit', 'commentator', 'journalist',
      'sports_writer', 'media_company', 'social_media', 'referee', 'association',
      'officials_association', 'politician', 'political_party', 'political_body', 'bookie',
      'planet', 'colony', 'stadium', 'training_facility', 'cosmic_voice', 'unknown',
    ];
    for (const k of kinds) {
      expect([color.live, color.action, color.success]).not.toContain(kindColor(k));
    }
  });

  it('keeps purple for the cosmic voices alone', () => {
    const purple = KIND_TIER_LABEL.filter(([tier]) => tier !== 'cosmic').map(([tier]) => tier);
    for (const tier of purple) {
      const sample = { player: 'player', club: 'team', staff: 'manager', media: 'pundit', officials: 'referee', politics: 'bookie', place: 'planet', cosmic: 'cosmic_voice', other: 'x' }[tier];
      expect(kindColor(sample)).not.toBe(color.architect);
    }
  });
});
