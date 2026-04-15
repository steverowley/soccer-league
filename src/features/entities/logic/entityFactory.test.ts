// ── entityFactory.test.ts ───────────────────────────────────────────────────
// WHY: Unit tests for the pure entity/trait/relationship factory functions.
// These tests pin down the canonical row shapes for every entity kind — if
// a factory's output drifts from the shape used in 0002_entities.sql the
// Architect's context hydration will silently render malformed data, which
// is hard to detect from runtime alone. These tests catch drift at CI time.

import { describe, it, expect } from 'vitest';
import {
  clampStrength,
  createAssociationEntity,
  createBookieEntity,
  createEntity,
  createJournalistEntity,
  createManagerEntity,
  createMediaCompanyEntity,
  createMutualRelationship,
  createPlayerEntity,
  createPunditEntity,
  createRefereeEntity,
  createRelationship,
  createTrait,
  createTraits,
  STRENGTH_MAX,
  STRENGTH_MIN,
} from './entityFactory';

// ── clampStrength ───────────────────────────────────────────────────────────

describe('clampStrength', () => {
  it('returns the input when already in range', () => {
    expect(clampStrength(0)).toBe(0);
    expect(clampStrength(42)).toBe(42);
    expect(clampStrength(-42)).toBe(-42);
  });

  it('clamps values above the max', () => {
    expect(clampStrength(200)).toBe(STRENGTH_MAX);
    expect(clampStrength(101)).toBe(STRENGTH_MAX);
  });

  it('clamps values below the min', () => {
    expect(clampStrength(-200)).toBe(STRENGTH_MIN);
    expect(clampStrength(-101)).toBe(STRENGTH_MIN);
  });

  it('rounds non-integer inputs before clamping', () => {
    expect(clampStrength(1.7)).toBe(2);
    expect(clampStrength(-1.4)).toBe(-1);
  });

  it('accepts the exact boundaries', () => {
    expect(clampStrength(STRENGTH_MAX)).toBe(STRENGTH_MAX);
    expect(clampStrength(STRENGTH_MIN)).toBe(STRENGTH_MIN);
  });
});

// ── createEntity ────────────────────────────────────────────────────────────

describe('createEntity', () => {
  it('produces a row with kind, name, display_name, and empty meta by default', () => {
    const row = createEntity({ kind: 'referee', name: 'Orion Blackwood' });
    expect(row).toEqual({
      kind: 'referee',
      name: 'Orion Blackwood',
      display_name: 'Orion Blackwood',
      meta: {},
    });
  });

  it('uses the supplied display_name when provided', () => {
    const row = createEntity({
      kind: 'referee',
      name: 'Orion Blackwood',
      display_name: 'O. Blackwood',
    });
    expect(row.display_name).toBe('O. Blackwood');
  });

  it('trims whitespace from name and display_name', () => {
    const row = createEntity({
      kind: 'pundit',
      name: '  Rex Valorum  ',
      display_name: '  Rex V.  ',
    });
    expect(row.name).toBe('Rex Valorum');
    expect(row.display_name).toBe('Rex V.');
  });

  it('falls back to trimmed name when display_name is whitespace-only', () => {
    const row = createEntity({
      kind: 'pundit',
      name: 'Rex Valorum',
      display_name: '   ',
    });
    expect(row.display_name).toBe('Rex Valorum');
  });

  it('throws when name is empty after trimming', () => {
    expect(() => createEntity({ kind: 'player', name: '   ' })).toThrow(/non-empty/);
  });

  it('does not leak input meta object reference into the row', () => {
    const meta = { homeworld: 'Earth' };
    const row = createEntity({ kind: 'referee', name: 'X', meta });
    meta.homeworld = 'Mars'; // mutate caller's object
    expect(row.meta).toEqual({ homeworld: 'Earth' }); // row stays untouched
  });
});

// ── Kind-specific factories ─────────────────────────────────────────────────

describe('createPlayerEntity', () => {
  it('matches the backfill shape from 0002_entities.sql', () => {
    const row = createPlayerEntity({
      name: 'Kael Vorn',
      team_id: 'mars-athletic',
      position: 'FWD',
      nationality: 'Martian',
    });
    expect(row.kind).toBe('player');
    expect(row.name).toBe('Kael Vorn');
    expect(row.meta).toEqual({
      team_id: 'mars-athletic',
      position: 'FWD',
      nationality: 'Martian',
    });
  });

  it('stores nationality as null when omitted', () => {
    const row = createPlayerEntity({
      name: 'Zyx Alpha',
      team_id: 'jupiter-royals',
      position: 'GK',
    });
    expect(row.meta).toEqual({
      team_id: 'jupiter-royals',
      position: 'GK',
      nationality: null,
    });
  });
});

describe('createManagerEntity', () => {
  it('matches the manager backfill shape', () => {
    const row = createManagerEntity({
      name: 'Coach Nexus',
      team_id: 'saturn-rings',
      nationality: 'Saturnian',
    });
    expect(row.kind).toBe('manager');
    expect(row.meta).toEqual({
      team_id: 'saturn-rings',
      nationality: 'Saturnian',
    });
  });
});

describe('createRefereeEntity', () => {
  it('defaults corps to IEOB', () => {
    const row = createRefereeEntity({
      name: 'Vega Castellano',
      display_name: 'V. Castellano',
      homeworld: 'Mars',
    });
    expect(row.kind).toBe('referee');
    expect(row.display_name).toBe('V. Castellano');
    expect(row.meta).toEqual({ corps: 'IEOB', homeworld: 'Mars' });
  });

  it('allows overriding the corps for future expansion', () => {
    const row = createRefereeEntity({
      name: 'Alt Ref',
      homeworld: 'Pluto',
      corps: 'KUIPER_GUILD',
    });
    expect(row.meta).toEqual({ corps: 'KUIPER_GUILD', homeworld: 'Pluto' });
  });
});

describe('createPunditEntity', () => {
  it('matches the seed pundit shape (specialty + era + homeworld)', () => {
    const row = createPunditEntity({
      name: 'Rex Valorum',
      specialty: 'tactics',
      era: 'retired_player',
      homeworld: 'Earth',
    });
    expect(row.kind).toBe('pundit');
    expect(row.meta).toEqual({
      specialty: 'tactics',
      era: 'retired_player',
      homeworld: 'Earth',
    });
  });
});

describe('createJournalistEntity', () => {
  it('carries beat and employer', () => {
    const row = createJournalistEntity({
      name: 'Iris Volkov',
      beat: 'rocky-inner',
      employer: 'GSN',
    });
    expect(row.kind).toBe('journalist');
    expect(row.meta).toEqual({ beat: 'rocky-inner', employer: 'GSN' });
  });
});

describe('createMediaCompanyEntity', () => {
  it('preserves type and reach', () => {
    const row = createMediaCompanyEntity({
      name: 'Galactic Sports Network',
      display_name: 'GSN',
      type: 'broadcaster',
      reach: 'galaxy-wide',
    });
    expect(row.kind).toBe('media_company');
    expect(row.meta).toEqual({ type: 'broadcaster', reach: 'galaxy-wide' });
  });
});

describe('createAssociationEntity', () => {
  it('carries role and description', () => {
    const row = createAssociationEntity({
      name: 'Interplanetary Soccer League',
      display_name: 'ISL',
      role: 'governing_body',
      description: 'The supreme governing body of interplanetary soccer.',
    });
    expect(row.kind).toBe('association');
    expect(row.meta).toEqual({
      role: 'governing_body',
      description: 'The supreme governing body of interplanetary soccer.',
    });
  });
});

describe('createBookieEntity', () => {
  it('defaults balance to 0', () => {
    const row = createBookieEntity({
      name: 'Galactic Sportsbook',
      description: 'The House.',
    });
    expect(row.kind).toBe('bookie');
    expect(row.meta).toEqual({ description: 'The House.', balance: 0 });
  });

  it('accepts an explicit starting balance', () => {
    const row = createBookieEntity({
      name: 'Galactic Sportsbook',
      description: 'The House.',
      balance: 5000,
    });
    expect(row.meta).toEqual({ description: 'The House.', balance: 5000 });
  });
});

// ── createTrait / createTraits ──────────────────────────────────────────────

describe('createTrait', () => {
  it('passes through primitive values unchanged', () => {
    const t = createTrait({
      entity_id: 'e1',
      trait_key: 'strictness',
      trait_value: 8,
    });
    expect(t).toEqual({ entity_id: 'e1', trait_key: 'strictness', trait_value: 8 });
  });

  it('accepts complex JSON values', () => {
    const t = createTrait({
      entity_id: 'e1',
      trait_key: 'biases',
      trait_value: { home: 0.1, away: -0.05 },
    });
    expect(t.trait_value).toEqual({ home: 0.1, away: -0.05 });
  });

  it('trims whitespace from trait_key', () => {
    const t = createTrait({
      entity_id: 'e1',
      trait_key: '  strictness  ',
      trait_value: 5,
    });
    expect(t.trait_key).toBe('strictness');
  });

  it('throws on empty trait_key', () => {
    expect(() =>
      createTrait({ entity_id: 'e1', trait_key: '  ', trait_value: 1 }),
    ).toThrow(/non-empty/);
  });
});

describe('createTraits', () => {
  it('produces one row per key in the map', () => {
    const rows = createTraits('e1', { strictness: 8, temperament: 'stoic' });
    expect(rows).toEqual([
      { entity_id: 'e1', trait_key: 'strictness', trait_value: 8 },
      { entity_id: 'e1', trait_key: 'temperament', trait_value: 'stoic' },
    ]);
  });

  it('returns an empty array for an empty map', () => {
    expect(createTraits('e1', {})).toEqual([]);
  });
});

// ── Relationships ───────────────────────────────────────────────────────────

describe('createRelationship', () => {
  it('builds a directed edge with default strength 0 and empty meta', () => {
    const r = createRelationship({
      from_id: 'a',
      to_id: 'b',
      kind: 'rival',
    });
    expect(r).toEqual({
      from_id: 'a',
      to_id: 'b',
      kind: 'rival',
      strength: 0,
      meta: {},
    });
  });

  it('clamps strength into the valid range', () => {
    const tooHigh = createRelationship({
      from_id: 'a',
      to_id: 'b',
      kind: 'friend',
      strength: 999,
    });
    expect(tooHigh.strength).toBe(STRENGTH_MAX);

    const tooLow = createRelationship({
      from_id: 'a',
      to_id: 'b',
      kind: 'enemy',
      strength: -999,
    });
    expect(tooLow.strength).toBe(STRENGTH_MIN);
  });

  it('throws when from_id === to_id', () => {
    expect(() =>
      createRelationship({ from_id: 'a', to_id: 'a', kind: 'rival' }),
    ).toThrow(/must differ/);
  });

  it('throws on empty kind', () => {
    expect(() =>
      createRelationship({ from_id: 'a', to_id: 'b', kind: '   ' }),
    ).toThrow(/non-empty/);
  });

  it('trims whitespace from kind', () => {
    const r = createRelationship({
      from_id: 'a',
      to_id: 'b',
      kind: '  mentor  ',
    });
    expect(r.kind).toBe('mentor');
  });

  it('copies meta without aliasing the caller object', () => {
    const meta = { since: 'season-1' };
    const r = createRelationship({
      from_id: 'a',
      to_id: 'b',
      kind: 'rival',
      meta,
    });
    meta.since = 'mutated';
    expect(r.meta).toEqual({ since: 'season-1' });
  });
});

describe('createMutualRelationship', () => {
  it('produces two rows with symmetric from/to', () => {
    const [ab, ba] = createMutualRelationship({
      a_id: 'a',
      b_id: 'b',
      kind: 'former_teammate',
      strength: 40,
    });
    expect(ab).toBeDefined();
    expect(ba).toBeDefined();
    expect(ab?.from_id).toBe('a');
    expect(ab?.to_id).toBe('b');
    expect(ba?.from_id).toBe('b');
    expect(ba?.to_id).toBe('a');
    expect(ab?.strength).toBe(40);
    expect(ba?.strength).toBe(40);
  });

  it('defaults strength to 0 when omitted', () => {
    const edges = createMutualRelationship({
      a_id: 'a',
      b_id: 'b',
      kind: 'acquaintance',
    });
    expect(edges[0]?.strength).toBe(0);
    expect(edges[1]?.strength).toBe(0);
  });
});
