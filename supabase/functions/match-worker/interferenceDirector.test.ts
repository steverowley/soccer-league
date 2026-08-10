// ── match-worker/interferenceDirector.test.ts ────────────────────────────────
// These tests pin the Architect's CHARACTER, not just its determinism.
//
// The point of replacing the LLM here was to make its judgement legible enough
// that fans could reverse-engineer it over a season. That only holds if the
// behaviour is actually stable: "it punishes the hero" has to be a property of
// the code, not a tendency. Each test below is one of the traits a fan could
// eventually name.

import { describe, it, expect } from 'vitest';
import {
  directInterferences,
  proclamationVariety,
  type DirectorInput,
} from './interferenceDirector.ts';
import type { SimulatedEvent } from './simEvent.ts';

const HOME = 'EAR';
const AWAY = 'MAR';

/** One goal event for a side, by a named player. */
function goal(minute: number, team: string, player: string): SimulatedEvent {
  return { minute, subminute: 0, type: 'goal', payload: { team, player, isGoal: true } };
}

/** A non-scoring touch, so a player accumulates presence without prominence. */
function touch(minute: number, team: string, player: string): SimulatedEvent {
  return { minute, subminute: 0, type: 'pass', payload: { team, player } };
}

function input(events: SimulatedEvent[]): DirectorInput {
  return { events, homeName: 'Earth United', awayName: 'Mars Athletic', homeShort: HOME, awayShort: AWAY };
}

/** A one-sided match: home four up, with a clear hero and a quiet away player. */
function blowout(): SimulatedEvent[] {
  return [
    goal(12, HOME, 'Vale'),
    goal(28, HOME, 'Vale'),
    touch(30, AWAY, 'Quist'),
    goal(44, HOME, 'Vale'),
    goal(61, HOME, 'Roon'),
    touch(70, AWAY, 'Quist'),
    goal(80, HOME, 'Vale'),
  ];
}

/** A level, uneventful match — nothing for the Architect to resent. */
function levelDullMatch(): SimulatedEvent[] {
  return [12, 30, 48, 62].map((m) => touch(m, HOME, 'Vale'));
}

describe('determinism', () => {
  it('produces identical interferences for the same match', () => {
    const a = directInterferences(input(blowout()), 'match-1');
    const b = directInterferences(input(blowout()), 'match-1');
    expect(b).toEqual(a);
  });

  it('produces different interferences for a different match', () => {
    const a = directInterferences(input(blowout()), 'match-1');
    const b = directInterferences(input(blowout()), 'match-2');
    expect(b).not.toEqual(a);
  });
});

describe('pacing', () => {
  it('never exceeds three interferences in a match', () => {
    for (let i = 0; i < 50; i++) {
      expect(directInterferences(input(blowout()), `m-${i}`).length).toBeLessThanOrEqual(3);
    }
  });

  it('leaves at least twelve minutes between interferences', () => {
    for (let i = 0; i < 50; i++) {
      const picked = directInterferences(input(blowout()), `gap-${i}`);
      for (let j = 1; j < picked.length; j++) {
        expect(picked[j]!.minute - picked[j - 1]!.minute).toBeGreaterThanOrEqual(12);
      }
    }
  });
});

describe('the Architect resents a decided match', () => {
  it('acts against the side that is running away with it', () => {
    // Home are four up. Every mechanical intervention should be aimed at them.
    const targeted = new Set<string>();
    for (let i = 0; i < 40; i++) {
      for (const int of directInterferences(input(blowout()), `blow-${i}`)) {
        if (int.targetTeam) targeted.add(int.targetTeam);
      }
    }
    expect(targeted.has('home')).toBe(true);
    expect(targeted.has('away')).toBe(false);
  });

  it('intervenes more often in a blowout than in a level, dull match', () => {
    let blowoutCount = 0;
    let dullCount = 0;
    for (let i = 0; i < 60; i++) {
      blowoutCount += directInterferences(input(blowout()), `b-${i}`).length;
      dullCount += directInterferences(input(levelDullMatch()), `d-${i}`).length;
    }
    expect(blowoutCount).toBeGreaterThan(dullCount);
  });
});

describe('the Architect punishes the hero and pities the anonymous', () => {
  it('curses the most prominent player on the targeted side', () => {
    // Vale has four goals; Roon one. A curse should overwhelmingly find Vale.
    const cursed: string[] = [];
    for (let i = 0; i < 60; i++) {
      for (const int of directInterferences(input(blowout()), `curse-${i}`)) {
        if (int.interferenceType === 'curse_player' && int.targetPlayer) cursed.push(int.targetPlayer);
      }
    }
    expect(cursed.length).toBeGreaterThan(0);
    expect(cursed.filter((n) => n === 'Vale').length).toBeGreaterThan(cursed.filter((n) => n === 'Roon').length);
    // It never reaches across to the side it is not punishing.
    expect(cursed).not.toContain('Quist');
  });

  it('blesses a player on the side that is behind', () => {
    // A one-goal game late is where blessings live.
    const tight: SimulatedEvent[] = [
      goal(20, HOME, 'Vale'),
      touch(50, AWAY, 'Quist'),
      goal(78, HOME, 'Vale'),
      goal(82, AWAY, 'Quist'),
      touch(86, AWAY, 'Brann'),
    ];
    const blessed: string[] = [];
    for (let i = 0; i < 60; i++) {
      for (const int of directInterferences(input(tight), `bless-${i}`)) {
        if (int.interferenceType === 'bless_player' && int.targetPlayer) blessed.push(int.targetPlayer);
      }
    }
    expect(blessed.length).toBeGreaterThan(0);
    // Away trail, so the gift goes to an away player — never to the leader's hero.
    expect(blessed).not.toContain('Vale');
  });
});

describe('a level match is never mechanically rewritten', () => {
  it('emits only atmosphere when nothing is at stake', () => {
    const MECHANICAL = ['curse_player', 'bless_player', 'annul_goal', 'force_red_card'];
    for (let i = 0; i < 80; i++) {
      for (const int of directInterferences(input(levelDullMatch()), `level-${i}`)) {
        expect(MECHANICAL).not.toContain(int.interferenceType);
        expect(int.targetTeam).toBeNull();
      }
    }
  });
});

describe('scoreline attribution', () => {
  it('reads the running score from the real team names', () => {
    // The previous code matched the literal strings 'home'/'away' against
    // payload.team, so its running score never left 0-0 and no blowout was
    // ever detected. If that regressed, a four-goal lead would read as level
    // and produce only flavour.
    const types = new Set<string>();
    for (let i = 0; i < 40; i++) {
      for (const int of directInterferences(input(blowout()), `score-${i}`)) types.add(int.interferenceType);
    }
    expect([...types].some((t) => ['curse_player', 'annul_goal'].includes(t))).toBe(true);
  });
});

describe('intents the resolver can act on', () => {
  it('keeps magnitude inside the range the firing gate expects', () => {
    for (let i = 0; i < 60; i++) {
      for (const int of directInterferences(input(blowout()), `mag-${i}`)) {
        expect(int.magnitude).toBeGreaterThanOrEqual(1);
        expect(int.magnitude).toBeLessThanOrEqual(10);
        expect(Number.isInteger(int.magnitude)).toBe(true);
      }
    }
  });

  it('never emits a player-targeting intent with no player', () => {
    const NEEDS_PLAYER = ['curse_player', 'bless_player', 'force_red_card'];
    for (let i = 0; i < 80; i++) {
      for (const int of directInterferences(input(blowout()), `t-${i}`)) {
        if (NEEDS_PLAYER.includes(int.interferenceType)) expect(int.targetPlayer).toBeTruthy();
      }
    }
  });
});

describe('proclamations', () => {
  it('read as finished prose, with no numbers or stray markup', () => {
    for (let i = 0; i < 80; i++) {
      for (const int of directInterferences(input(blowout()), `p-${i}`)) {
        expect(int.proclamation).not.toMatch(/[{}<>[\]]/);
        expect(int.proclamation).not.toMatch(/\d/);
        expect(int.proclamation).toMatch(/[.!?]$/);
        expect(int.proclamation.length).toBeGreaterThan(20);
      }
    }
  });

  it('spans thousands of variants per register', () => {
    for (const [register, count] of Object.entries(proclamationVariety())) {
      expect(count, `${register} has only ${count}`).toBeGreaterThan(1_000);
    }
  });
});
