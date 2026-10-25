import { simulateSpatialMatch } from '../src/features/match/logic/spatial/simulateSpatialMatch';
import { team } from './lib/engineMetrics';
// Calibration of the decision estimates against what physics then did.
const shotBins = new Map<number, [number, number, number]>();
const passBins = new Map<number, [number, number, number]>();
for (let s = 0; s < 12; s++) {
  let lastShot: { est: number } | null = null;
  let lastPass: { pC: number } | null = null;
  simulateSpatialMatch(team('H', 70), team('A', 70), { seed: 7000 + s, trace: (r) => {
    if (r.kind === 'shot') lastShot = { est: Number(r.data['est']) };
    if (r.kind === 'shot_end' && lastShot) {
      const b = Math.min(5, Math.floor(lastShot.est * 10));
      const v = shotBins.get(b) ?? [0, 0, 0]; v[0]++; v[1] += lastShot.est; shotBins.set(b, v); lastShot = null;
    }
    if (r.kind === 'goal' && lastShot) {
      const b = Math.min(5, Math.floor(lastShot.est * 10));
      const v = shotBins.get(b) ?? [0, 0, 0]; v[0]++; v[1] += lastShot.est; v[2]++; shotBins.set(b, v); lastShot = null;
    }
    if (r.kind === 'pass' && r.data['restart'] === 'open') lastPass = { pC: Number(r.data['pC']) };
    if (r.kind === 'pass_end' && lastPass) {
      const b = Math.min(9, Math.floor(lastPass.pC * 10));
      const v = passBins.get(b) ?? [0, 0, 0]; v[0]++; v[1] += lastPass.pC; if (r.data['outcome'] === 'complete') v[2]++; passBins.set(b, v); lastPass = null;
    }
  } });
}
console.log('shot est bin: n, mean est, actual goal rate');
for (const [b, [n, e, g]] of [...shotBins].sort((a, b) => a[0] - b[0])) console.log(`  ${b / 10}-${(b + 1) / 10}: ${n}  est ${(e / n).toFixed(3)}  actual ${(g / n).toFixed(3)}`);
console.log('pass pC bin: n, mean pC, actual completion');
for (const [b, [n, e, g]] of [...passBins].sort((a, b) => a[0] - b[0])) console.log(`  ${b / 10}-${(b + 1) / 10}: ${n}  pC ${(e / n).toFixed(3)}  actual ${(g / n).toFixed(3)}`);
