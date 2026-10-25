// scripts/side-split.ts
// Per-side totals over the standard batch: hunts for home/away asymmetry.
//   MATCHES=20 npx tsx scripts/side-split.ts

import { simulateSpatialMatch } from '../src/features/match/logic/spatial/simulateSpatialMatch';
import { team } from './lib/engineMetrics';

const n = Number(process.env['MATCHES'] ?? 20);
const tally: Record<string, [number, number]> = {};
for (let m = 0; m < n; m++) {
  const base = 60 + (m % 21);
  const r = simulateSpatialMatch(team('H', base), team('A', base), { seed: 1000 + m });
  for (const e of r.events) {
    if (!e.side) continue;
    const key = e.type + (e.card ? `:${e.card}` : '');
    const t = (tally[key] ??= [0, 0]);
    t[e.side === 'home' ? 0 : 1] += 1;
  }
}
for (const [k, [h, a]] of Object.entries(tally).sort()) console.log(`${k.padEnd(18)} home ${String(h).padStart(6)}  away ${String(a).padStart(6)}`);
