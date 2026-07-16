// ── appearance.test.ts ───────────────────────────────────────────────────────
// The sprite foundry must be DETERMINISTIC (same input → same sprite forever),
// stay inside the monochrome phosphor palette, honour explicit + parsed hints,
// and still produce a varied crowd.  These tests lock those contracts.

import { describe, it, expect } from 'vitest';

import {
  HAIR_TONE,
  SPECIES,
  SPECIES_KEYS,
  hashStringToSeed,
  makeAppearance,
  parseDescription,
} from './appearance';

/** A pile of realistic-ish ids for distribution checks. */
const IDS = Array.from({ length: 200 }, (_, i) => `player-${i}-${(i * 2654435761) >>> 0}`);

describe('hashStringToSeed', () => {
  it('is stable and distinguishes different ids', () => {
    expect(hashStringToSeed('abc')).toBe(hashStringToSeed('abc'));
    expect(hashStringToSeed('abc')).not.toBe(hashStringToSeed('abd'));
  });
});

describe('makeAppearance', () => {
  it('is deterministic for a given id (string and hints forms agree)', () => {
    expect(makeAppearance('some-uuid')).toEqual(makeAppearance('some-uuid'));
    expect(makeAppearance('some-uuid')).toEqual(makeAppearance({ name: 'some-uuid' }));
  });

  it('always yields a valid species / build / hair combination', () => {
    for (const id of IDS) {
      const a = makeAppearance(id);
      expect(SPECIES_KEYS).toContain(a.species);
      expect(['slim', 'stocky']).toContain(a.build);
      if (a.style === 'bald') {
        expect(a.hair).toBeNull();
      } else {
        // Hair shade must be one of the phosphor tones — never an off-palette dye.
        expect(a.hair).toBe(HAIR_TONE[a.style]);
      }
    }
  });

  it('only terrans grow hair (every other species is bald)', () => {
    for (const id of IDS) {
      const a = makeAppearance(id);
      if (!SPECIES[a.species].hair) {
        expect(a.style).toBe('bald');
        expect(a.hair).toBeNull();
      }
    }
  });

  it('explicit hints override the random draw', () => {
    const a = makeAppearance({ name: 'x', species: 'cyclops', build: 'stocky' });
    expect(a.species).toBe('cyclops');
    expect(a.build).toBe('stocky');
    expect(a.style).toBe('bald'); // cyclopes don't grow hair even if the draw says otherwise
  });

  it('mines species / build / hair hints out of a text description', () => {
    const a = makeAppearance({ name: 'y', text: 'a burly one-eyed brute from the outer belt' });
    expect(a.species).toBe('cyclops');
    expect(a.build).toBe('stocky');
  });

  it('produces a varied crowd (not all identical)', () => {
    const species = new Set(IDS.map((id) => makeAppearance(id).species));
    const builds = new Set(IDS.map((id) => makeAppearance(id).build));
    expect(species.size).toBeGreaterThan(3);
    expect(builds.size).toBe(2);
  });
});

describe('parseDescription', () => {
  it('matches exact species names first', () => {
    expect(parseDescription('a proud trinocular midfielder').species).toBe('trinocular');
  });

  it('matches synonyms when no exact name appears', () => {
    expect(parseDescription('a mantis-like winger with chitin plating').species).toBe('insectoid');
    expect(parseDescription('classic grey abductor energy').species).toBe('grey');
  });

  it('maps body and hair words onto build / style', () => {
    expect(parseDescription('a wiry striker').build).toBe('slim');
    expect(parseDescription('flowing mane of a striker').hair).toBe('long');
    expect(parseDescription('shaven-headed enforcer, broad as a shuttle').hair).toBe('bald');
  });

  it('returns no hints for plain text', () => {
    expect(parseDescription('scores goals sometimes')).toEqual({});
  });
});
