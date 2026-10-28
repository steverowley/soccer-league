// ── features/match/logic/viewer/kits.test.ts ────────────────────────────────
// The kit rules against every real club colour and every pairing
// (docs/match-viewer.md sections 2C and 3).  The club colours come from
// src/data/leagueData.ts, the copy `teams.color` is seeded from, so a new or
// recoloured club is checked automatically.

import { describe, expect, it } from 'vitest';
import { TEAMS_BY_LEAGUE } from '../../../../data/leagueData';
import { canvasColor } from '../../../../shared/design';
import {
  CHANGE_KITS,
  CLASH_MIN_DE,
  FIGURE_MIN_DE,
  GRASS_MIN_CONTRAST,
  KEEPER_KITS,
  KEEPER_MIN_DE,
  KEEPER_MIN_GRASS_CONTRAST,
  KIT_REFERENCE,
  contrastRatio,
  deltaE,
  isLegibleKit,
  legibleKit,
  resolveKits,
  type Kit,
} from './kits';

const clubs = Object.values(TEAMS_BY_LEAGUE)
  .flat()
  .map((t) => ({ id: t.id, color: t.color }));

/** Every kit a figure can wear in one match. */
function allKits(k: ReturnType<typeof resolveKits>): Kit[] {
  return [k.home.outfield, k.home.keeper, k.away.outfield, k.away.keeper];
}

describe('colour measures', () => {
  it('match the published reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
    // CIE76 of pure red against pure green is about 170.
    expect(deltaE('#ff0000', '#00ff00')).toBeCloseTo(170.6, 0);
    expect(deltaE('#123456', '#123456')).toBe(0);
  });

  it('reproduces the measured problems the rules exist for', () => {
    const byId = Object.fromEntries(clubs.map((c) => [c.id, c.color]));
    expect(deltaE(byId['mercury-runners']!, byId['makemake']!)).toBeLessThan(15);
    expect(contrastRatio(byId['sedna-mariners']!, KIT_REFERENCE.grass)).toBeLessThan(GRASS_MIN_CONTRAST);
    expect(deltaE(byId['vesta']!, KIT_REFERENCE.figure)).toBeLessThan(FIGURE_MIN_DE);
  });
});

describe('rule 1: legibility', () => {
  it('there are 32 clubs, each with a colour', () => {
    expect(clubs).toHaveLength(32);
    for (const c of clubs) expect(c.color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it.each(clubs)('$id passes after the rule', ({ color }) => {
    const kit = legibleKit(color, canvasColor.kitHome);
    expect(contrastRatio(kit, KIT_REFERENCE.grass)).toBeGreaterThanOrEqual(GRASS_MIN_CONTRAST);
    expect(deltaE(kit, KIT_REFERENCE.figure)).toBeGreaterThanOrEqual(FIGURE_MIN_DE);
    expect(deltaE(kit, KIT_REFERENCE.ball)).toBeGreaterThanOrEqual(FIGURE_MIN_DE);
    expect(isLegibleKit(kit)).toBe(true);
  });

  it('leaves an already legible colour alone', () => {
    expect(legibleKit('#4169E1', canvasColor.kitHome)).toBe('#4169e1');
  });

  it('lifts a dark kit and deepens a pale one, keeping the hue family', () => {
    const sedna = legibleKit('#8B0000', canvasColor.kitHome);
    expect(contrastRatio(sedna, KIT_REFERENCE.grass)).toBeGreaterThan(contrastRatio('#8B0000', KIT_REFERENCE.grass));
    expect(parseInt(sedna.slice(1, 3), 16)).toBeGreaterThan(parseInt(sedna.slice(3, 5), 16)); // still red
    const vesta = legibleKit('#C0C0C0', canvasColor.kitHome);
    expect(deltaE(vesta, KIT_REFERENCE.figure)).toBeGreaterThan(deltaE('#C0C0C0', KIT_REFERENCE.figure));
  });

  it('falls back when a club has no colour', () => {
    expect(legibleKit(null, canvasColor.kitAway)).toBe(legibleKit(canvasColor.kitAway, canvasColor.kitAway));
    expect(legibleKit('not a colour', canvasColor.kitHome)).toBe(legibleKit(canvasColor.kitHome, canvasColor.kitHome));
  });

  it('the change kits and keeper kits are legible as they are', () => {
    for (const c of [...CHANGE_KITS, ...KEEPER_KITS]) expect(isLegibleKit(c), c).toBe(true);
  });

  it('the ball is distinct from the grass, the figures and every possible kit', () => {
    expect(contrastRatio(KIT_REFERENCE.ball, KIT_REFERENCE.grass)).toBeGreaterThan(7);
    expect(deltaE(KIT_REFERENCE.ball, KIT_REFERENCE.figure)).toBeGreaterThan(FIGURE_MIN_DE);
    const kits = [...clubs.map((c) => legibleKit(c.color, canvasColor.kitHome)), ...CHANGE_KITS, ...KEEPER_KITS];
    for (const k of kits) expect(deltaE(KIT_REFERENCE.ball, k), k).toBeGreaterThanOrEqual(FIGURE_MIN_DE);
  });
});

describe('rules 2 and 3: every ordered pairing of the 32 clubs', () => {
  const pairings = clubs.flatMap((h) => clubs.filter((a) => a.id !== h.id).map((a) => ({ h, a, k: resolveKits(h.color, a.color) })));

  it('covers 32 x 31 pairings', () => {
    expect(pairings).toHaveLength(32 * 31);
  });

  it('the two outfield kits are always distinguishable', () => {
    const worst = Math.min(...pairings.map(({ k }) => deltaE(k.home.outfield.shirt, k.away.outfield.shirt)));
    expect(worst).toBeGreaterThanOrEqual(CLASH_MIN_DE);
  });

  it('each keeper kit is distinct from both outfield kits, and from the other keeper', () => {
    for (const { h, a, k } of pairings) {
      for (const keeper of [k.home.keeper, k.away.keeper]) {
        for (const outfield of [k.home.outfield, k.away.outfield]) {
          expect(deltaE(keeper.shirt, outfield.shirt), `${h.id} v ${a.id}`).toBeGreaterThanOrEqual(KEEPER_MIN_DE);
        }
      }
      expect(deltaE(k.home.keeper.shirt, k.away.keeper.shirt)).toBeGreaterThanOrEqual(KEEPER_MIN_DE);
    }
  });

  it('no keeper is dark or hollow: bright on the grass, kit-coloured sleeves, team marker', () => {
    for (const { k } of pairings) {
      for (const side of [k.home, k.away]) {
        expect(contrastRatio(side.keeper.shirt, KIT_REFERENCE.grass)).toBeGreaterThanOrEqual(KEEPER_MIN_GRASS_CONTRAST);
        expect(side.keeper.shorts).toBe(side.keeper.shirt);
        expect(side.keeper.sleeves).toBe(side.keeper.shirt);
        expect(side.keeper.marker).toBe(side.outfield.marker);
        expect(deltaE(side.keeper.shirt, canvasColor.bg)).toBeGreaterThan(50);
      }
    }
  });

  it('every kit worn is legible and distinct from the ball', () => {
    for (const { k } of pairings) {
      for (const kit of allKits(k)) {
        expect(isLegibleKit(kit.shirt)).toBe(true);
        expect(deltaE(kit.shirt, KIT_REFERENCE.ball)).toBeGreaterThanOrEqual(FIGURE_MIN_DE);
        // Digits always read on the shirt.
        expect(contrastRatio(kit.digits, kit.shirt)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('shirt and shorts are the club colour; home never changes', () => {
    for (const { h, k } of pairings) {
      expect(k.home.outfield.shorts).toBe(k.home.outfield.shirt);
      expect(k.home.outfield.shirt).toBe(legibleKit(h.color, canvasColor.kitHome));
    }
  });

  it('the away side changes only on a clash, and the named clashes are resolved', () => {
    const byId = Object.fromEntries(clubs.map((c) => [c.id, c.color]));
    for (const [h, a] of [
      ['mercury-runners', 'makemake'],
      ['charon-united', 'vesta'],
      ['hygiea-united', 'ganymede-united'],
      ['pluto-frost', 'enceladus-geysers'],
    ] as const) {
      const k = resolveKits(byId[h], byId[a]);
      expect(k.awayChanged, `${h} v ${a}`).toBe(true);
      expect(CHANGE_KITS.map((c) => c.toLowerCase())).toContain(k.away.outfield.shirt);
    }
    // Distinct clubs keep their own colours.
    const k = resolveKits(byId['earth-united'], byId['mars-athletic']);
    expect(k.awayChanged).toBe(false);
    expect(k.away.outfield.shirt).toBe(byId['mars-athletic']!.toLowerCase());
  });

  it('reports the worst-case scores (kept in the PR)', () => {
    const outfield = Math.min(...pairings.map(({ k }) => deltaE(k.home.outfield.shirt, k.away.outfield.shirt)));
    const keeper = Math.min(
      ...pairings.flatMap(({ k }) =>
        [k.home.keeper, k.away.keeper].flatMap((kp) => [k.home.outfield, k.away.outfield].map((o) => deltaE(kp.shirt, o.shirt))),
      ),
    );
    const changed = pairings.filter(({ k }) => k.awayChanged).length;
    expect(outfield).toBeGreaterThanOrEqual(CLASH_MIN_DE);
    expect(keeper).toBeGreaterThanOrEqual(KEEPER_MIN_DE);
    expect(changed).toBeGreaterThan(0);
    expect(changed).toBeLessThan(pairings.length / 3);
  });
});
