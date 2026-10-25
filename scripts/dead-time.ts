// scripts/dead-time.ts
// Dead-ball time per restart kind: count per match and mean seconds from the
// ball going dead to the restart being taken.  MATCHES=16 npx tsx scripts/dead-time.ts
import { simulateSpatialMatch } from '../src/features/match/logic/spatial/simulateSpatialMatch';
import { team } from './lib/engineMetrics';

const n = Number(process.env['MATCHES'] ?? 16);
const t: Record<string, [number, number]> = {};
for (let m = 0; m < n; m++) {
  let at = -1;
  let kind = '';
  const base = 60 + (m % 21);
  simulateSpatialMatch(team('H', base), team('A', base), { seed: 1000 + m, trace: (r) => {
    if (r.kind === 'dead') { at = r.tSec; kind = String(r.data['kind']); }
    if (r.kind === 'restart' && at >= 0) { const row = (t[kind] ??= [0, 0]); row[0]++; row[1] += r.tSec - at; at = -1; }
  } });
}
for (const [k, [c, s]] of Object.entries(t).sort()) console.log(`${k.padEnd(9)} ${(c / n).toFixed(1).padStart(5)}/match  ${(s / c).toFixed(1).padStart(5)} s each  ${(s / n / 60).toFixed(2)} min/match`);
