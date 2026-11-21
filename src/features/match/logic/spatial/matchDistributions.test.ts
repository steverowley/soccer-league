// ── features/match/logic/spatial/matchDistributions.test.ts ──────────────────
// The calibration contract of the emergent engine (docs/emergent-engine.md,
// section 7 and build step 10).
//
// WHY THIS EXISTS
//   Nothing in the engine rolls an outcome: goals, saves, tackles, fouls and
//   cards all fall out of 22 players' decisions and the physics.  So a change
//   to steering, a decision term or the ball model can quietly drag the whole
//   league out of football-shaped territory without breaking any single-match
//   invariant.  This test runs a fixed, seeded batch and holds EVERY section-7
//   metric to its real-football band, including the ones that let the #698
//   tackle flood hide (tackles, passes, corners, throw-ins).
//
// MEASURED ON REAL SQUADS
//   The batch is played between the real ISL clubs as the match worker builds
//   them (calibration/islFixture.ts: a snapshot of every club's players,
//   attributes, personalities and manager's game model), on a fixed schedule
//   of league pairings from all four leagues plus cross-league ties, each pair
//   played at both grounds.  Until November 2026 it played two IDENTICAL
//   average-rated sides instead.  Identical sides cancel each other out and
//   made a different, poorer match than the league plays: on 480 matches
//   that fixture gave 2.27 goals, 3.80 saves, 0.42 draws and 0.11 penalties a
//   match, while the same engine on real squads gave 2.88, 6.32, 0.28 and
//   0.19, and the live league (Season 1, 234 matches) gave 2.99 goals, 6.19
//   saves and 0.29 draws.  The old fixture's saves, goals, draws and
//   penalties gaps were properties of the fixture, not of the league; tuning
//   the engine to close them pushed real-squad goals to 4.0 a match (#765).
//   Report: docs/reports/real-squads-2026-11-report.txt.
//
// HOW THE BANDS ARE ASSERTED
//   A 24-match batch has sampling error, so a metric passes when the batch is
//   consistent with its target band within TOLERANCE_SE standard errors (the
//   standard error is measured from the batch itself: per-match spread for
//   counts, binomial for shares).  The batch is seeded and the engine is
//   deterministic, so the result is byte-stable run to run: it cannot flake.
//   Its 24 matches are matches 0..23 (seeds 1000..1023) of the long batch
//   `bash scripts/run-batch.sh <prefix> isl 480`, so a 480-match measurement
//   always contains this test's own batch.
//
//   Metrics the engine does not yet reach are listed in KNOWN_GAPS with their
//   measured root cause and a regression band that CONTAINS the target band,
//   so calibrating toward realism can never turn this test red, while a
//   regression away from it does.  Fix a gap by changing behaviour (decision
//   terms, shape, physics), never by changing how events are counted, then
//   delete its KNOWN_GAPS entry so the target band applies.

import { describe, it, expect, beforeAll } from 'vitest';
import { simulateSpatialMatch } from './simulateSpatialMatch';
import type { TraceRecord } from './types';
import { islFixture, islTeam } from '../calibration/islFixture';

/** Full matches in the batch (real squads, calibration schedule matches 0..23, seeds 1000..1023). */
const MATCH_COUNT = 24;

/** Standard errors of slack between the batch value and the target band. */
const TOLERANCE_SE = 2.5;

/** Section 7 of docs/emergent-engine.md: real football, both teams per match. */
const TARGET: Record<string, readonly [number, number]> = {
  goals: [2.4, 3.0],
  zeroZeroShare: [0.06, 0.10],
  shots: [20, 28],
  onTargetShare: [0.30, 0.38],
  inside11Share: [0.18, 0.32],
  saves: [5, 8],
  passes: [700, 1000],
  passCompletion: [0.75, 0.86],
  tackles: [25, 45],
  interceptions: [15, 30],
  fouls: [18, 26],
  yellows: [3, 4.5],
  reds: [0.05, 0.2],
  corners: [8, 12],
  throwIns: [35, 50],
  offsides: [2, 6],
  penalties: [0.2, 0.35],
  homeWinShare: [0.37, 0.53],
  drawShare: [0.17, 0.33],
  awayWinShare: [0.22, 0.38],
};

/**
 * Metrics the engine does not yet reach on real squads, the measured reason,
 * and the regression band asserted instead (it contains the target band).
 *
 * Measured at 480 real-squad matches (scripts/run-batch.sh isl 480, seeds
 * 1000..1479, this test's batch included) on the engine with the keeper
 * high-ball fix (November 2026), mean (SE): passes 1039 (4.8), tackles 59.7
 * (0.54), interceptions 35.0 (0.68), corners 7.06 (0.13).  Every other
 * metric is inside its band at that scale (goals 2.64, 0-0 0.092, saves
 * 6.29, draws 0.285, penalties 0.196 (SE 0.019), offsides 2.16, throw-ins
 * 36.4, pass completion 0.862 (SE 0.001)).
 *
 * Each band is the measured mean plus (for a metric above its target) or
 * minus (below it) 2.5 standard errors of a 24-match batch (per-match SD /
 * sqrt(24)), the tolerance the target bands use; the other bound is the
 * target's.  Saves left this list: their gap was a property of the old
 * equal-sides fixture (3.80 a match there over 480 matches, 6.29 on real squads).
 */
const KNOWN_GAPS: Record<string, { band: readonly [number, number]; cause: string }> = {
  passes: {
    // 1039 + 2.5 x 21.3 (per-match SD 104) = 1092.3.
    band: [700, 1093],
    cause: 'real squads keep the ball: completion sits at the top of its band (0.862), so possessions run to more passes than in the old equal-sides fixture (981 passes at 0.812 completion); the carrier still recycles short when the lane ahead is contested (#773)',
  },
  tackles: {
    // 59.7 + 2.5 x 2.43 (per-match SD 11.9) = 65.7.
    band: [25, 66],
    cause: 'carriers still take touches into a presser before they have settled the ball, and a defender who meets a ball knocked a stride ahead of its man wins it',
  },
  interceptions: {
    // 35.0 + 2.5 x 3.03 (per-match SD 14.8) = 42.6.
    band: [15, 43],
    cause: 'passes into marked men in a crowded middle third are cut out; passers judge lanes slightly pessimistically yet still play into contested ones under pressure',
  },
  corners: {
    // 7.06 - 2.5 x 0.59 (per-match SD 2.91) = 5.58.
    band: [5.5, 12],
    cause: 'parries at full stretch and glancing headers now go behind, but blocked shots mostly rebound into the field and few clearances or crosses go out off a defender',
  },
};

// ── Measurement ─────────────────────────────────────────────────────────────

interface Row {
  homeGoals: number; awayGoals: number; shots: number; onTarget: number; inside11: number;
  saves: number; passes: number; passesComplete: number; passesResolved: number;
  tackles: number; interceptions: number; fouls: number; yellows: number; reds: number;
  corners: number; throwIns: number; offsides: number; penalties: number;
}

function measure(m: number): Row {
  const f = islFixture(m);
  let inside11 = 0;
  let passesComplete = 0;
  let passesResolved = 0;
  const trace = (r: TraceRecord): void => {
    if (r.kind === 'shot' && typeof r.data['dist'] === 'number' && r.data['dist'] < 11) inside11++;
    if (r.kind === 'pass_end' && r.data['kind'] !== 'throw') {
      passesResolved++;
      if (r.data['outcome'] === 'complete') passesComplete++;
    }
  };
  const r = simulateSpatialMatch(islTeam(f.home), islTeam(f.away), { matchSeconds: 90 * 60, frameEverySec: 2, seed: f.seed, trace });
  const n = (t: string): number => r.events.filter((e) => e.type === t).length;
  const goals = r.finalScore[0] + r.finalScore[1];
  const ownGoals = r.events.filter((e) => e.type === 'goal' && !e.playerId).length;
  const saves = n('save');
  return {
    homeGoals: r.finalScore[0], awayGoals: r.finalScore[1],
    shots: goals - ownGoals + saves + n('shot') + n('woodwork'),
    onTarget: goals - ownGoals + saves,
    inside11, saves, passes: n('pass'), passesComplete, passesResolved,
    tackles: n('tackle'), interceptions: n('interception'), fouls: n('foul'),
    yellows: r.events.filter((e) => e.type === 'foul' && e.card === 'yellow').length,
    reds: r.events.filter((e) => e.type === 'foul' && e.card === 'red').length,
    corners: n('out_corner'), throwIns: n('out_throw'), offsides: n('offside'), penalties: n('penalty'),
  };
}

/** Batch value and its standard error for every metric. */
function summarise(rows: Row[]): Record<string, { value: number; se: number }> {
  const N = rows.length;
  const mean = (f: (r: Row) => number): { value: number; se: number } => {
    const xs = rows.map(f);
    const mu = xs.reduce((s, x) => s + x, 0) / N;
    const v = xs.reduce((s, x) => s + (x - mu) * (x - mu), 0) / Math.max(1, N - 1);
    return { value: mu, se: Math.sqrt(v / N) };
  };
  const share = (k: number): { value: number; se: number } => {
    const p = k / N;
    // Binomial SE, floored at the resolution of one match in the batch.
    return { value: p, se: Math.max(Math.sqrt((p * (1 - p)) / N), 1 / N) };
  };
  const ratio = (num: (r: Row) => number, den: (r: Row) => number): { value: number; se: number } => {
    const a = rows.reduce((s, r) => s + num(r), 0);
    const b = rows.reduce((s, r) => s + den(r), 0);
    const p = a / Math.max(1, b);
    // Ratio of sums: SE from the per-match residuals (delta method).
    const mb = b / N;
    const v = rows.reduce((s, r) => s + (num(r) - p * den(r)) ** 2, 0) / Math.max(1, N - 1);
    return { value: p, se: Math.sqrt(v / N) / Math.max(1e-9, mb) };
  };
  return {
    goals: mean((r) => r.homeGoals + r.awayGoals),
    zeroZeroShare: share(rows.filter((r) => r.homeGoals + r.awayGoals === 0).length),
    shots: mean((r) => r.shots),
    onTargetShare: ratio((r) => r.onTarget, (r) => r.shots),
    inside11Share: ratio((r) => r.inside11, (r) => r.shots),
    saves: mean((r) => r.saves),
    passes: mean((r) => r.passes),
    passCompletion: ratio((r) => r.passesComplete, (r) => r.passesResolved),
    tackles: mean((r) => r.tackles),
    interceptions: mean((r) => r.interceptions),
    fouls: mean((r) => r.fouls),
    yellows: mean((r) => r.yellows),
    reds: mean((r) => r.reds),
    corners: mean((r) => r.corners),
    throwIns: mean((r) => r.throwIns),
    offsides: mean((r) => r.offsides),
    penalties: mean((r) => r.penalties),
    homeWinShare: share(rows.filter((r) => r.homeGoals > r.awayGoals).length),
    drawShare: share(rows.filter((r) => r.homeGoals === r.awayGoals).length),
    awayWinShare: share(rows.filter((r) => r.homeGoals < r.awayGoals).length),
  };
}

// The batch is simulated once and shared by every assertion below.
let SUMMARY: Record<string, { value: number; se: number }> = {};

describe('emergent engine: section-7 calibration contract', () => {
  beforeAll(() => {
    const rows: Row[] = [];
    for (let m = 0; m < MATCH_COUNT; m++) rows.push(measure(m));
    SUMMARY = summarise(rows);
  }, 600_000);

  for (const name of Object.keys(TARGET)) {
    it(`${name} is consistent with its band`, () => {
      const s = SUMMARY[name];
      expect(s, `${name} not measured`).toBeDefined();
      const gap = KNOWN_GAPS[name];
      const [lo, hi] = gap ? gap.band : TARGET[name]!;
      const slack = gap ? 0 : TOLERANCE_SE * s!.se;
      const label = `${name}=${s!.value.toFixed(3)} (SE ${s!.se.toFixed(3)}) against ${gap ? 'regression' : 'target'} band [${lo}, ${hi}]`;
      expect(s!.value, `${label}: below. Change behaviour, not counting.`).toBeGreaterThanOrEqual(lo - slack);
      expect(s!.value, `${label}: above. Change behaviour, not counting.`).toBeLessThanOrEqual(hi + slack);
    });
  }

  it('every known gap states a cause and its regression band still contains the target', () => {
    for (const [name, gap] of Object.entries(KNOWN_GAPS)) {
      const t = TARGET[name];
      expect(t, `${name} must be a section-7 metric`).toBeDefined();
      expect(gap.cause.length).toBeGreaterThan(20);
      expect(gap.band[0]).toBeLessThanOrEqual(t![0]);
      expect(gap.band[1]).toBeGreaterThanOrEqual(t![1]);
    }
  });
});
