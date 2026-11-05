// ── appearance.test.ts ──────────────────────────────────────────────────────
// A player's figure: his people from the bio (Terran when absent), and the
// per-player variation seeded by his id.  Same id, same figure, always; the
// ranges are the owner's; peoples never add a hue.

import { describe, it, expect } from 'vitest';

import { canvasColor } from '../../../../shared/design';
import { SPECIES } from '../../../../data/peoples';
import {
  HAIR_TONES,
  HEAD_SCALE,
  HEAD_TONES,
  LEG_SCALE,
  QUOO_TONES,
  SHOULDER_SCALE,
  SPECIES_KEYS,
  hashStringToSeed,
  makeAppearance,
  mulberry32,
} from './appearance';

const ids = Array.from({ length: 400 }, (_, i) => `player-${String(i).padStart(4, '0')}-uuid`);

describe('hashStringToSeed / mulberry32', () => {
  it('are stable and spread', () => {
    expect(hashStringToSeed('abc')).toBe(hashStringToSeed('abc'));
    expect(hashStringToSeed('abc')).not.toBe(hashStringToSeed('abd'));
    const r = mulberry32(42);
    const xs = Array.from({ length: 1000 }, () => r());
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
  });
});

describe('makeAppearance', () => {
  it('draws from the thirteen peoples of the bio, in the lore order', () => {
    expect(SPECIES_KEYS).toEqual(SPECIES);
    expect(SPECIES_KEYS).toHaveLength(13);
    for (const sp of SPECIES_KEYS) expect(makeAppearance('p1', sp).species).toBe(sp);
  });

  it('an absent or null people is Terran (old bios, synthetic pads)', () => {
    expect(makeAppearance('p1').species).toBe('terran');
    expect(makeAppearance('p1', null).species).toBe('terran');
  });

  it('same id, same figure, always (for every people)', () => {
    for (const sp of SPECIES_KEYS) {
      for (const id of ids.slice(0, 20)) expect(makeAppearance(id, sp)).toEqual(makeAppearance(id, sp));
    }
  });

  it('a body does not change when his people does (the draws are in a fixed order)', () => {
    for (const id of ids.slice(0, 20)) {
      const a = makeAppearance(id, 'terran');
      const b = makeAppearance(id, 'cephalid');
      expect([b.headScale, b.legScale, b.shoulder, b.seed]).toEqual([a.headScale, a.legScale, a.shoulder, a.seed]);
    }
  });

  it('varies within the owner ranges, and uses most of each range', () => {
    const all = ids.map((id) => makeAppearance(id, 'grey'));
    const check = (pick: (a: (typeof all)[number]) => number, [lo, hi]: readonly [number, number]) => {
      const xs = all.map(pick);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(lo);
      expect(Math.max(...xs)).toBeLessThanOrEqual(hi);
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan((hi - lo) * 0.8);
    };
    check((a) => a.headScale, HEAD_SCALE);
    check((a) => a.legScale, LEG_SCALE);
    check((a) => a.shoulder, SHOULDER_SCALE);
  });

  it('no two of a squad look the same', () => {
    const squad = ids.slice(0, 16).map((id) => makeAppearance(id, 'taurid'));
    const keys = new Set(squad.map((a) => `${a.headScale}|${a.legScale}|${a.hornLen}|${a.hornCurl}`));
    expect(keys.size).toBe(16);
  });

  it('head tones are Lunar Dust shades, Lunar Dust itself about half the time', () => {
    const tones = ids.map((id) => makeAppearance(id, 'trinocular').tone);
    for (const t of tones) expect(HEAD_TONES).toContain(t);
    const dust = tones.filter((t) => t === canvasColor.text).length / tones.length;
    expect(dust).toBeGreaterThan(0.4);
    expect(dust).toBeLessThan(0.6);
    expect(new Set(tones).size).toBe(3);
  });

  it('the Ohm K keeps its metal grey; the Quoo varies within its own Lunar Dust shades', () => {
    for (const id of ids.slice(0, 50)) expect(makeAppearance(id, 'ohmk').tone).toBe(canvasColor.figureMetal);
    const quoo = ids.map((id) => makeAppearance(id, 'quoo').tone);
    for (const t of quoo) expect(QUOO_TONES).toContain(t);
    expect(new Set(quoo).size).toBeGreaterThan(1);
  });

  it('peoples never add a hue: every tone is a near-grey canvas token', () => {
    const tokens = new Set<string>(Object.values(canvasColor));
    for (const sp of SPECIES_KEYS) {
      for (const id of ids.slice(0, 30)) {
        const a = makeAppearance(id, sp);
        for (const c of [a.tone, a.hairTone].filter((v): v is string => v != null)) {
          expect(tokens.has(c), c).toBe(true);
          const n = Number.parseInt(c.slice(1), 16);
          const ch = [n >> 16, (n >> 8) & 255, n & 255];
          expect(Math.max(...ch) - Math.min(...ch), `${sp} ${c} is a grey`).toBeLessThan(30);
        }
      }
    }
  });

  it('only Terrans grow hair, in Lunar Dust shades, and some are bald', () => {
    const terrans = ids.map((id) => makeAppearance(id, 'terran'));
    expect(terrans.some((a) => a.hairStyle === 'bald' && a.hairTone === null)).toBe(true);
    for (const a of terrans) if (a.hairStyle !== 'bald') expect(HAIR_TONES).toContain(a.hairTone);
    expect(new Set(terrans.map((a) => a.hairStyle)).size).toBe(5);
    for (const sp of SPECIES_KEYS.filter((s) => s !== 'terran')) {
      const a = makeAppearance('p7', sp);
      expect(a.hairStyle).toBe('bald');
      expect(a.hairTone).toBeNull();
    }
  });

  it('each people has its own details: tentacles 3 to 5, aerials 0 to 2, lights on and off', () => {
    const many = ids.map((id) => makeAppearance(id, 'cephalid'));
    expect(new Set(many.map((a) => a.tentacles))).toEqual(new Set([3, 4, 5]));
    expect(new Set(many.map((a) => a.aerials))).toEqual(new Set([0, 1, 2]));
    expect(new Set(many.map((a) => a.bolts))).toEqual(new Set([true, false]));
    expect(new Set(many.map((a) => a.seam))).toEqual(new Set([true, false]));
    expect(new Set(many.map((a) => a.templeLight))).toEqual(new Set([true, false]));
  });
});
