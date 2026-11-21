// scripts/counterpress-batch.ts
// Counter-press v recover over many match pairs, the measurement behind the
// thresholds in src/features/match/logic/spatial/counterpress.test.ts.  Uses
// the test's own metric (src/features/match/logic/calibration/counterpressMetric.ts).
//
//   N=40 SHARD=0 SHARDS=8 OUT=x.jsonl npx tsx scripts/counterpress-batch.ts   pairs k = SHARD, SHARD+SHARDS, ...; seeds 4100 + 2k
//   REPORT=<dir/prefix> npx tsx scripts/counterpress-batch.ts                    aggregate shards
//
// The report gives, for both the men-near and the regained-in-6-s share, the
// pooled value over all pairs and the per-pair spread of the difference
// (press minus recover), from which a threshold for a test of K pairs is set.

import { appendFileSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { counterpressPair, type CounterpressPair } from '../src/features/match/logic/calibration/counterpressMetric';

const report = process.env['REPORT'];
if (report) {
  const dir = dirname(report);
  const pre = basename(report);
  const rows: Array<CounterpressPair & { seed: number }> = [];
  for (const f of readdirSync(dir)) {
    if (!f.startsWith(pre) || !f.endsWith('.jsonl')) continue;
    for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) if (line.trim()) rows.push(JSON.parse(line));
  }
  rows.sort((a, b) => a.seed - b.seed);
  const n = rows.length;
  const ms = (xs: number[]): { m: number; sd: number; se: number } => {
    const m = xs.reduce((s, x) => s + x, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, xs.length - 1));
    return { m, sd, se: sd / Math.sqrt(xs.length) };
  };
  const pooled = (k: 'near' | 'regained', s: 'P' | 'R'): number => rows.reduce((a, r) => a + r[s][k], 0) / rows.reduce((a, r) => a + r[s].losses, 0);
  for (const k of ['near', 'regained'] as const) {
    const d = ms(rows.map((r) => r.P[k] / r.P.losses - r.R[k] / r.R.losses));
    const p = ms(rows.map((r) => r.P[k] / r.P.losses));
    console.log(`${k}: pairs ${n}, press ${pooled(k, 'P').toFixed(3)} recover ${pooled(k, 'R').toFixed(3)}; per-pair press ${p.m.toFixed(3)} (SD ${p.sd.toFixed(3)}); difference ${d.m.toFixed(3)} (per-pair SD ${d.sd.toFixed(3)}, SE ${d.se.toFixed(3)})`);
    for (const K of [1, 4, 6, 8]) {
      console.log(`  test of ${K} pair(s): difference SE ${(d.sd / Math.sqrt(K)).toFixed(3)}, mean minus 2.5 SE ${(d.m - 2.5 * d.sd / Math.sqrt(K)).toFixed(3)}; press minus 2.5 SE ${(p.m - 2.5 * p.sd / Math.sqrt(K)).toFixed(3)}`);
    }
  }
  const minLosses = Math.min(...rows.map((r) => r.P.losses));
  console.log(`fewest press losses in one pair ${minLosses}`);
  for (const K of [4, 6, 8]) {
    // Every disjoint window of K consecutive pairs, as a test of K pairs would see it.
    const wins: number[] = [];
    for (let i = 0; i + K <= n; i += K) {
      const w = rows.slice(i, i + K);
      const sum = (s: 'P' | 'R', k: 'losses' | 'regained'): number => w.reduce((a, r) => a + r[s][k], 0);
      wins.push(sum('P', 'regained') / sum('P', 'losses') - sum('R', 'regained') / sum('R', 'losses'));
    }
    console.log(`  disjoint ${K}-pair windows, regained difference: ${wins.map((x) => x.toFixed(3)).join(' ')}`);
  }
} else {
  const n = Number(process.env['N'] ?? 40);
  const shard = Number(process.env['SHARD'] ?? 0);
  const shards = Number(process.env['SHARDS'] ?? 1);
  const out = process.env['OUT'] ?? 'cp.jsonl';
  writeFileSync(out, '');
  for (let k = shard; k < n; k += shards) {
    const seed = 4100 + 2 * k;
    appendFileSync(out, JSON.stringify({ seed, ...counterpressPair(seed) }) + '\n');
  }
}
