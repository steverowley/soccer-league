// Contract tests for the peoples table: every club has a mix that fills a
// squad exactly, assignment is deterministic and honours the mix, and race
// lines read correctly.

import { describe, expect, it } from 'vitest';

import { TEAMS_BY_LEAGUE } from './leagueData';
import {
  MIX_SQUAD_SIZE,
  PEOPLE,
  SPECIES,
  SQUAD_MIX,
  assignSquadSpecies,
  isSpecies,
  raceLine,
  speciesForNewPlayer,
  type Species,
} from './peoples';

const clubIds = Object.values(TEAMS_BY_LEAGUE).flat().map((t) => t.id);
const ids = (n: number, prefix = 'p') => Array.from({ length: n }, (_, i) => `${prefix}-${String(i).padStart(3, '0')}`);

describe('peoples table', () => {
  it('has eleven peoples, each named', () => {
    expect(SPECIES).toHaveLength(11);
    for (const s of SPECIES) expect(PEOPLE[s].name.length).toBeGreaterThan(0);
  });

  it('gives every club in leagueData a mix, and no mix for an unknown club', () => {
    expect(clubIds).toHaveLength(32);
    expect(Object.keys(SQUAD_MIX).sort()).toEqual([...clubIds].sort());
  });

  it('fills a 16-player squad exactly for every club', () => {
    for (const id of clubIds) {
      const total = Object.values(SQUAD_MIX[id]!).reduce((a, b) => a + (b ?? 0), 0);
      expect(total, id).toBe(MIX_SQUAD_SIZE);
    }
  });

  it('only uses known species in mixes', () => {
    for (const mix of Object.values(SQUAD_MIX)) for (const k of Object.keys(mix)) expect(isSpecies(k), k).toBe(true);
  });
});

describe('assignSquadSpecies', () => {
  it('honours the mix exactly for a squad of 16', () => {
    const got = assignSquadSpecies('europa-oceanic', ids(16));
    const counts: Partial<Record<Species, number>> = {};
    for (const s of got.values()) counts[s] = (counts[s] ?? 0) + 1;
    expect(counts).toEqual(SQUAD_MIX['europa-oceanic']);
  });

  it('does not depend on input order', () => {
    const a = assignSquadSpecies('pluto-frost', ids(16));
    const b = assignSquadSpecies('pluto-frost', ids(16).reverse());
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
  });

  it('makes extra players Terran and treats unknown clubs as all-Terran', () => {
    const got = assignSquadSpecies('psyche-metallics', ids(17));
    const counts = [...got.values()].filter((s) => s === 'terran').length;
    expect(counts).toBe((SQUAD_MIX['psyche-metallics']!.terran ?? 0) + 1);
    expect(new Set(assignSquadSpecies('nowhere-fc', ids(5)).values())).toEqual(new Set(['terran']));
  });
});

describe('speciesForNewPlayer', () => {
  it('is stable for a player and only draws peoples in the club mix', () => {
    for (const id of ids(200, 'n')) {
      const s = speciesForNewPlayer('venus-volcanic', id);
      expect(s).toBe(speciesForNewPlayer('venus-volcanic', id));
      expect(Object.keys(SQUAD_MIX['venus-volcanic']!)).toContain(s);
    }
  });

  it('roughly follows the mix proportions', () => {
    const n = 4000;
    let ignid = 0;
    for (const id of ids(n, 'm')) if (speciesForNewPlayer('venus-volcanic', id) === 'ignid') ignid++;
    expect(ignid / n).toBeGreaterThan(9 / 16 - 0.05);
    expect(ignid / n).toBeLessThan(9 / 16 + 0.05);
  });
});

describe('raceLine', () => {
  it('keeps a Terran line and names other peoples with their homeworld', () => {
    expect(raceLine('terran', 'Human (Mars-adapted)')).toBe('Human (Mars-adapted)');
    expect(raceLine('terran', null)).toBe('Human');
    expect(raceLine('cephalid', 'Human (Europa-adapted)')).toBe('Cephalid (Europa)');
    expect(raceLine('grey')).toBe('Grey (Kuiper)');
  });

  it('never writes an em dash', () => {
    for (const s of SPECIES) expect(raceLine(s, 'Human')).not.toMatch(/\u2014/);
  });
});
