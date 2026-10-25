// scripts/shot-profile.ts
// Shot profile across seeds: distance and the shooter's own estimate, by
// outcome, plus where the possession that ended in a shot started.
//   npx tsx scripts/shot-profile.ts --seeds 1000,1001,1002

import { simulateSpatialMatch } from '../src/features/match/logic/spatial/simulateSpatialMatch';
import type { TraceRecord } from '../src/features/match/logic/spatial/types';
import { team } from './lib/engineMetrics';

const i = process.argv.indexOf('--seeds');
const seeds = (i >= 0 ? process.argv[i + 1]! : '1000,1001,1002').split(',').map(Number);
const shots: Array<{ dist: number; est: number; header: boolean; restart: string; outcome: string; pressure: number }> = [];
for (const seed of seeds) {
  let last: (typeof shots)[number] | null = null;
  simulateSpatialMatch(team('H', 70), team('A', 70), {
    seed,
    trace: (r: TraceRecord) => {
      if (r.kind === 'shot') {
        last = {
          dist: Number(r.data['dist']), est: Number(r.data['est']), header: r.data['header'] === true,
          restart: String(r.data['restart'] ?? 'header'), outcome: '?', pressure: Number(r.data['pressure'] ?? 0),
        };
        shots.push(last);
      }
      if (r.kind === 'shot_end' && last) last.outcome = String(r.data['outcome']);
      if (r.kind === 'goal' && last && last.outcome === '?') last.outcome = 'goal';
    },
  });
}
const n = seeds.length;
console.log(`${(shots.length / n).toFixed(1)} shots per match`);
const bands = [[0, 6], [6, 11], [11, 16.5], [16.5, 22], [22, 30], [30, 99]];
for (const [lo, hi] of bands) {
  const s = shots.filter((x) => x.dist >= lo! && x.dist < hi!);
  const g = s.filter((x) => x.outcome === 'goal').length;
  const est = s.reduce((a, x) => a + x.est, 0) / Math.max(1, s.length);
  console.log(`${String(lo).padStart(4)}-${String(hi).padEnd(4)} m: ${(s.length / n).toFixed(1).padStart(5)} per match, goals ${(g / n).toFixed(2)}, mean est ${est.toFixed(3)}`);
}
const by = (k: string) => shots.filter((x) => x.outcome === k).length / n;
console.log(`outcomes per match: goal ${by('goal').toFixed(2)} save ${by('save').toFixed(2)} shot ${by('shot').toFixed(2)} woodwork ${by('woodwork').toFixed(2)} unresolved ${by('?').toFixed(2)}`);
console.log(`headers ${(shots.filter((x) => x.header).length / n).toFixed(1)}, from restarts ${(shots.filter((x) => x.restart !== 'open' && x.restart !== 'header').length / n).toFixed(1)}`);
