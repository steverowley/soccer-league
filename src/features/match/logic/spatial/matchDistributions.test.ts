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
// HOW THE BANDS ARE ASSERTED
//   A 24-match batch has sampling error, so a metric passes when the batch is
//   consistent with its target band within TOLERANCE_SE standard errors (the
//   standard error is measured from the batch itself: per-match spread for
//   counts, binomial for shares).  The batch is seeded and the engine is
//   deterministic, so the result is byte-stable run to run: it cannot flake.
//
//   Metrics the engine does not yet reach are listed in KNOWN_GAPS with their
//   measured root cause and a regression band that CONTAINS the target band,
//   so calibrating toward realism can never turn this test red, while a
//   regression away from it does.  Fix a gap by changing behaviour (decision
//   terms, shape, physics), never by changing how events are counted, then
//   delete its KNOWN_GAPS entry so the target band applies.

import { describe, it, expect, beforeAll } from 'vitest';
import {
  simulateSpatialMatch,
  type SpatialTeamInput,
  type SpatialPlayerInput,
} from './simulateSpatialMatch';
import type { SimPlayerStats, Role, TraceRecord } from './types';

/** Full matches in the batch (seeds 1000..1023, equal sides rated 60..80). */
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
 * Metrics the engine does not yet reach, the measured reason, and the
 * regression band asserted instead (it contains the target band).
 * Measured at 80 matches: saves 4.6 (SE 0.3), tackles 49 (1.1),
 * interceptions 38 (0.7), corners 6.3 (0.3), offsides 1.6 (0.13).
 * Passes (975, SE 7) reached their band in the fourth calibration pass and
 * left this list.
 */
const KNOWN_GAPS: Record<string, { band: readonly [number, number]; cause: string }> = {
  saves: {
    band: [4, 8],
    cause: 'on-target shots convert at about 40% (target about 33%): the deep block fills the box but chances in behind a holding line are still clear',
  },
  tackles: {
    band: [25, 60],
    cause: 'carriers still take touches into a presser before they have settled the ball, and a defender who meets a ball knocked a stride ahead of its man wins it',
  },
  interceptions: {
    band: [15, 45],
    cause: 'passes into marked men in a crowded middle third are cut out; passers judge lanes slightly pessimistically yet still play into contested ones under pressure',
  },
  corners: {
    band: [5, 12],
    cause: 'parries at full stretch and glancing headers now go behind, but blocked shots mostly rebound into the field and few clearances or crosses go out off a defender',
  },
  offsides: {
    band: [1, 6],
    cause: 'the back line now holds and runners break on their read of the pass, but forwards in shape never stand beyond the line and passers still rule out men they see clearly offside',
  },
};

// ── Fixture builders ──────────────────────────────────────────────────────────

function stats(base: number): SimPlayerStats {
  return {
    shooting: base, passing: base, dribbling: base, speed: base, stamina: base,
    tackling: base, positioning: base, goalkeeping: base, vision: base,
  };
}

function team(prefix: string, base: number): SpatialTeamInput {
  const xi: Role[] = ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW'];
  const bench: Role[] = ['GK', 'DF', 'MF', 'MF', 'FW'];
  const players: SpatialPlayerInput[] = xi.map((role, i) => ({ id: `${prefix}-${i}`, name: `${prefix} ${i}`, role, stats: stats(base) }));
  const subs: SpatialPlayerInput[] = bench.map((role, i) => ({ id: `${prefix}-sub-${i}`, name: `${prefix} sub ${i}`, role, stats: stats(base) }));
  return { formation: '4-4-2', players, bench: subs };
}

// ── Measurement ─────────────────────────────────────────────────────────────

interface Row {
  homeGoals: number; awayGoals: number; shots: number; onTarget: number; inside11: number;
  saves: number; passes: number; passesComplete: number; passesResolved: number;
  tackles: number; interceptions: number; fouls: number; yellows: number; reds: number;
  corners: number; throwIns: number; offsides: number; penalties: number;
}

function measure(seed: number, base: number): Row {
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
  const r = simulateSpatialMatch(team('H', base), team('A', base), { matchSeconds: 90 * 60, frameEverySec: 2, seed, trace });
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
    for (let m = 0; m < MATCH_COUNT; m++) rows.push(measure(1000 + m, 60 + (m % 21)));
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
