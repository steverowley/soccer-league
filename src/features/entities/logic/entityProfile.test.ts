// ── entities/logic/entityProfile.test.ts ────────────────────────────────────
// Guards the profile schema registry: valid content parses, malformed content
// fails loud, and the kind guard correctly partitions profiled vs unprofiled
// kinds. These are the invariants the seed pipeline relies on.

import { describe, expect, it } from 'vitest';

import { SPECIES } from '../../../data/peoples';

import { isProfiledKind, parseProfile, parseStoredProfile, PROFILE_SCHEMAS } from './entityProfile';

const validPlayer = {
  gender: 'Male',
  race: 'Human',
  species: 'terran',
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

describe('player profile species (authoring)', () => {
  it('accepts every one of the canonical peoples', () => {
    for (const species of SPECIES) {
      expect(() => parseProfile('player', { ...validPlayer, species })).not.toThrow();
    }
  });

  it('requires species on an authored player profile', () => {
    const { species: _species, ...noSpecies } = validPlayer;
    expect(() => parseProfile('player', noSpecies)).toThrow();
  });

  it('rejects a species that is not one of the peoples', () => {
    expect(() => parseProfile('player', { ...validPlayer, species: 'martian' })).toThrow();
  });
});

describe('parseStoredProfile (profiles read back from the database)', () => {
  it('accepts a full profile written before the peoples backfill (no species)', () => {
    const { species: _species, ...preBackfill } = validPlayer;
    const out = parseStoredProfile('player', preBackfill) as Record<string, unknown>;
    expect(out['bio']).toBe('A player.');
    expect(out['species']).toBeUndefined();
  });

  it('keeps the bio but drops an unrecognised species on a full profile', () => {
    const out = parseStoredProfile('player', { ...validPlayer, species: 'martian' }) as Record<string, unknown>;
    expect(out['bio']).toBe('A player.');
    expect(out['species']).toBeUndefined();
  });

  it('accepts a new signing\'s identity-only profile { race, species }', () => {
    const out = parseStoredProfile('player', { race: 'Cephalid (Europa)', species: 'cephalid' });
    expect(out).toEqual({ race: 'Cephalid (Europa)', species: 'cephalid' });
  });

  it('still rejects a drifted profile that is neither shape', () => {
    expect(() => parseStoredProfile('player', { bio: 'incomplete' })).toThrow();
    expect(() => parseStoredProfile('player', { race: 'Grey (Kuiper)', species: 'martian' })).toThrow();
  });

  it('validates other kinds exactly like parseProfile', () => {
    expect(() => parseStoredProfile('team', validTeam)).not.toThrow();
    expect(() => parseStoredProfile('team', { history: 'x' })).toThrow();
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
