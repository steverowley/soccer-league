// ── voting/logic/replacementPlayer.test.ts ───────────────────────────────────
// Unit tests for the Election Night replacement-player generator.
//
// COVERAGE INTENT
//   • Generated row matches the players-table column shape.
//   • Position is preserved verbatim from context.
//   • Age / overall_rating fall within the tunable ranges.
//   • Name mixes word-tokens from the surviving roster.
//   • Empty roster falls back to a literal placeholder rather than crashing.
//   • Determinism — same RNG, same output.
//   • Personality is always a valid PERS value.

import { describe, expect, it } from 'vitest';
import { PERS } from '../../../constants';
import {
  buildReplacementPlayer,
  generateReplacementName,
  type TeammateNameSeed,
} from './replacementPlayer';

const VALID_PERSONALITIES = new Set<string>(Object.values(PERS));

const MARS_ROSTER: TeammateNameSeed[] = [
  { name: 'Flux Ito',     nationality: 'Martian' },
  { name: 'Lira Steele',  nationality: 'Martian' },
  { name: 'Kael Volkov',  nationality: 'Martian' },
  { name: 'Vex Kowalski', nationality: 'Martian' },
];

// Deterministic RNGs for snapshot-style assertions.
const FIRST_RNG = (): number => 0;
const LAST_RNG  = (): number => 0.9999;

describe('generateReplacementName', () => {
  it('returns a literal placeholder when the roster is empty', () => {
    expect(generateReplacementName([], FIRST_RNG)).toBe('New Arrival');
  });

  it('builds a name by mixing first and last word pools', () => {
    const name = generateReplacementName(MARS_ROSTER, FIRST_RNG);
    const [first, last] = name.split(' ');
    const firstPool = MARS_ROSTER.map(t => t.name.split(' ')[0]!);
    const lastPool  = MARS_ROSTER.map(t => t.name.split(' ')[1]!);
    expect(firstPool).toContain(first);
    expect(lastPool).toContain(last);
  });

  it('is deterministic across repeated calls with the same RNG', () => {
    const a = generateReplacementName(MARS_ROSTER, FIRST_RNG);
    const b = generateReplacementName(MARS_ROSTER, FIRST_RNG);
    expect(a).toBe(b);
  });

  it('produces different names when seeded to first vs last pool entry', () => {
    expect(generateReplacementName(MARS_ROSTER, FIRST_RNG)).not.toBe(
      generateReplacementName(MARS_ROSTER, LAST_RNG),
    );
  });
});

describe('buildReplacementPlayer', () => {
  it('returns a row matching the players-table shape', () => {
    const player = buildReplacementPlayer(
      {
        teamId:              'mars-athletic',
        position:            'FW',
        teammates:           MARS_ROSTER,
        fallbackNationality: 'Martian',
      },
      FIRST_RNG,
    );
    expect(player).toMatchObject({
      team_id:  'mars-athletic',
      position: 'FW',
      starter:  false,
    });
    expect(typeof player.name).toBe('string');
    expect(player.name.length).toBeGreaterThan(0);
    expect(typeof player.nationality).toBe('string');
  });

  it('preserves the position from context', () => {
    for (const pos of ['GK', 'DF', 'MF', 'FW']) {
      const p = buildReplacementPlayer({
        teamId: 'mars-athletic', position: pos,
        teammates: MARS_ROSTER, fallbackNationality: 'Martian',
      }, FIRST_RNG);
      expect(p.position).toBe(pos);
    }
  });

  it('clamps age within the 16–21 design window', () => {
    // Sample 100 generations with varied RNG values to confirm the range.
    let lcg = 1; // simple LCG so each call returns a different value
    const rng = () => { lcg = (lcg * 1664525 + 1013904223) % 4294967296; return lcg / 4294967296; };
    for (let i = 0; i < 100; i++) {
      const p = buildReplacementPlayer({
        teamId: 'mars-athletic', position: 'MF',
        teammates: MARS_ROSTER, fallbackNationality: 'Martian',
      }, rng);
      expect(p.age).toBeGreaterThanOrEqual(16);
      expect(p.age).toBeLessThanOrEqual(21);
    }
  });

  it('clamps overall_rating within the 60–72 rookie band', () => {
    let lcg = 7;
    const rng = () => { lcg = (lcg * 1664525 + 1013904223) % 4294967296; return lcg / 4294967296; };
    for (let i = 0; i < 100; i++) {
      const p = buildReplacementPlayer({
        teamId: 'mars-athletic', position: 'GK',
        teammates: MARS_ROSTER, fallbackNationality: 'Martian',
      }, rng);
      expect(p.overall_rating).toBeGreaterThanOrEqual(60);
      expect(p.overall_rating).toBeLessThanOrEqual(72);
    }
  });

  it('always assigns a personality from the PERS enum', () => {
    let lcg = 13;
    const rng = () => { lcg = (lcg * 1664525 + 1013904223) % 4294967296; return lcg / 4294967296; };
    for (let i = 0; i < 50; i++) {
      const p = buildReplacementPlayer({
        teamId: 'mars-athletic', position: 'MF',
        teammates: MARS_ROSTER, fallbackNationality: 'Martian',
      }, rng);
      expect(VALID_PERSONALITIES.has(p.personality)).toBe(true);
    }
  });

  it('inherits nationality from a surviving teammate', () => {
    const p = buildReplacementPlayer({
      teamId: 'mars-athletic', position: 'FW',
      teammates: MARS_ROSTER, fallbackNationality: 'unknown',
    }, FIRST_RNG);
    expect(p.nationality).toBe('Martian');
  });

  it('falls back to fallbackNationality when no teammate has one set', () => {
    const noNationalityRoster: TeammateNameSeed[] = [
      { name: 'Ghost One', nationality: null },
      { name: 'Ghost Two', nationality: null },
    ];
    const p = buildReplacementPlayer({
      teamId: 'mars-athletic', position: 'DF',
      teammates: noNationalityRoster, fallbackNationality: 'Martian',
    }, FIRST_RNG);
    expect(p.nationality).toBe('Martian');
  });

  it('falls back gracefully when the roster is empty', () => {
    const p = buildReplacementPlayer({
      teamId: 'mars-athletic', position: 'FW',
      teammates: [], fallbackNationality: 'Martian',
    }, FIRST_RNG);
    expect(p.name).toBe('New Arrival');
    expect(p.nationality).toBe('Martian');
  });

  it('is deterministic across repeated calls with the same RNG', () => {
    const ctx = {
      teamId: 'mars-athletic', position: 'FW',
      teammates: MARS_ROSTER, fallbackNationality: 'Martian',
    };
    const a = buildReplacementPlayer(ctx, FIRST_RNG);
    const b = buildReplacementPlayer(ctx, FIRST_RNG);
    expect(a).toEqual(b);
  });
});
