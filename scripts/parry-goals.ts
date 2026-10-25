// scripts/parry-goals.ts
// Parries that end in the keeper's own net: the contact (stretch, height,
// pace in and out) against parries that did not.   MATCHES=40 npx tsx scripts/parry-goals.ts
import { simulateSpatialMatch } from '../src/features/match/logic/spatial/simulateSpatialMatch';
import { team } from './lib/engineMetrics';

const n = Number(process.env['MATCHES'] ?? 40);
type P = { t: number; side: string; stretch: number; speed: number; out: number; z: number; ky: number; by: number; vx: number; vy: number };
const rows: Array<P & { goal: boolean }> = [];
for (let m = 0; m < n; m++) {
  const base = 60 + (m % 21);
  const ps: P[] = [];
  const r = simulateSpatialMatch(team('H', base), team('A', base), { seed: 1000 + m, trace: (t) => {
    if (t.kind === 'keeper' && t.data['action'] === 'parry') {
      ps.push({ t: t.tSec, side: t.side!, stretch: Number(t.data['stretch']), speed: Number(t.data['speed']), out: Number(t.data['out']), z: t.ball.z, ky: Number(t.data['ky']), by: t.ball.y, vx: Number(t.data['vx'] ?? 0), vy: Number(t.data['vy'] ?? 0) });
    }
  } });
  for (const p of ps) {
    const goal = r.events.some((e) => e.type === 'goal' && e.side !== p.side && e.tSec >= p.t && e.tSec <= p.t + 1.5);
    rows.push({ ...p, goal });
  }
}
const g = rows.filter((r) => r.goal);
const ng = rows.filter((r) => !r.goal);
const mean = (xs: number[]): string => (xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)).toFixed(2);
console.log('parries per match', (rows.length / n).toFixed(2), 'into own net within 1.5 s per match', (g.length / n).toFixed(2));
for (const [k, xs] of [['into net', g], ['not', ng]] as const) {
  console.log(k.padEnd(9), 'n', xs.length, 'stretch', mean(xs.map((x) => x.stretch)), 'z', mean(xs.map((x) => x.z)), 'in', mean(xs.map((x) => x.speed)), 'out', mean(xs.map((x) => x.out)),
    'ball off centre', mean(xs.map((x) => Math.abs(x.by - 34))), 'ball-keeper same side', mean(xs.map((x) => ((x.by - 34) * (x.by - x.ky) >= 0 ? 1 : 0))));
}
const bins = [0, 0.5, 0.8, 0.95, 1.01];
for (let i = 0; i < bins.length - 1; i++) {
  const xs = rows.filter((r) => r.stretch >= bins[i]! && r.stretch < bins[i + 1]!);
  console.log(`stretch ${bins[i]}-${bins[i + 1]}`, 'n', xs.length, 'into net', xs.filter((x) => x.goal).length);
}
