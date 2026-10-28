// ── features/match/logic/spatial/setpiece.test.ts ────────────────────────────
// Where players stand while a restart is set up (setpiece.ts restartTarget).
//
// docs/match-viewer.md, section 2A: at every penalty the keeper of the side
// TAKING it ran the length of the pitch (about 80 m) to the edge of the other
// box, because only the defending keeper had a rule and the other fell
// through to "everyone to the edge of the box".  These tests fail on that
// code: the taking keeper must hold his shape point in his own half.

import { describe, it, expect } from 'vitest';
import { restartTarget, penaltySpot, inOwnHalf } from './setpiece';
import { dynamicAnchor } from './formation';
import {
  type SimPlayer, type SimWorld, type SimPlayerStats, type TeamSide,
  PITCH_LENGTH, PITCH_WIDTH, defendingGoalX,
} from './types';
import { type Vec2, vec } from './vec2';

function stats(): SimPlayerStats {
  return {
    shooting: 60, passing: 60, dribbling: 60, speed: 60, stamina: 60,
    tackling: 60, positioning: 60, goalkeeping: 60, vision: 60,
  };
}

function keeper(side: TeamSide, homePos: Vec2): SimPlayer {
  return {
    id: `gk-${side}`, name: 'GK', role: 'GK', side, stats: stats(),
    homePos, maxSpeed: 7, pos: homePos, vel: vec(0, 0), stamina: 1,
  } as SimPlayer;
}

/** A world with only the two keepers, set up for `side` to take a penalty. */
function penaltyWorld(side: TeamSide): { world: SimWorld; home: SimPlayer; away: SimPlayer } {
  const home = keeper('home', vec(4, PITCH_WIDTH / 2));
  const away = keeper('away', vec(PITCH_LENGTH - 4, PITCH_WIDTH / 2));
  const spot = penaltySpot(side);
  const world = {
    home: [home],
    away: [away],
    ball: { pos: spot, vel: vec(0, 0), z: 0, vz: 0, ownerId: null },
    restart: { kind: 'penalty', side, spot, takerId: 'taker', readyAt: 0, indirect: false },
  } as unknown as SimWorld;
  return { world, home, away };
}

/** Distance from a side's own goal line. */
function fromOwnLine(side: TeamSide, pt: Vec2): number {
  return Math.abs(pt.x - defendingGoalX(side));
}

describe('restartTarget at a penalty', () => {
  for (const side of ['home', 'away'] as const) {
    it(`keeps the ${side} keeper in his own half when his side takes it`, () => {
      const { world, home, away } = penaltyWorld(side);
      const taking = side === 'home' ? home : away;
      const target = restartTarget(taking, world);
      expect(fromOwnLine(side, target)).toBeLessThan(PITCH_LENGTH / 2);
      // He holds his shape point (the anchor he keeps in open play), which is
      // well inside his half with the ball at the far penalty spot.
      expect(target).toEqual(dynamicAnchor(taking, world.ball.pos));
      expect(fromOwnLine(side, target)).toBeLessThan(25);
    });

    it(`sends the other keeper to the middle of his goal line when ${side} takes it`, () => {
      const { world, home, away } = penaltyWorld(side);
      const facing = side === 'home' ? away : home;
      const target = restartTarget(facing, world);
      expect(target).toEqual(vec(defendingGoalX(facing.side), PITCH_WIDTH / 2));
    });
  }
});

describe('inOwnHalf', () => {
  it('leaves a point already in the half alone', () => {
    expect(inOwnHalf('home', vec(30, 10))).toEqual(vec(30, 10));
    expect(inOwnHalf('away', vec(80, 10))).toEqual(vec(80, 10));
  });

  it('pulls a point past the halfway line back into the half', () => {
    expect(inOwnHalf('home', vec(70, 10)).x).toBeLessThan(PITCH_LENGTH / 2);
    expect(inOwnHalf('away', vec(20, 10)).x).toBeGreaterThan(PITCH_LENGTH / 2);
    expect(inOwnHalf('home', vec(70, 10)).y).toBe(10);
  });
});
