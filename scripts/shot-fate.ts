// scripts/shot-fate.ts
// What physically happens to shots that leave the boot on target: the next
// few trace records (keeper catch/parry, block, frame, goal), by distance.
//   MATCHES=10 npx tsx scripts/shot-fate.ts
import { simulateSpatialMatch } from '../src/features/match/logic/spatial/simulateSpatialMatch';
import { team } from './lib/engineMetrics';
const n = Number(process.env['MATCHES'] ?? 10);
const fate: Record<string, number> = {};
let cur: { kinds: string[]; d: number; t: number } | null = null;
let samples = 0;
const flush = () => { if (cur) { const k = (cur.d < 18 ? 'near ' : 'far  ') + cur.kinds.slice(0, 3).join('>'); fate[k] = (fate[k] ?? 0) + 1; } cur = null; };
for (let m = 0; m < n; m++) {
  simulateSpatialMatch(team('H', 70), team('A', 70), { seed: 9100 + m, trace: (r) => {
    if (r.kind === 'shot') { flush(); if (r.data['onTarget'] === true && r.data['header'] !== true) cur = { kinds: [], d: Number(r.data['dist']), t: r.tSec }; return; }
    if (!cur) return;
    if (r.tSec - cur.t > 3) { flush(); return; }
    if (['decide', 'confidence', 'pass_end'].includes(r.kind)) return;
    let k = r.kind;
    if (k === 'keeper') k += ':' + r.data['action'];
    if (k === 'shot_end') k += ':' + r.data['outcome'];
    cur.kinds.push(k);
    if (samples < 6 && r.kind === 'keeper') { samples++; console.log(JSON.stringify(r)); }
  } });
}
flush();
for (const [k, v] of Object.entries(fate).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(String(v).padStart(4), k);
