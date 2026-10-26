import { describe, it, expect } from 'vitest';
import { legalSubminute, subminuteAfter, MAX_SUBMINUTE } from './subminute';
import { directInterferences } from './interferenceDirector';
import type { SimulatedEvent } from './simEvent';

// The DB check is: subminute >= 0 AND subminute < 1, column numeric(4,3).
const legal = (x: number) => x >= 0 && x < 1 && Math.round(x * 1000) / 1000 === x;

describe('legalSubminute', () => {
  it('passes ordinary values through at three decimal places', () => {
    expect(legalSubminute(0)).toBe(0);
    expect(legalSubminute(0.5)).toBe(0.5);
    expect(legalSubminute(0.1234)).toBe(0.123);
  });

  it('never reaches 1, including values numeric(4,3) would round up', () => {
    for (const x of [0.9994, 0.9995, 0.9996, 0.9999, 1, 1.001, 7]) {
      const v = legalSubminute(x);
      expect(legal(v)).toBe(true);
      expect(v).toBe(MAX_SUBMINUTE);
    }
  });

  it('turns negative, NaN and infinite input into a legal value', () => {
    for (const x of [-0.2, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(legal(legalSubminute(x))).toBe(true);
    }
  });
});

describe('subminuteAfter', () => {
  it('offsets inside the minute and clamps at its end (the 2026-10-26 incident)', () => {
    expect(subminuteAfter(0.3)).toBe(0.305);
    // A goal at 0.996 of its minute: the old `+ 0.005` gave 1.001 and the
    // whole event batch was rejected on every retry.
    expect(subminuteAfter(0.996)).toBe(MAX_SUBMINUTE);
    expect(legal(subminuteAfter(0.999))).toBe(true);
  });
});

describe('Architect interferences after a late-in-the-minute goal', () => {
  it('every interference lands on a legal subminute', () => {
    // Goals at the very end of their minutes, the case that broke production.
    const goal = (minute: number, team: string, player: string): SimulatedEvent =>
      ({ minute, subminute: 0.997, type: 'goal', payload: { team, player, isGoal: true } });
    const events = [goal(12, 'EAR', 'Vale'), goal(28, 'EAR', 'Vale'), goal(44, 'EAR', 'Vale'),
      goal(61, 'EAR', 'Roon'), goal(80, 'EAR', 'Vale'), goal(88, 'MAR', 'Quist')];
    let checked = 0;
    for (let seed = 0; seed < 40; seed++) {
      const out = directInterferences(
        { events, homeName: 'Earth United', awayName: 'Mars Athletic', homeShort: 'EAR', awayShort: 'MAR' },
        `match-${seed}`,
      );
      for (const i of out) { expect(legal(i.subminute)).toBe(true); checked++; }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
