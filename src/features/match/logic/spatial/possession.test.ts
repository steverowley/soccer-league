// ── features/match/logic/spatial/possession.test.ts ──────────────────────────
// Unit tests for on-ball geometry and for the emergent engine's contact,
// keeper and booking mechanics.  The old roll model (tackleProbability,
// foulProbability, cardForFoul, saveProbability, penaltyGoalProbability) is
// gone: nothing in the engine decides an outcome with a probability.  These
// tests assert the replacements: a challenge's outcome follows from what the
// leg meets, a save from whether the keeper's reach gets to the ball in time,
// a booking from the laws applied to what happened.

import { describe, it, expect } from 'vitest';
import {
  shotQuality, pressureAt, ballPathWithinReach, isOffsidePosition, isInPenaltyArea,
} from './possession';
import { contactOutcome, foulSeverity, lawsBooking } from './step';
import { beatKeeper } from './evaluate';
import { keeperReach } from './keeper';
import { type SimPlayer, type SimWorld, type SimPlayerStats, PITCH_WIDTH } from './types';
import { vec } from './vec2';

function stats(overrides: Partial<SimPlayerStats> = {}): SimPlayerStats {
  return {
    shooting: 60, passing: 60, dribbling: 60, speed: 60, stamina: 60,
    tackling: 60, positioning: 60, goalkeeping: 60, vision: 60, ...overrides,
  };
}

function player(over: Partial<SimPlayer> & { stats?: SimPlayerStats } = {}): SimPlayer {
  return {
    id: 'p', name: 'P', role: 'MF', side: 'home',
    stats: over.stats ?? stats(),
    homePos: vec(0, 0), maxSpeed: 8,
    pos: over.pos ?? vec(0, 0), vel: vec(0, 0), stamina: 1,
    ...over,
  } as SimPlayer;
}

describe('shotQuality', () => {
  it('is higher close to goal than far away (home attacks x=105)', () => {
    const close = shotQuality(vec(98, PITCH_WIDTH / 2), 'home');
    const far = shotQuality(vec(70, PITCH_WIDTH / 2), 'home');
    expect(close).toBeGreaterThan(far);
  });

  it('is higher central than from a tight angle at the same distance', () => {
    const central = shotQuality(vec(95, PITCH_WIDTH / 2), 'home');
    const wide = shotQuality(vec(95, 5), 'home');
    expect(central).toBeGreaterThan(wide);
  });

  it('always returns a value in [0, 1]', () => {
    for (const x of [0, 30, 60, 90, 105]) {
      for (const y of [0, 20, 34, 50, 68]) {
        const q = shotQuality(vec(x, y), 'home');
        expect(q).toBeGreaterThanOrEqual(0);
        expect(q).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('pressureAt', () => {
  it('rises as opponents close in', () => {
    const pos = vec(50, 34);
    const none = pressureAt(pos, [player({ pos: vec(50, 60) })]); // 26m away
    const tight = pressureAt(pos, [player({ pos: vec(51, 34) })]); // 1m away
    expect(tight).toBeGreaterThan(none);
    expect(tight).toBeLessThanOrEqual(1);
  });
});

describe('isOffsidePosition (home attacks x=105)', () => {
  // Away defenders: GK at x=102 (deepest), second-last DF at x=90 → offside line ≈ 90.
  const world = {
    home: [],
    away: [
      player({ id: 'gk-a', role: 'GK', side: 'away', pos: vec(102, 34) }),
      player({ id: 'd1',   role: 'DF', side: 'away', pos: vec(90, 34) }),
      player({ id: 'd2',   role: 'DF', side: 'away', pos: vec(80, 34) }),
    ],
  } as unknown as SimWorld;
  const ballPos = vec(70, 34); // pass struck from deep

  it('flags an attacker clearly beyond the second-last defender, ahead of the ball', () => {
    const fw = player({ id: 'fw', role: 'FW', side: 'home', pos: vec(95, 34) });
    expect(isOffsidePosition(fw, ballPos, world)).toBe(true);
  });

  it('does not flag an attacker behind the offside line', () => {
    const fw = player({ id: 'fw', role: 'FW', side: 'home', pos: vec(88, 34) });
    expect(isOffsidePosition(fw, ballPos, world)).toBe(false);
  });

  it('is not offside when the attacker is behind the ball', () => {
    const fw = player({ id: 'fw', role: 'FW', side: 'home', pos: vec(95, 34) });
    expect(isOffsidePosition(fw, vec(98, 34), world)).toBe(false); // ball ahead of attacker
  });

  it('is not offside inside the attacking team’s own half', () => {
    const deep = {
      home: [],
      away: [
        player({ id: 'gk-a', role: 'GK', side: 'away', pos: vec(40, 34) }),
        player({ id: 'd1',   role: 'DF', side: 'away', pos: vec(30, 34) }),
      ],
    } as unknown as SimWorld;
    const fw = player({ id: 'fw', role: 'FW', side: 'home', pos: vec(45, 34) }); // beyond line but x < 52.5
    expect(isOffsidePosition(fw, vec(20, 34), deep)).toBe(false);
  });
});

describe('ballPathWithinReach', () => {
  it('detects a player sitting on the ball path', () => {
    // Ball rolls from (0,34) to (10,34); player at (5,34) is dead on it.
    expect(ballPathWithinReach(vec(5, 34), vec(0, 34), vec(10, 34), 1.4)).toBe(true);
  });

  it('rejects a player well off the path', () => {
    expect(ballPathWithinReach(vec(5, 50), vec(0, 34), vec(10, 34), 1.4)).toBe(false);
  });

  it('handles a stationary ball as a point check', () => {
    expect(ballPathWithinReach(vec(50, 34), vec(50.5, 34), vec(50.5, 34), 1.4)).toBe(true);
    expect(ballPathWithinReach(vec(60, 34), vec(50, 34), vec(50, 34), 1.4)).toBe(false);
  });
});

describe('isInPenaltyArea (home attacks x=105, away attacks x=0)', () => {
  it('flags positions inside the box the side attacks', () => {
    expect(isInPenaltyArea(vec(100, PITCH_WIDTH / 2), 'home')).toBe(true); // 5m out, central
    expect(isInPenaltyArea(vec(5, PITCH_WIDTH / 2), 'away')).toBe(true);   // away's box at x=0
  });

  it('rejects positions outside the box (too deep, too wide, or wrong end)', () => {
    expect(isInPenaltyArea(vec(80, PITCH_WIDTH / 2), 'home')).toBe(false); // 25m out — beyond box depth
    expect(isInPenaltyArea(vec(100, 5), 'home')).toBe(false);             // corner — outside box width
    expect(isInPenaltyArea(vec(100, PITCH_WIDTH / 2), 'away')).toBe(false); // away attacks the OTHER end
  });
});


describe('contactOutcome (a challenge is decided by what the leg meets)', () => {
  // Defender at (50,34) lunging east toward (51,34).
  const def = vec(50, 34);
  it('wins the ball when the foot reaches the ball first', () => {
    const c = contactOutcome(def, vec(51, 34), vec(50.9, 34), vec(52.2, 34), true);
    expect(c.outcome).toBe('ball');
  });
  it('fouls when the leg meets the man before the ball', () => {
    // Carrier between the defender and the ball: the sweep hits him first.
    const c = contactOutcome(def, vec(51, 34), vec(52.5, 34), vec(50.8, 34.2), true);
    expect(c.outcome).toBe('man');
  });
  it('misses (the defender is beaten) when neither is within reach', () => {
    const c = contactOutcome(def, vec(51, 34), vec(51, 37), vec(51, 38), true);
    expect(c.outcome).toBe('miss');
  });
  it('cannot win an unplayable ball (in the air): the same lunge meets the man', () => {
    const playable = contactOutcome(def, vec(51, 34), vec(50.9, 34), vec(51.2, 34.3), true);
    const aerial = contactOutcome(def, vec(51, 34), vec(50.9, 34), vec(51.2, 34.3), false);
    expect(playable.outcome).toBe('ball');
    expect(aerial.outcome).toBe('man');
  });
  it('is pure geometry: identical inputs give identical outcomes', () => {
    const a = contactOutcome(def, vec(51, 34.4), vec(50.9, 34.1), vec(51.3, 34.6), true);
    const b = contactOutcome(def, vec(51, 34.4), vec(50.9, 34.1), vec(51.3, 34.6), true);
    expect(a).toEqual(b);
  });
});

describe('foulSeverity and lawsBooking (bookings by law, no card roll)', () => {
  it('severity rises with closing speed, contact from behind and an unplayable ball', () => {
    expect(foulSeverity(8, false, 0.5)).toBeGreaterThan(foulSeverity(3, false, 0.5));
    expect(foulSeverity(5, true, 0.5)).toBeGreaterThan(foulSeverity(5, false, 0.5));
    expect(foulSeverity(5, false, 2)).toBeGreaterThan(foulSeverity(5, false, 0.5));
  });
  const facts = { severity: 0.5, dogso: false, spa: false, persistent: false, inBox: false };
  it('a careless foul is a free kick only', () => {
    expect(lawsBooking(facts)).toBeUndefined();
  });
  it('stopping a promising attack or persistent infringement is a yellow', () => {
    expect(lawsBooking({ ...facts, spa: true })).toBe('yellow');
    expect(lawsBooking({ ...facts, persistent: true })).toBe('yellow');
  });
  it('a reckless foul is a yellow, serious foul play a red', () => {
    expect(lawsBooking({ ...facts, severity: foulSeverity(9, false, 0.5) + 0.25 })).toBe('yellow');
    expect(lawsBooking({ ...facts, severity: foulSeverity(14, true, 2) })).toBe('red');
  });
  it('DOGSO is a red outside the area and a yellow inside it (the penalty restores the chance)', () => {
    expect(lawsBooking({ ...facts, dogso: true })).toBe('red');
    expect(lawsBooking({ ...facts, dogso: true, inBox: true })).toBe('yellow');
  });
});

describe('keeper reach decides the save (no save roll)', () => {
  const keeper = (gk: number, y = PITCH_WIDTH / 2): SimPlayer =>
    player({ id: 'gk', role: 'GK', side: 'away', pos: vec(103.5, y), stats: stats({ goalkeeping: gk }), dive: null });
  const from = vec(91, PITCH_WIDTH / 2); // 14 m out, central (home attacks x=105)
  it('a strike straight at the keeper is held', () => {
    expect(beatKeeper(from, vec(105, PITCH_WIDTH / 2), 0.4, 26, keeper(70))).toBeLessThan(0.05);
  });
  it('a hard strike into the far corner beats him', () => {
    expect(beatKeeper(from, vec(105, PITCH_WIDTH / 2 + 3.2), 0.3, 28, keeper(70))).toBeGreaterThan(0.8);
  });
  it('a softer strike gives him time to get there', () => {
    const hard = beatKeeper(from, vec(105, PITCH_WIDTH / 2 + 2.2), 0.4, 28, keeper(70));
    const soft = beatKeeper(from, vec(105, PITCH_WIDTH / 2 + 2.2), 0.4, 12, keeper(70));
    expect(hard).toBeGreaterThan(soft);
  });
  it('a better keeper reaches strikes a weaker one cannot', () => {
    const aim = vec(105, PITCH_WIDTH / 2 + 2.4);
    expect(beatKeeper(from, aim, 0.4, 24, keeper(95))).toBeLessThan(beatKeeper(from, aim, 0.4, 24, keeper(40)));
  });
  it('an empty goal cannot be saved', () => {
    expect(beatKeeper(from, vec(105, PITCH_WIDTH / 2), 0.4, 20, undefined)).toBe(1);
  });
  it('diving and goalkeeping both extend his reach', () => {
    const k = keeper(70);
    const standing = keeperReach(k, 0.5);
    const diving = keeperReach({ ...k, dive: { at: vec(103.5, 30), z: 0.5 } } as SimPlayer, 0.5);
    expect(diving).toBeGreaterThan(standing);
    expect(keeperReach(keeper(95), 0.5)).toBeGreaterThan(keeperReach(keeper(40), 0.5));
  });
});
