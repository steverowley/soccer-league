// ── entities/logic/entityProfile.test.ts ────────────────────────────────────
// Guards the profile schema registry: valid content parses, malformed content
// fails loud, and the kind guard correctly partitions profiled vs unprofiled
// kinds. These are the invariants the seed pipeline relies on.

import { describe, expect, it } from 'vitest';

import { isProfiledKind, parseProfile, PROFILE_SCHEMAS } from './entityProfile';

const validPlayer = {
  gender: 'Male',
  race: 'Human',
  appearance: 'Tall',
  bio: 'A player.',
  personality: 'Calm.',
  political_leaning: 'Centrist',
  culture: 'Loyal',
  achievements: ['Cap'],
  injuries: 'Fully fit.',
};

const validTeam = {
  date_founded: 'Old',
  fans_nickname: 'The Faithful',
  number_of_fans: 'Many',
  badge: 'A crest',
  home_kit: 'Blue',
  away_kit: 'White',
  third_kit: 'Black',
  history: 'Long.',
  club_culture: 'Proud',
  political_leaning: 'Establishment',
  trophy_cabinet: ['Cup'],
  legends: ['Someone'],
  achievements: ['Title'],
};

describe('isProfiledKind', () => {
  it('returns true for kinds with a registered schema', () => {
    expect(isProfiledKind('player')).toBe(true);
    expect(isProfiledKind('team')).toBe(true);
    expect(isProfiledKind('stadium')).toBe(true);
  });

  it('returns false for kinds without a profile schema', () => {
    expect(isProfiledKind('planet')).toBe(false);
    expect(isProfiledKind('not_a_kind')).toBe(false);
  });
});

describe('parseProfile', () => {
  it('accepts a well-formed player profile', () => {
    expect(() => parseProfile('player', validPlayer)).not.toThrow();
  });

  it('accepts a well-formed team profile', () => {
    expect(() => parseProfile('team', validTeam)).not.toThrow();
  });

  it('rejects a player profile missing a required field', () => {
    const { bio: _bio, ...missingBio } = validPlayer;
    expect(() => parseProfile('player', missingBio)).toThrow();
  });

  it('rejects a profile with a wrong-typed field', () => {
    expect(() => parseProfile('player', { ...validPlayer, achievements: 'not-an-array' })).toThrow();
  });

  it('rejects a manager profile with a non-numeric age', () => {
    const manager = {
      gender: 'Female',
      race: 'Human',
      age: 'fifty',
      nationality: 'Earthian',
      appearance: 'x',
      bio: 'x',
      personality: 'x',
      political_leaning: 'x',
      culture: 'x',
      achievements: [],
      playing_history: 'x',
      playing_philosophy: 'x',
    };
    expect(() => parseProfile('manager', manager)).toThrow();
  });
});

describe('PROFILE_SCHEMAS registry', () => {
  it('shares one schema between sports_writer and journalist', () => {
    expect(PROFILE_SCHEMAS.sports_writer).toBe(PROFILE_SCHEMAS.journalist);
  });

  it('shares one schema between commentator and pundit', () => {
    expect(PROFILE_SCHEMAS.commentator).toBe(PROFILE_SCHEMAS.pundit);
  });
});
