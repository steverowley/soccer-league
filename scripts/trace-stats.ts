// scripts/trace-stats.ts
// Count trace-record kinds (and selected sub-outcomes) for one or more seeds:
// a quick diagnostic for which mechanism is producing a metric.
//   npx tsx scripts/trace-stats.ts --seeds 1000,1001 --base 70

import { simulateSpatialMatch } from '../src/features/match/logic/spatial/simulateSpatialMatch';
import type { TraceRecord } from '../src/features/match/logic/spatial/types';
import { team } from './lib/engineMetrics';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const seeds = (arg('seeds') ?? '1000').split(',').map(Number);
const base = Number(arg('base') ?? 70);
const counts = new Map<string, number>();
const add = (k: string): void => { counts.set(k, (counts.get(k) ?? 0) + 1); };
const evCounts = new Map<string, number>();
for (const seed of seeds) {
  const r = simulateSpatialMatch(team('H', base), team('A', base), {
    seed,
    trace: (rec: TraceRecord) => {
      add(rec.kind);
      for (const key of ['outcome', 'action', 'kind']) {
        const v = rec.data[key];
        if (typeof v === 'string') add(`${rec.kind}.${key}=${v}`);
      }
    },
  });
  for (const e of r.events) evCounts.set(e.type, (evCounts.get(e.type) ?? 0) + 1);
}
const n = seeds.length;
console.log('trace kinds per match:');
for (const [k, v] of [...counts.entries()].sort()) console.log(`  ${k.padEnd(34)} ${(v / n).toFixed(1)}`);
console.log('events per match:');
for (const [k, v] of [...evCounts.entries()].sort()) console.log(`  ${k.padEnd(34)} ${(v / n).toFixed(1)}`);
