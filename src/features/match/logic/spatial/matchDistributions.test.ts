// ── features/match/logic/spatial/matchDistributions.test.ts ──────────────────
// Aggregate "fingerprint" calibration test for the authoritative spatial engine
// (research WS-A4 / #577).
//
// WHY THIS EXISTS
//   The spatial engine derives goals from geometry, not from a rolled scoreline.
//   That means an innocent-looking change to steering, possession, or the stat
//   blend (e.g. #587 play-styles, #589 convex stat transform) can quietly drag
//   the whole league out of football-shaped territory — twice as many goals, no
//   draws, a shot drought — without breaking any single-match invariant. The
//   determinism and twin-parity suites guard *reproducibility*; this guards the
//   *distribution* across a batch of matches.
//
// WHAT IT ASSERTS — AND WHAT IT DELIBERATELY DOES NOT
//   It runs a fixed, seeded batch of balanced-but-varied-quality matches and
//   asserts the aggregate lands inside football-PLAUSIBLE guard bands. The bands
//   are intentionally wider than real-world ideals: the pure engine currently
//   runs HOT (~5.3 goals and ~21 shots-on-target per match vs a ~2.5–2.8 goal
//   ideal), and tightening to the ideal is an engine-tuning job, not a test job.
//   A band breach is a TUNING SIGNAL — fix it by adjusting engine INPUTS, never
//   by editing scorelines or outcomes (the only sanctioned outcome-bender is the
//   Architect's rare, disguised rewrite).
//
// Because the batch is seeded, the result is byte-stable run to run: this test
// cannot flake. If it ever goes red, the engine's behaviour actually changed.

import { describe, it, expect } from 'vitest';
import {
  simulateSpatialMatch,
  type SpatialTeamInput,
  type SpatialPlayerInput,
} from './simulateSpatialMatch';
import type { SimPlayerStats, Role } from './types';

// ── Real-world reference (the calibration aspiration) ───────────────────────
// Top-division football, per match unless noted. These are TARGETS the engine
// should drift TOWARD over time — not its current output. They are asserted only
// indirectly: the guard bands below must keep permitting them, so a future
// calibration pass can move the engine here without this test fighting it.
const FOOTBALL_REFERENCE = {
  /** Combined goals (home + away) in a typical top-flight match. */
  goalsPerMatch: [2.5, 2.8],
  /** Share of league matches that finish level (~1 in 4). */
  drawRate: 0.25,
  /** Total shot attempts per team. The engine only tags on-target shots, so
   *  this is recorded for context, not asserted against engine output. */
  shotsPerTeam: [10, 17],
  /** Home goals ÷ away goals. NOTE: real home advantage is injected UPSTREAM by
   *  `toSpatialTeamInput`'s fan-support boost — the pure engine has no built-in
   *  edge, so this batch (which skips that boost) is expected near 1.0. */
  homeTilt: 1.35,
} as const;

// ── Engine guard bands (what the PURE engine must stay within today) ────────
// Wide, football-plausible envelopes that the current engine satisfies AND that
// still bracket FOOTBALL_REFERENCE, so calibrating down toward realism (#587,
// #589) won't trip the guard. Anchored on the measured N=24 fingerprint:
// goals 5.29, draws 0.125, shots-on-target 21.4, home tilt 1.15.
const ENGINE_GUARD = {
  /** Combined goals/match. Lower bound catches a dead/stalemate engine; upper
   *  bound catches a runaway. Current ≈ 5.29. */
  goalsPerMatch: [2.0, 7.0],
  /** Fraction of the batch finishing level. Wide because 24 matches quantises
   *  draw rate coarsely (~0.042 per draw). Current ≈ 0.125. */
  drawRate: [0.04, 0.42],
  /** On-target shots/match = goals + keeper saves (the only shot signals the
   *  engine emits; off-target attempts fall out as goal kicks). Current ≈ 21.4. */
  shotsOnTargetPerMatch: [8, 32],
  /** Home÷away goals over the batch. Centred on ~1.0 because the pure engine is
   *  near-symmetric; bounds catch a side-assignment regression. Current ≈ 1.15. */
  homeTilt: [0.8, 1.45],
} as const;

/** Full 90-minute matches at the production frame cadence. ~1.5s each, so 24
 *  matches (~35s) is the most we can spend while keeping a stable aggregate
 *  inside the existing CI time budget. */
const MATCH_COUNT = 24;

// ── Fixture builders ──────────────────────────────────────────────────────────

/** A uniform stat line at `base`, so a whole XI shares one overall rating. */
function stats(base: number): SimPlayerStats {
  return {
    shooting: base, passing: base, dribbling: base, speed: base, stamina: base,
    tackling: base, positioning: base, goalkeeping: base, vision: base,
  };
}

/**
 * Build a standard 4-4-2 starting XI (1 GK, 4 DF, 4 MF, 2 FW) at a uniform base
 * rating. Ids are prefixed so home and away players never collide.
 */
function makeXI(prefix: string, base: number): SpatialPlayerInput[] {
  const roles: Role[] = ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW'];
  return roles.map((role, i) => ({ id: `${prefix}-${i}`, name: `${prefix} ${i}`, role, stats: stats(base) }));
}

/** A 4-4-2 team at the given overall rating. */
function team(prefix: string, base: number): SpatialTeamInput {
  return { formation: '4-4-2', players: makeXI(prefix, base) };
}

/**
 * Assert a measured value sits inside an inclusive guard band, with a message
 * that names the metric and the band so a failure reads as a tuning signal.
 */
function assertInBand(name: string, value: number, [lo, hi]: readonly [number, number]): void {
  expect(value, `${name}=${value.toFixed(3)} is BELOW guard band [${lo}, ${hi}] — engine drifted; tune inputs, not outcomes`).toBeGreaterThanOrEqual(lo);
  expect(value, `${name}=${value.toFixed(3)} is ABOVE guard band [${lo}, ${hi}] — engine drifted; tune inputs, not outcomes`).toBeLessThanOrEqual(hi);
}

// ── The aggregate fingerprint test ──────────────────────────────────────────

describe('spatial engine — football-realistic distribution fingerprint (#577)', () => {
  it('lands goals, draws, shots-on-target and home tilt inside football-plausible bands', () => {
    let homeGoals = 0;
    let awayGoals = 0;
    let draws = 0;
    let saves = 0;

    // Balanced-but-varied-quality matches: both teams share an overall rating
    // that sweeps 60→80 across the batch, so the fingerprint spans the league's
    // strength range rather than a single quality point. Seeds are fixed, so the
    // aggregate is deterministic.
    for (let m = 0; m < MATCH_COUNT; m++) {
      const base = 60 + (m % 21); // 60..80
      const r = simulateSpatialMatch(team('H', base), team('A', base), {
        matchSeconds: 90 * 60,
        frameEverySec: 2,
        seed: 1000 + m,
      });
      homeGoals += r.finalScore[0];
      awayGoals += r.finalScore[1];
      if (r.finalScore[0] === r.finalScore[1]) draws++;
      saves += r.events.filter((e) => e.type === 'save').length;
    }

    const goalsPerMatch = (homeGoals + awayGoals) / MATCH_COUNT;
    const drawRate = draws / MATCH_COUNT;
    const shotsOnTargetPerMatch = (homeGoals + awayGoals + saves) / MATCH_COUNT;
    const homeTilt = homeGoals / Math.max(1, awayGoals); // guard div-by-zero (away always scores over a batch)

    assertInBand('goalsPerMatch', goalsPerMatch, ENGINE_GUARD.goalsPerMatch);
    assertInBand('drawRate', drawRate, ENGINE_GUARD.drawRate);
    assertInBand('shotsOnTargetPerMatch', shotsOnTargetPerMatch, ENGINE_GUARD.shotsOnTargetPerMatch);
    assertInBand('homeTilt', homeTilt, ENGINE_GUARD.homeTilt);
  }, 90000);

  it('keeps guard bands wide enough to still permit the real-world ideal', () => {
    // This is the safety net for the WHOLE point of the test: when someone tunes
    // the engine toward FOOTBALL_REFERENCE, the guard bands must already contain
    // those ideal values — otherwise calibrating to realism would (perversely)
    // turn this test red. So the bands must bracket the reference.
    expect(FOOTBALL_REFERENCE.goalsPerMatch[0]).toBeGreaterThanOrEqual(ENGINE_GUARD.goalsPerMatch[0]);
    expect(FOOTBALL_REFERENCE.goalsPerMatch[1]).toBeLessThanOrEqual(ENGINE_GUARD.goalsPerMatch[1]);
    expect(FOOTBALL_REFERENCE.drawRate).toBeGreaterThanOrEqual(ENGINE_GUARD.drawRate[0]);
    expect(FOOTBALL_REFERENCE.drawRate).toBeLessThanOrEqual(ENGINE_GUARD.drawRate[1]);
    expect(FOOTBALL_REFERENCE.homeTilt).toBeGreaterThanOrEqual(ENGINE_GUARD.homeTilt[0]);
    expect(FOOTBALL_REFERENCE.homeTilt).toBeLessThanOrEqual(ENGINE_GUARD.homeTilt[1]);
  });
});
