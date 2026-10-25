// scripts/keeper-judgement.ts
// The keeper term of the shot estimate re-run AT THE STRIKE on the realised
// line (trace field kAtStrike) against what the physics did: if these agree,
// any gap at decision time comes from the strike error, not the keeper model.
//   npx tsx scripts/keeper-judgement.ts
import { simulateSpatialMatch } from '../src/features/match/logic/spatial/simulateSpatialMatch';
import { team } from './lib/engineMetrics';
type S = { k: number; d: number; out: string; t0: number; onT: boolean };
const all: S[] = []; let cur: S | null = null;
for (let m = 0; m < 20; m++) simulateSpatialMatch(team('H', 70), team('A', 70), { seed: 9100 + m, trace: (r) => {
  if (r.kind === 'shot') { cur = r.data['kAtStrike'] !== undefined && r.data['restart'] === 'open' ? { k: Number(r.data['kAtStrike']), d: Number(r.data['dist']), out: '?', t0: r.tSec, onT: r.data['onTarget'] === true } : null; if (cur) all.push(cur); return; }
  if (!cur) return;
  if (cur.out === 'shot' && r.kind === 'block' && r.tSec - cur.t0 < 1.5) { cur.out = 'block'; return; }
  if (cur.out !== '?') return;
  if (r.kind === 'goal') cur.out = 'goal'; else if (r.kind === 'shot_end') cur.out = String(r.data['outcome']);
} });
const onT = all.filter((s) => s.onT && s.out !== 'block' && s.out !== '?');
for (const [lo, hi] of [[0, 0.2], [0.2, 0.4], [0.4, 0.6], [0.6, 0.8], [0.8, 1.01]] as const) {
  const b = onT.filter((s) => s.k >= lo && s.k < hi);
  console.log(`kAtStrike ${lo}-${hi} n ${b.length} goal ${(b.filter((s) => s.out === 'goal').length / Math.max(1, b.length)).toFixed(2)} meanD ${(b.reduce((a, s) => a + s.d, 0) / Math.max(1, b.length)).toFixed(1)}`);
}
