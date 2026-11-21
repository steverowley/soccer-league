// scripts/style-profile-batch.ts
// The play-style profile behind src/features/match/logic/spatial/playStyle.test.ts,
// over many seeds: home side (70-rated 4-4-2) under a style v a Balanced away
// side, per seed the home side's shots, passes and tackles counted exactly as
// the test counts them.
//
//   STYLES="High Pressing,Counterattacking" N=120 SHARD=0 SHARDS=8 OUT=x.jsonl npx tsx scripts/style-profile-batch.ts   seeds 1..N
//   REPORT=<dir/prefix> A="High Pressing" B=Counterattacking METRIC=tackles npx tsx scripts/style-profile-batch.ts
//
// The report gives the per-seed paired difference A - B (mean, SD, SE), the
// share of single seeds and of disjoint 6-seed windows (the test's sample)
// in which A exceeds B.

import { appendFileSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { simulateSpatialMatch, type SpatialTeamInput, type SpatialPlayerInput } from '../src/features/match/logic/spatial/simulateSpatialMatch';
import type { Role, SimPlayerStats } from '../src/features/match/logic/spatial/types';

const ROLES: Role[] = ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW'];
const stats = (b: number): SimPlayerStats => ({ shooting: b, passing: b, dribbling: b, speed: b, stamina: b, tackling: b, positioning: b, goalkeeping: b, vision: b });
function team(prefix: string, base: number, playStyle?: string): SpatialTeamInput {
  const players: SpatialPlayerInput[] = ROLES.map((role, i) => ({ id: `${prefix}-${i}`, name: `${prefix} ${i}`, role, stats: stats(base) }));
  return { formation: '4-4-2', players, ...(playStyle ? { playStyle } : {}) };
}

function profile(style: string, seed: number): { shots: number; passes: number; tackles: number } {
  let shots = 0, passes = 0, tackles = 0;
  const r = simulateSpatialMatch(team('H', 70, style), team('A', 70), { matchSeconds: 90 * 60, frameEverySec: 2, seed });
  for (const e of r.events) {
    if (e.type === 'save' && e.side === 'away') { shots += 1; continue; }
    if (e.side !== 'home') continue;
    if (e.type === 'goal' || e.type === 'woodwork' || e.type === 'penalty') shots += 1;
    else if (e.type === 'pass') passes += 1;
    else if (e.type === 'tackle') tackles += 1;
  }
  return { shots, passes, tackles };
}

const report = process.env['REPORT'];
if (report) {
  const dir = dirname(report);
  const pre = basename(report);
  const rows: Array<{ seed: number; style: string; shots: number; passes: number; tackles: number }> = [];
  for (const f of readdirSync(dir)) {
    if (!f.startsWith(pre) || !f.endsWith('.jsonl')) continue;
    for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) if (line.trim()) rows.push(JSON.parse(line));
  }
  const A = process.env['A']!; const B = process.env['B']!;
  const metric = (process.env['METRIC'] ?? 'tackles') as 'shots' | 'passes' | 'tackles';
  const by = (s: string): Map<number, number> => new Map(rows.filter((r) => r.style === s).map((r) => [r.seed, r[metric]]));
  const a = by(A); const b = by(B);
  const seeds = [...a.keys()].filter((s) => b.has(s)).sort((x, y) => x - y);
  const d = seeds.map((s) => a.get(s)! - b.get(s)!);
  const m = d.reduce((s, x) => s + x, 0) / d.length;
  const sd = Math.sqrt(d.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, d.length - 1));
  const meanA = seeds.reduce((s, k) => s + a.get(k)!, 0) / seeds.length;
  const meanB = seeds.reduce((s, k) => s + b.get(k)!, 0) / seeds.length;
  console.log(`${metric}: seeds ${seeds.length}; ${A} ${meanA.toFixed(2)} v ${B} ${meanB.toFixed(2)} a match; paired difference ${m.toFixed(2)} (per-seed SD ${sd.toFixed(2)}, SE ${(sd / Math.sqrt(d.length)).toFixed(2)}); A > B in ${(d.filter((x) => x > 0).length / d.length).toFixed(2)} of seeds`);
  for (const K of [6, 12, 18, 24]) {
    const w: number[] = [];
    for (let i = 0; i + K <= d.length; i += K) w.push(d.slice(i, i + K).reduce((s, x) => s + x, 0));
    console.log(`  ${K}-seed windows (${w.length}): A > B in ${w.filter((x) => x > 0).length}; sums ${w.join(' ')}; z of the mean = ${(m / (sd / Math.sqrt(K))).toFixed(2)}`);
  }
} else {
  const styles = (process.env['STYLES'] ?? 'High Pressing,Counterattacking').split(',');
  const n = Number(process.env['N'] ?? 120);
  const shard = Number(process.env['SHARD'] ?? 0);
  const shards = Number(process.env['SHARDS'] ?? 1);
  const out = process.env['OUT'] ?? 'style.jsonl';
  writeFileSync(out, '');
  for (let k = shard; k < n; k += shards) {
    const seed = 1 + k;
    for (const style of styles) appendFileSync(out, JSON.stringify({ seed, style, ...profile(style, seed) }) + '\n');
  }
}
