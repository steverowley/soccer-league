// scripts/lib/engineMetrics.ts
// Shared measurement harness for the emergent match engine: builds the
// standard calibration fixtures, runs a seeded batch, and reduces every match
// to the metrics of docs/emergent-engine.md section 7.  Used by
// scripts/calibrate-engine.ts and scripts/ablate-engine.ts.
//
// Everything is seeded, so a batch is byte-stable run to run.

import {
  simulateSpatialMatch,
  type SpatialTeamInput,
  type SpatialPlayerInput,
} from '../../src/features/match/logic/spatial/simulateSpatialMatch';
import type { EngineFlags, Role, SimPlayerStats, TraceRecord } from '../../src/features/match/logic/spatial/types';

export function stats(base: number): SimPlayerStats {
  return {
    shooting: base, passing: base, dribbling: base, speed: base, stamina: base,
    tackling: base, positioning: base, goalkeeping: base, vision: base,
  };
}

const XI: Role[] = ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW'];
const BENCH: Role[] = ['GK', 'DF', 'MF', 'MF', 'FW'];

/** A 4-4-2 XI plus a five-man bench at a uniform rating. */
export function team(prefix: string, base: number, playStyle?: string): SpatialTeamInput {
  const players: SpatialPlayerInput[] = XI.map((role, i) => ({ id: `${prefix}-${i}`, name: `${prefix} ${i}`, role, stats: stats(base) }));
  const bench: SpatialPlayerInput[] = BENCH.map((role, i) => ({ id: `${prefix}-sub-${i}`, name: `${prefix} sub ${i}`, role, stats: stats(base) }));
  return { formation: '4-4-2', players, bench, ...(playStyle ? { playStyle } : {}) };
}

/** Everything measured from one match. */
export interface MatchMetrics {
  seed: number;
  homeGoals: number;
  awayGoals: number;
  goals: number;
  shots: number;
  onTarget: number;
  shotsInside11: number;
  saves: number;
  passes: number;
  passesComplete: number;
  passesResolved: number;
  tackles: number;
  interceptions: number;
  fouls: number;
  yellows: number;
  reds: number;
  corners: number;
  throws: number;
  offsides: number;
  penalties: number;
  subs: number;
  woodwork: number;
  ms: number;
}

/** Run one match and reduce it to metrics. */
export function measure(home: SpatialTeamInput, away: SpatialTeamInput, seed: number, flags?: Partial<EngineFlags>): MatchMetrics {
  let shotsInside11 = 0;
  let passesComplete = 0;
  let passesResolved = 0;
  const trace = (r: TraceRecord): void => {
    if (r.kind === 'shot' && typeof r.data['dist'] === 'number' && r.data['dist'] < 11) shotsInside11++;
    if (r.kind === 'pass_end' && r.data['kind'] !== 'throw') {
      passesResolved++;
      if (r.data['outcome'] === 'complete') passesComplete++;
    }
  };
  const t0 = performance.now();
  const r = simulateSpatialMatch(home, away, { seed, trace, ...(flags ? { flags } : {}) });
  const ms = performance.now() - t0;
  const n = (t: string) => r.events.filter((e) => e.type === t).length;
  const goals = r.finalScore[0] + r.finalScore[1];
  const saves = n('save');
  // Every strike ends in exactly one of goal / save / shot / woodwork.  Goals
  // that are own goals (no scorer) are not shots.
  const ownGoals = r.events.filter((e) => e.type === 'goal' && !e.playerId).length;
  const shots = goals - ownGoals + saves + n('shot') + n('woodwork');
  return {
    seed,
    homeGoals: r.finalScore[0],
    awayGoals: r.finalScore[1],
    goals,
    shots,
    onTarget: goals - ownGoals + saves,
    shotsInside11,
    saves,
    passes: n('pass'),
    passesComplete,
    passesResolved,
    tackles: n('tackle'),
    interceptions: n('interception'),
    fouls: n('foul'),
    yellows: r.events.filter((e) => e.type === 'foul' && e.card === 'yellow').length,
    reds: r.events.filter((e) => e.type === 'foul' && e.card === 'red').length,
    corners: n('out_corner'),
    throws: n('out_throw'),
    offsides: n('offside'),
    penalties: n('penalty'),
    subs: n('substitution'),
    woodwork: n('woodwork'),
    ms,
  };
}

/** The standard calibration batch: equal sides rated 60..80, seeds 1000+. */
export function standardBatch(count: number, flags?: Partial<EngineFlags>, seedBase = 1000): MatchMetrics[] {
  const out: MatchMetrics[] = [];
  for (let m = 0; m < count; m++) {
    const base = 60 + (m % 21);
    out.push(measure(team('H', base), team('A', base), seedBase + m, flags));
  }
  return out;
}

/** Mean and standard error of a sample. */
export function meanSe(xs: number[]): { mean: number; se: number } {
  const n = xs.length;
  const mean = xs.reduce((s, x) => s + x, 0) / Math.max(1, n);
  const v = xs.reduce((s, x) => s + (x - mean) * (x - mean), 0) / Math.max(1, n - 1);
  return { mean, se: Math.sqrt(v / Math.max(1, n)) };
}

/** A section-7 target: metric extractor (per match, or a batch rate) and band. */
export interface Target {
  name: string;
  band: [number, number];
  /** Per-match value; the batch value is the mean.  Ratios use `ratio`. */
  per?: (m: MatchMetrics) => number;
  /** For batch ratios: numerator and denominator summed over the batch. */
  ratio?: { num: (m: MatchMetrics) => number; den: (m: MatchMetrics) => number };
  /** Rate of matches satisfying a predicate. */
  rate?: (m: MatchMetrics) => boolean;
}

export const TARGETS: Target[] = [
  { name: 'goals', band: [2.4, 3.0], per: (m) => m.goals },
  { name: '0-0 share', band: [0.06, 0.10], rate: (m) => m.goals === 0 },
  { name: 'shots', band: [20, 28], per: (m) => m.shots },
  { name: 'on target share', band: [0.30, 0.38], ratio: { num: (m) => m.onTarget, den: (m) => m.shots } },
  { name: 'shots inside 11m share', band: [0.18, 0.32], ratio: { num: (m) => m.shotsInside11, den: (m) => m.shots } },
  { name: 'saves', band: [5, 8], per: (m) => m.saves },
  { name: 'passes attempted', band: [700, 1000], per: (m) => m.passes },
  { name: 'pass completion', band: [0.75, 0.86], ratio: { num: (m) => m.passesComplete, den: (m) => m.passesResolved } },
  { name: 'tackles', band: [25, 45], per: (m) => m.tackles },
  { name: 'interceptions', band: [15, 30], per: (m) => m.interceptions },
  { name: 'fouls', band: [18, 26], per: (m) => m.fouls },
  { name: 'yellow cards', band: [3, 4.5], per: (m) => m.yellows },
  { name: 'red cards', band: [0.05, 0.2], per: (m) => m.reds },
  { name: 'corners', band: [8, 12], per: (m) => m.corners },
  { name: 'throw-ins', band: [35, 50], per: (m) => m.throws },
  { name: 'offsides', band: [2, 6], per: (m) => m.offsides },
  { name: 'penalties', band: [0.2, 0.35], per: (m) => m.penalties },
  { name: 'home win share', band: [0.37, 0.53], rate: (m) => m.homeGoals > m.awayGoals },
  { name: 'draw share', band: [0.17, 0.33], rate: (m) => m.homeGoals === m.awayGoals },
  { name: 'away win share', band: [0.22, 0.38], rate: (m) => m.homeGoals < m.awayGoals },
];

/** Evaluate one target over a batch: value, standard error, verdict. */
export function evaluate(t: Target, batch: MatchMetrics[]): { value: number; se: number; verdict: string } {
  let value: number;
  let se: number;
  if (t.per) {
    ({ mean: value, se } = meanSe(batch.map(t.per)));
  } else if (t.rate) {
    const k = batch.filter(t.rate).length;
    value = k / batch.length;
    se = Math.sqrt(Math.max(value * (1 - value), 1 / batch.length) / batch.length);
  } else {
    const num = batch.reduce((s, m) => s + t.ratio!.num(m), 0);
    const den = batch.reduce((s, m) => s + t.ratio!.den(m), 0);
    value = den > 0 ? num / den : 0;
    // Ratio SE by the delta method over per-match pairs.
    const r = batch.map((m) => (t.ratio!.den(m) > 0 ? t.ratio!.num(m) / t.ratio!.den(m) : value));
    se = meanSe(r).se;
  }
  const [lo, hi] = t.band;
  let verdict = 'IN';
  if (value < lo || value > hi) {
    const gap = value < lo ? lo - value : value - hi;
    verdict = gap <= 2 * se ? 'NEAR (within 2 SE)' : 'OUT';
  }
  return { value, se, verdict };
}

/** Format a number for a report column. */
export function fmt(x: number, d = 2): string {
  return Number.isFinite(x) ? x.toFixed(d) : String(x);
}
