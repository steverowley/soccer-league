// scripts/side-diag.ts
// Per-side diagnostics over a paired venue-swap batch: confidence over time,
// challenge outcomes, decision mix, execution error scale, shots and goals.
// Hunts for side-asymmetric behaviour.
//   MATCHES=20 OFF=homeAdvantage npx tsx scripts/side-diag.ts

import { simulateSpatialMatch } from '../src/features/match/logic/spatial/simulateSpatialMatch';
import { team } from './lib/engineMetrics';
import type { EngineFlags, TraceRecord } from '../src/features/match/logic/spatial/types';

const n = Number(process.env['MATCHES'] ?? 20);
const off = (process.env['OFF'] ?? '').split(',').filter(Boolean);
const flags: Partial<EngineFlags> = {};
for (const f of off) (flags as Record<string, boolean>)[f] = false;

type Tally = Record<string, number>;
const side: Record<'home' | 'away', Tally> = { home: {}, away: {} };
const add = (s: 'home' | 'away', k: string, v = 1): void => { side[s][k] = (side[s][k] ?? 0) + v; };
const confByMin: { h: number[]; a: number[] } = { h: Array(96).fill(0), a: Array(96).fill(0) };
let confN = 0;
for (let m = 0; m < n; m++) {
  const base = 60 + (m % 21);
  for (const swap of [false, true]) {
    const mins: number[] = [];
    const trace = (r: TraceRecord): void => {
      if (r.kind === 'confidence') {
        const mi = Math.min(95, Math.floor(r.tSec / 60));
        confByMin.h[mi]! += Number(r.data['home']);
        confByMin.a[mi]! += Number(r.data['away']);
        if (mi === 1) confN++;
        mins.push(mi);
        return;
      }
      const s = r.side;
      if (!s) return;
      add(s, r.kind);
      if (r.kind === 'challenge') add(s, `challenge:${r.data['outcome']}`);
      if (r.kind === 'decide') add(s, `decide:${r.data['action']}`);
      if (r.kind === 'pass' || r.kind === 'shot') { add(s, `${r.kind}:errSum`, Number(r.data['errScale'] ?? 0)); }
      if (r.kind === 'pass_end') add(s, `pass_end:${r.data['outcome']}`);
      if (r.kind === 'lunge' && r.data['tactical']) add(s, 'lunge:tactical');
    };
    const r = simulateSpatialMatch(team(swap ? 'B' : 'A', base), team(swap ? 'A' : 'B', base), { seed: 5000 + m, trace, flags });
    add('home', 'goals', r.finalScore[0]);
    add('away', 'goals', r.finalScore[1]);
    for (const e of r.events) if (e.side) add(e.side, `ev:${e.type}${e.card ? ':' + e.card : ''}`);
  }
}
const keys = [...new Set([...Object.keys(side.home), ...Object.keys(side.away)])].sort();
console.log(`matches ${n * 2} off=[${off.join(',')}]`);
for (const k of keys) {
  const h = side.home[k] ?? 0, a = side.away[k] ?? 0;
  if (k.endsWith(':errSum')) {
    const base = k.split(':')[0]!;
    console.log(`${k.padEnd(26)} mean home ${(h / (side.home[base] ?? 1)).toFixed(3)} away ${(a / (side.away[base] ?? 1)).toFixed(3)}`);
  } else console.log(`${k.padEnd(26)} home ${String(Math.round(h)).padStart(7)} away ${String(Math.round(a)).padStart(7)}  ratio ${(h / Math.max(1, a)).toFixed(3)}`);
}
const row = (xs: number[]): string => [5, 15, 30, 45, 60, 75, 89].map((i) => (xs[i]! / Math.max(1, confN)).toFixed(3)).join(' ');
console.log(`confidence home @5,15,30,45,60,75,89: ${row(confByMin.h)}`);
console.log(`confidence away @5,15,30,45,60,75,89: ${row(confByMin.a)}`);
