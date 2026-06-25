// ── features/match/logic/spatial/playStyle.test.ts ───────────────────────────
// Tests for manager play-styles (#587).  We assert (a) resolveStyle maps the DB
// strings correctly and falls back to Balanced, and (b) the eight styles produce
// MEASURABLY different shot / passing / pressing profiles in seeded full matches
// — the acceptance criterion — while Balanced stays a byte-for-byte no-op so the
// calibration fingerprint is untouched.

import { describe, it, expect } from 'vitest';
import { resolveStyle, BALANCED_STYLE } from './playStyle';
import {
  simulateSpatialMatch,
  type SpatialTeamInput,
  type SpatialPlayerInput,
} from './simulateSpatialMatch';
import type { SimPlayerStats, Role } from './types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ROLES: Role[] = ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW'];

function stats(base: number): SimPlayerStats {
  return {
    shooting: base, passing: base, dribbling: base, speed: base, stamina: base,
    tackling: base, positioning: base, goalkeeping: base, vision: base,
  };
}

/** A 4-4-2 team at a uniform rating, optionally under a manager play-style. */
function team(prefix: string, base: number, playStyle?: string): SpatialTeamInput {
  const players: SpatialPlayerInput[] = ROLES.map((role, i) => ({
    id: `${prefix}-${i}`, name: `${prefix} ${i}`, role, stats: stats(base),
  }));
  return { formation: '4-4-2', players, ...(playStyle ? { playStyle } : {}) };
}

const CFG = { matchSeconds: 90 * 60, frameEverySec: 2 } as const;
const SEEDS = [1, 2, 3, 4];

/** Aggregate the home side's shot / pass / tackle volumes for a style over a
 *  fixed seed set (home carries the style, away stays Balanced). */
function profile(style: string | undefined): { shots: number; passes: number; tackles: number } {
  let shots = 0, passes = 0, tackles = 0;
  for (const seed of SEEDS) {
    const r = simulateSpatialMatch(team('H', 70, style), team('A', 70), { ...CFG, seed });
    for (const e of r.events) {
      if (e.side !== 'home') continue;
      if (e.type === 'shot' || e.type === 'goal') shots += 1;
      else if (e.type === 'pass') passes += 1;
      else if (e.type === 'tackle') tackles += 1;
    }
  }
  return { shots, passes, tackles };
}

// ── resolveStyle ───────────────────────────────────────────────────────────────

describe('resolveStyle', () => {
  it('maps known styles to their characteristic deltas', () => {
    expect(resolveStyle('Possession').pass).toBeGreaterThan(0);   // patient build-up
    expect(resolveStyle('High Pressing').press).toBeGreaterThan(0); // harry everywhere
    expect(resolveStyle('Defensive').tackle).toBeGreaterThan(0);   // win it back
    expect(resolveStyle('Offensive').shoot).toBeGreaterThan(0);    // shoot on sight
  });

  it('falls back to Balanced for unknown, null or Balanced inputs', () => {
    expect(resolveStyle(null)).toEqual(BALANCED_STYLE);
    expect(resolveStyle(undefined)).toEqual(BALANCED_STYLE);
    expect(resolveStyle('Nonsense')).toEqual(BALANCED_STYLE);
    expect(resolveStyle('Balanced')).toEqual(BALANCED_STYLE);
  });
});

// ── Distinct match profiles ─────────────────────────────────────────────────

describe('play-styles → distinct match profiles (#587)', () => {
  it('Offensive takes more shots than Possession', () => {
    expect(profile('Offensive').shots).toBeGreaterThan(profile('Possession').shots);
  }, 30000);

  it('Possession plays more passes than Direct', () => {
    expect(profile('Possession').passes).toBeGreaterThan(profile('Direct').passes);
  }, 30000);

  it('High Pressing wins more tackles than Counterattacking', () => {
    expect(profile('High Pressing').tackles).toBeGreaterThan(profile('Counterattacking').tackles);
  }, 30000);

  it('Balanced is a no-op — identical to no style set (calibration safety)', () => {
    const a = simulateSpatialMatch(team('H', 70, 'Balanced'), team('A', 70), { ...CFG, seed: 42 });
    const b = simulateSpatialMatch(team('H', 70), team('A', 70), { ...CFG, seed: 42 });
    expect(a.finalScore).toEqual(b.finalScore);
    expect(a.events).toEqual(b.events);
  }, 20000);
});
