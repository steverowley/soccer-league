// scripts/shot-calibration.ts
// Shot estimate against physics, component by component: the shooter's
// estimate of staying in the frame (pF), beating the keeper (pB) and a clear
// lane (pCl), against what happened: on target at the strike, blocked,
// saved, scored.  Binned by distance.
//   MATCHES=20 npx tsx scripts/shot-calibration.ts
import { simulateSpatialMatch } from '../src/features/match/logic/spatial/simulateSpatialMatch';
import { team } from './lib/engineMetrics';
const n = Number(process.env['MATCHES'] ?? 20);
type S = { d: number; pF: number; pB: number; pCl: number; est: number; onT: boolean; out: string };
const shots: S[] = [];
let cur: S | null = null;
for (let m = 0; m < n; m++) {
  simulateSpatialMatch(team('H', 70), team('A', 70), { seed: 9100 + m, trace: (r) => {
    if (r.kind === 'shot' && r.data['pF'] !== undefined && r.data['pF'] !== null) {
      cur = { d: Number(r.data['dist']), pF: Number(r.data['pF']), pB: Number(r.data['pB']), pCl: Number(r.data['pCl']), est: Number(r.data['est']), onT: r.data['onTarget'] === true, out: '?' };
      shots.push(cur);
    } else if (r.kind === 'shot') cur = null;
    if (cur && cur.out === 'shot' && r.kind === 'block') { cur.out = 'block'; return; }
    if (!cur || cur.out !== '?') return;
    if (r.kind === 'block') cur.out = 'block';
    else if (r.kind === 'keeper') cur.out = 'save';
    else if (r.kind === 'goal') cur.out = 'goal';
    else if (r.kind === 'shot_end') cur.out = String(r.data['outcome']);
  } });
}
const bands: Array<[string, (s: S) => boolean]> = [['<11', (s) => s.d < 11], ['11-18', (s) => s.d >= 11 && s.d < 18], ['18-25', (s) => s.d >= 18 && s.d < 25], ['25+', (s) => s.d >= 25]];
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
for (const [name, f] of bands) {
  const b = shots.filter(f);
  if (!b.length) continue;
  const unblocked = b.filter((s) => s.out !== 'block');
  const onT = unblocked.filter((s) => s.onT);
  console.log(`${name.padEnd(6)} n/match ${(b.length / n).toFixed(1)} | est ${mean(b.map((s) => s.est)).toFixed(3)} goal ${(b.filter((s) => s.out === 'goal').length / b.length).toFixed(3)} | pCl ${mean(b.map((s) => s.pCl)).toFixed(2)} unblocked ${(unblocked.length / b.length).toFixed(2)} | pF ${mean(unblocked.map((s) => s.pF)).toFixed(2)} onT ${(onT.length / Math.max(1, unblocked.length)).toFixed(2)} | pB ${mean(onT.map((s) => s.pB)).toFixed(2)} beat ${(onT.filter((s) => s.out === 'goal').length / Math.max(1, onT.length)).toFixed(2)} saved ${(onT.filter((s) => s.out === 'save').length / Math.max(1, onT.length)).toFixed(2)}`);
}
