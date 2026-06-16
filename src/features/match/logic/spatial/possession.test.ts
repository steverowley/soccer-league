// ── features/match/logic/spatial/possession.test.ts ──────────────────────────
// Unit tests for the on-ball evaluation + contest probabilities.  These encode
// the design promise that STATS drive OUTCOMES — so we assert the monotonic
// relationships (better finisher → likelier goal, closer shot → higher quality)
// rather than exact magic numbers.

import { describe, it, expect } from 'vitest';
import {
  shotQuality, pressureAt, tackleProbability, foulProbability, cardForFoul, saveProbability, ballPathWithinReach,
} from './possession';
import { type SimPlayer, type SimPlayerStats, PITCH_WIDTH } from './types';
import { vec } from './vec2';
import { makeRng } from './rng';

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

describe('tackleProbability', () => {
  it('favours the better tackler but never reaches certainty', () => {
    const ace = player({ stats: stats({ tackling: 95 }) });
    const poor = player({ stats: stats({ tackling: 40 }) });
    const slippery = player({ stats: stats({ dribbling: 95 }) });
    expect(tackleProbability(ace, slippery)).toBeGreaterThan(tackleProbability(poor, slippery));
    expect(tackleProbability(ace, slippery)).toBeLessThanOrEqual(0.88);
    expect(tackleProbability(poor, slippery)).toBeGreaterThanOrEqual(0.12);
  });
});

describe('saveProbability', () => {
  it('falls as shot quality rises, clamped to [0.10, 0.94]', () => {
    const keeper = player({ role: 'GK', stats: stats({ goalkeeping: 80 }) });
    const easy = saveProbability(keeper, 0.1);
    const worldie = saveProbability(keeper, 0.95);
    expect(easy).toBeGreaterThan(worldie);
    expect(worldie).toBeGreaterThanOrEqual(0.10);
    expect(easy).toBeLessThanOrEqual(0.94);
  });

  it('a better keeper saves more at equal shot quality', () => {
    const good = player({ role: 'GK', stats: stats({ goalkeeping: 90 }) });
    const weak = player({ role: 'GK', stats: stats({ goalkeeping: 45 }) });
    expect(saveProbability(good, 0.5)).toBeGreaterThan(saveProbability(weak, 0.5));
  });
});

describe('foulProbability', () => {
  it('rises when the carrier outclasses the defender, clamped to [0.002, 0.012] per tick', () => {
    const slickCarrier = player({ stats: stats({ dribbling: 95 }) });
    const beatenDefender = player({ stats: stats({ tackling: 40 }) });
    const matchedDefender = player({ stats: stats({ tackling: 95 }) });
    const high = foulProbability(beatenDefender, slickCarrier);
    const low = foulProbability(matchedDefender, slickCarrier);
    expect(high).toBeGreaterThan(low);
    // Tiny by design — it fires every 0.1s a defender is in range.
    expect(high).toBeLessThanOrEqual(0.012);
    expect(low).toBeGreaterThanOrEqual(0.002);
  });
});

describe('cardForFoul', () => {
  it('books cynical fouls near the attacked goal more than fouls deep in own half', () => {
    // home attacks x=105: a foul on a home attacker at x=100 is advanced/cynical.
    const rng = makeRng(42);
    let nearGoal = 0;
    let deep = 0;
    for (let i = 0; i < 2000; i++) {
      if (cardForFoul(vec(100, PITCH_WIDTH / 2), 'home', rng)) nearGoal++;
      if (cardForFoul(vec(10, PITCH_WIDTH / 2), 'home', rng)) deep++;
    }
    expect(nearGoal).toBeGreaterThan(deep);
  });

  it('mostly gives no card, and reds are rarer than yellows', () => {
    const rng = makeRng(7);
    let none = 0;
    let yellow = 0;
    let red = 0;
    for (let i = 0; i < 3000; i++) {
      const c = cardForFoul(vec(70, PITCH_WIDTH / 2), 'home', rng);
      if (c === null) none++;
      else if (c === 'yellow') yellow++;
      else red++;
    }
    expect(none).toBeGreaterThan(yellow + red); // most fouls are just a free kick
    expect(yellow).toBeGreaterThan(red);        // straight reds are rare
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
