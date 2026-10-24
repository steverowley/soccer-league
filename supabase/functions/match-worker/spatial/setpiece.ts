// ── features/match/logic/spatial/setpiece.ts ─────────────────────────────────
// Restarts as physical events (design 4.8).  The ball physically crossing a
// line ends play; the last touch decides the restart.  A restart is set up
// (the taker walks to the spot, everyone takes position) and then TAKEN
// through the same decision and kick model as open play: throw-ins go short to
// a team-mate, corners and wide free kicks are deliveries to a chosen zone,
// goal kicks are kicked, penalties are struck at a keeper who must commit.
//
// Positions during a restart are authored (who stands where for a corner);
// what happens once the ball is struck is not.

import { type Vec2, vec, sub, add, scale, normalize, dist, ZERO } from './vec2.ts';
import {
  type SimPlayer, type SimWorld, type TeamSide, type RestartKind,
  PITCH_LENGTH, PITCH_WIDTH, CENTRE_SPOT, PENALTY_AREA_DEPTH, PENALTY_SPOT_DIST,
  GOAL_Y_MIN, GOAL_Y_MAX, attackingGoalX, defendingGoalX, otherSide,
} from './types.ts';
import { arrive } from './steering.ts';
import { shapePoint, clampIn } from './offball.ts';

/** Minimum set-up time (s) for each kind of restart. */
export const RESTART_PAUSE: Readonly<Record<RestartKind, number>> = {
  kickoff: 45,
  throw: 8,
  corner: 22,
  goalkick: 16,
  freekick: 16,
  penalty: 50,
  keeper: 4,
};

/** Distance (m) opponents must keep from a free kick or corner. */
const RETREAT = 9.15;

/**
 * Set up a restart: the ball is placed dead at the spot and a taker chosen.
 * Mutates the world (phase, restart, ball).
 */
export function beginRestart(
  world: SimWorld, kind: RestartKind, side: TeamSide, spot: Vec2, extraPause = 0, indirect = false, takerId?: string,
): void {
  const ball = world.ball;
  ball.pos = spot;
  ball.vel = ZERO;
  ball.z = 0;
  ball.vz = 0;
  ball.ownerId = null;
  ball.kick = null;
  ball.offsideFor = null;
  const team = (side === 'home' ? world.home : world.away).filter((p) => !p.sentOff);
  const taker = takerId ? team.find((p) => p.id === takerId) : chooseTaker(team, kind, spot);
  world.restart = {
    kind, side, spot,
    takerId: (taker ?? team[0])!.id,
    readyAt: world.clockSec + RESTART_PAUSE[kind] + extraPause,
    indirect,
  };
  world.phase = 'dead_ball';
  for (const p of [...world.home, ...world.away]) {
    p.lunge = null;
    p.dive = null;
    p.job = 'setpiece';
  }
}

/** Who takes a restart of this kind. */
function chooseTaker(team: SimPlayer[], kind: RestartKind, spot: Vec2): SimPlayer | undefined {
  const outfield = team.filter((p) => p.role !== 'GK');
  if (kind === 'goalkick' || kind === 'keeper') return team.find((p) => p.role === 'GK') ?? team[0];
  if (kind === 'penalty') return [...outfield].sort((a, b) => b.stats.shooting - a.stats.shooting)[0];
  if (kind === 'corner') {
    return [...outfield].sort((a, b) => (b.stats.passing - a.stats.passing) || (dist(a.pos, spot) - dist(b.pos, spot)))[0];
  }
  let best: SimPlayer | undefined;
  for (const p of outfield) if (!best || dist(p.pos, spot) < dist(best.pos, spot)) best = p;
  return best;
}

/**
 * Where a player stands while a restart is set up.
 */
export function restartTarget(p: SimPlayer, world: SimWorld): Vec2 {
  const r = world.restart!;
  if (p.id === r.takerId) {
    // A thrower stands on the line; a kicker just behind the ball.
    return r.spot;
  }
  const attacking = p.side === r.side;
  const gxAtt = attackingGoalX(r.side);
  const toward = gxAtt === PITCH_LENGTH ? 1 : -1;
  switch (r.kind) {
    case 'kickoff': {
      const own = defendingGoalX(p.side) === 0 ? -1 : 1; // direction of own half from the centre line
      let x = p.homePos.x;
      x = own < 0 ? Math.min(x, PITCH_LENGTH / 2 - 1) : Math.max(x, PITCH_LENGTH / 2 + 1);
      let pt = vec(x, p.homePos.y);
      if (!attacking && dist(pt, CENTRE_SPOT) < RETREAT + 0.5) {
        pt = add(CENTRE_SPOT, scale(normalize(sub(pt, CENTRE_SPOT)), RETREAT + 0.5));
      }
      return clampIn(pt);
    }
    case 'corner': {
      if (p.role === 'GK') {
        return attacking ? shapePoint(p, world) : vec(defendingGoalX(p.side) + toward * -0.8, PITCH_WIDTH / 2);
      }
      const slot = cornerSlot(p, world, attacking);
      if (slot) return slot;
      return shapePoint(p, world);
    }
    case 'penalty': {
      if (p.role === 'GK' && !attacking) return vec(defendingGoalX(p.side), PITCH_WIDTH / 2);
      const edge = gxAtt - toward * (PENALTY_AREA_DEPTH + 2);
      const i = (p.side === 'home' ? world.home : world.away).indexOf(p);
      return vec(edge, 18 + ((i * 3.3) % 32) + (attacking ? 0 : 1.6));
    }
    case 'goalkick':
    case 'keeper': {
      const pt = shapePoint(p, world);
      if (!attacking) {
        // Opponents leave the area.
        const gx = attackingGoalX(p.side);
        const lim = gx === PITCH_LENGTH ? PITCH_LENGTH - PENALTY_AREA_DEPTH - 1 : PENALTY_AREA_DEPTH + 1;
        return vec(gx === PITCH_LENGTH ? Math.min(pt.x, lim) : Math.max(pt.x, lim), pt.y);
      }
      return pt;
    }
    default: {
      let pt = shapePoint(p, world);
      if (!attacking && (r.kind === 'freekick' || r.kind === 'throw')) {
        const keep = r.kind === 'freekick' ? RETREAT : 2.5;
        if (dist(pt, r.spot) < keep) pt = add(r.spot, scale(normalize(sub(pt, r.spot)), keep));
        // A wall for a free kick in shooting range.
        if (r.kind === 'freekick' && p.role === 'DF') {
          const goal = vec(attackingGoalX(r.side), PITCH_WIDTH / 2);
          const dGoal = dist(r.spot, goal);
          if (dGoal < 30) {
            const wallIdx = (p.side === 'home' ? world.home : world.away).filter((q) => q.role === 'DF').indexOf(p);
            if (wallIdx >= 0 && wallIdx < 3) {
              const dir = normalize(sub(goal, r.spot));
              const perp = vec(-dir.y, dir.x);
              pt = add(add(r.spot, scale(dir, RETREAT)), scale(perp, (wallIdx - 1) * 0.7));
            }
          }
        }
      }
      return clampIn(pt);
    }
  }
}

/** Box positions for corners: attackers attack zones, defenders mark them. */
function cornerSlot(p: SimPlayer, world: SimWorld, attacking: boolean): Vec2 | null {
  const r = world.restart!;
  const gx = attackingGoalX(r.side);
  const into = gx === PITCH_LENGTH ? -1 : 1; // from the goal line into the pitch
  const near = r.spot.y < PITCH_WIDTH / 2;
  const nearY = near ? GOAL_Y_MIN + 0.5 : GOAL_Y_MAX - 0.5;
  const farY = near ? GOAL_Y_MAX + 1.5 : GOAL_Y_MIN - 1.5;
  const zones = [
    vec(gx + into * 5, nearY), vec(gx + into * 6.5, farY), vec(gx + into * 11, PITCH_WIDTH / 2),
    vec(gx + into * 7.5, PITCH_WIDTH / 2), vec(gx + into * 16, near ? 40 : 28),
  ];
  const team = (p.side === 'home' ? world.home : world.away).filter((q) => !q.sentOff && q.role !== 'GK' && q.id !== r.takerId);
  // The box group: forwards first, then the centre-backs, then midfielders.
  const order = [...team].sort((a, b) => roleRank(a) - roleRank(b) || a.homePos.y - b.homePos.y);
  const idx = order.indexOf(p);
  if (attacking) {
    if (idx < 0 || idx >= zones.length) return null;
    return zones[idx]!;
  }
  // Defenders: zonal six-yard line plus the near post, the rest on the edge.
  const dzones = [
    vec(gx + into * 1.2, nearY), vec(gx + into * 5.5, GOAL_Y_MIN + 1), vec(gx + into * 5.5, PITCH_WIDTH / 2),
    vec(gx + into * 5.5, GOAL_Y_MAX - 1), vec(gx + into * 9, PITCH_WIDTH / 2 - 4), vec(gx + into * 9, PITCH_WIDTH / 2 + 4),
    vec(gx + into * 12, PITCH_WIDTH / 2), vec(gx + into * 17, PITCH_WIDTH / 2),
  ];
  const didx = [...team].sort((a, b) => defRank(a) - defRank(b) || a.homePos.y - b.homePos.y).indexOf(p);
  if (didx < 0 || didx >= dzones.length) return null;
  return dzones[didx]!;
}

function roleRank(p: SimPlayer): number {
  return p.role === 'FW' ? 0 : p.role === 'DF' ? 1 : 2;
}

function defRank(p: SimPlayer): number {
  return p.role === 'DF' ? 0 : p.role === 'MF' ? 1 : 2;
}

/** Steering while a restart is set up. */
export function restartVelocity(p: SimPlayer, world: SimWorld): Vec2 {
  const t = restartTarget(p, world);
  const d = dist(p.pos, t);
  return arrive(p, t, 3, d > 15 ? 0.85 : 0.6);
}

/** The penalty spot a side shoots from. */
export function penaltySpot(attackingSide: TeamSide): Vec2 {
  const gx = attackingGoalX(attackingSide);
  return vec(gx === PITCH_LENGTH ? PITCH_LENGTH - PENALTY_SPOT_DIST : PENALTY_SPOT_DIST, PITCH_WIDTH / 2);
}

/** The goal-kick spot for a side (on its six-yard line). */
export function goalKickSpot(side: TeamSide): Vec2 {
  const gx = defendingGoalX(side);
  return vec(gx === 0 ? 5.5 : PITCH_LENGTH - 5.5, PITCH_WIDTH / 2);
}

/** The corner spot nearest where the ball went out, for the attacking side. */
export function cornerSpot(attackingSide: TeamSide, y: number): Vec2 {
  const gx = attackingGoalX(attackingSide);
  return vec(gx === PITCH_LENGTH ? PITCH_LENGTH - 0.3 : 0.3, y < PITCH_WIDTH / 2 ? 0.3 : PITCH_WIDTH - 0.3);
}

/** Whether the side that does not have a restart is `side`. */
export function defendingRestart(world: SimWorld, side: TeamSide): boolean {
  return world.restart !== null && otherSide(world.restart.side) === side;
}
