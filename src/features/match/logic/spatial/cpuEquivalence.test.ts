// ── features/match/logic/spatial/cpuEquivalence.test.ts ──────────────────────
// The CPU optimisations (docs/reports/engine-cpu-report.txt) must not change a
// single result.  The full-match guard is scripts/engine-fingerprint.ts; this
// file pins the rewritten helpers to the reference implementations they
// replaced, on fuzzed inputs, bit for bit (Object.is, so signed zeros count),
// and checks the property the intercept-scan pruning in buildContext relies
// on: timeToReach is never below straight-line distance over top speed.

import { describe, it, expect } from 'vitest';
import { type Vec2, vec, sub, add, scale, len, normalize, ZERO } from './vec2';
import type { SimPlayer, SimWorld, TeamSide } from './types';
import { PITCH_LENGTH } from './types';
import { makeRng } from './rng';
import { offsideLineX } from './possession';
import { separation, arrive, seek, effectiveMaxSpeed } from './steering';
import { timeToReach, timeToReachXY } from './evaluate';

// ── Reference implementations (the code before the CPU work) ────────────────

function offsideLineXRef(world: SimWorld, attackingSide: TeamSide): number {
  const defenders = (attackingSide === 'home' ? world.away : world.home).filter((d) => !d.sentOff);
  const xs = defenders.map((d) => d.pos.x);
  if (attackingSide === 'home') {
    const desc = xs.sort((a, b) => b - a);
    return Math.max(PITCH_LENGTH / 2, desc[1] ?? PITCH_LENGTH / 2);
  }
  const asc = xs.sort((a, b) => a - b);
  return Math.min(PITCH_LENGTH / 2, asc[1] ?? PITCH_LENGTH / 2);
}

function separationRef(p: SimPlayer, others: readonly SimPlayer[], radius: number): Vec2 {
  let push = ZERO;
  for (const o of others) {
    if (o.id === p.id) continue;
    const away = sub(p.pos, o.pos);
    const d = len(away);
    if (d > 1e-6 && d < radius) push = add(push, scale(normalize(away), (radius - d) / radius));
  }
  if (len(push) < 1e-6) return ZERO;
  return scale(normalize(push), effectiveMaxSpeed(p) * 0.55);
}

function seekRef(p: SimPlayer, target: Vec2): Vec2 {
  const toTarget = sub(target, p.pos);
  if (len(toTarget) < 1e-6) return ZERO;
  return scale(normalize(toTarget), effectiveMaxSpeed(p));
}

function arriveRef(p: SimPlayer, target: Vec2, slowRadius: number, speedFrac = 1): Vec2 {
  const toTarget = sub(target, p.pos);
  const d = len(toTarget);
  if (d < 0.2) return ZERO;
  const maxV = effectiveMaxSpeed(p) * speedFrac;
  const desiredSpeed = d >= slowRadius ? maxV : maxV * (d / slowRadius);
  return scale(normalize(toTarget), desiredSpeed);
}

// ── Fuzz fixtures ───────────────────────────────────────────────────────────

const rand = makeRng(20261025);

/** A player with just the fields the helpers read. */
function player(id: string, side: TeamSide, pos: Vec2, vel: Vec2): SimPlayer {
  return {
    id, side, pos, vel, sentOff: rand() < 0.08,
    maxSpeed: 6 + 2.5 * rand(), stamina: 0.2 + 0.8 * rand(), recoverUntil: rand() < 0.2 ? 100 + rand() : 0,
  } as unknown as SimPlayer;
}

/** Positions with deliberate ties and signed zeros, to exercise tie-breaking. */
function coord(max: number): number {
  const r = rand();
  if (r < 0.05) return 0;
  if (r < 0.08) return -0;
  if (r < 0.15) return Math.round(rand() * 4) * (max / 4);
  return rand() * max;
}

function team(side: TeamSide, n: number): SimPlayer[] {
  return Array.from({ length: n }, (_, i) =>
    player(`${side}-${i}`, side, vec(coord(PITCH_LENGTH), coord(68)), vec(coord(16) - 8, coord(16) - 8)));
}

const same = (a: Vec2, b: Vec2): boolean => Object.is(a.x, b.x) && Object.is(a.y, b.y);

describe('CPU rewrites match the reference implementations bit for bit', () => {
  it('offsideLineX (one pass) equals the sort, ties and signed zeros included', () => {
    for (let k = 0; k < 3000; k++) {
      const world = { home: team('home', 1 + (k % 11)), away: team('away', 1 + ((k * 7) % 11)) } as unknown as SimWorld;
      for (const side of ['home', 'away'] as const) {
        expect(Object.is(offsideLineX(world, side), offsideLineXRef(world, side))).toBe(true);
      }
    }
  });

  it('separation, seek and arrive (scalar) equal the Vec2 forms', () => {
    for (let k = 0; k < 3000; k++) {
      const mates = team('home', 11);
      // Crowd them so separation has work to do.
      for (const m of mates) m.pos = vec(50 + 4 * rand(), 30 + 4 * rand());
      const p = mates[k % 11]!;
      expect(same(separation(p, mates, 3.5), separationRef(p, mates, 3.5))).toBe(true);
      const target = rand() < 0.1 ? p.pos : vec(p.pos.x + coord(30) - 15, p.pos.y + coord(30) - 15);
      expect(same(seek(p, target), seekRef(p, target))).toBe(true);
      const slow = 1 + 6 * rand();
      const frac = rand();
      expect(same(arrive(p, target, slow, frac), arriveRef(p, target, slow, frac))).toBe(true);
    }
  });

  it('timeToReachXY equals timeToReach, and never beats distance over top speed', () => {
    for (let k = 0; k < 5000; k++) {
      const p = player('p', 'home', vec(coord(PITCH_LENGTH), coord(68)), vec(coord(20) - 10, coord(20) - 10));
      const pt = vec(coord(PITCH_LENGTH), coord(68));
      const now = 100 * rand();
      const t = timeToReach(p, pt, now);
      expect(Object.is(timeToReachXY(p, pt.x, pt.y, now), t)).toBe(true);
      const d = Math.hypot(pt.x - p.pos.x, pt.y - p.pos.y);
      // The pruning in buildContext uses this bound with a 1e-6 s margin.
      expect(t + 1e-9).toBeGreaterThanOrEqual(d / effectiveMaxSpeed(p));
    }
  });
});
