// scripts/keeper-probe.ts
// For on-target long shots: where the keeper stood at the strike, how far he
// was from the realised line of the ball, the time the ball took to reach
// him, and what then happened.  Compares the physics with the shooter's
// keeper model (evaluate.ts beatKeeper).
//   MATCHES=6 MIN=18 MAX=25 npx tsx scripts/keeper-probe.ts
import { simulateSpatialMatch } from '../src/features/match/logic/spatial/simulateSpatialMatch';
import { team } from './lib/engineMetrics';
const n = Number(process.env['MATCHES'] ?? 6);
const lo = Number(process.env['MIN'] ?? 18);
const hi = Number(process.env['MAX'] ?? 25);
type Row = { s: Record<string, unknown>; bx: number; by: number; t0: number; out: string; k?: Record<string, unknown>; kAt?: { x: number; y: number }; t1?: number };
const rows: Row[] = [];
let cur: Row | null = null;
for (let m = 0; m < n; m++) {
  simulateSpatialMatch(team('H', 70), team('A', 70), { seed: 9100 + m, trace: (r) => {
    if (r.kind === 'shot') {
      const d = Number(r.data['dist']);
      cur = d >= lo && d < hi && r.data['onTarget'] === true ? { s: r.data, bx: r.ball.x, by: r.ball.y, t0: r.tSec, out: '?' } : null;
      if (cur) rows.push(cur);
      return;
    }
    if (cur && r.kind === 'keeper' && cur.t1 === r.tSec) { cur.k = r.data; return; }
    if (!cur || cur.out !== '?') return;
    if (r.kind === 'dive') { (cur as Row & { dv?: string }).dv = `dive@+${(r.tSec - cur.t0).toFixed(1)} k(${r.data['kx']},${r.data['ky']}) v(${r.data['vx']},${r.data['vy']}) to ${r.data['toY']}`; return; }
    if (r.kind === 'block' || r.kind === 'goal' || r.kind === 'keeper' || r.kind === 'shot_end' || r.kind === 'woodwork') {
      cur.out = r.kind === 'keeper' ? String(r.data['action']) : r.kind;
      cur.k = r.data; cur.kAt = { x: r.ball.x, y: r.ball.y }; cur.t1 = r.tSec;
    }
  } });
}
for (const r of rows.slice(0, 40)) {
  const s = r.s;
  const gx = r.bx > 52 ? 105 : 0;
  const ang = Math.atan2(Number(s['aimY']) - r.by, gx - r.bx) + Number(s['angErr']);
  const kx = Number(s['kx']); const ky = Number(s['ky']);
  // Lateral distance from keeper to the realised line.
  const dx = Math.cos(ang); const dy = Math.sin(ang);
  const along = (kx - r.bx) * dx + (ky - r.by) * dy;
  const lat = Math.abs(-(kx - r.bx) * dy + (ky - r.by) * dx);
  const crossY = r.by + Math.tan(ang) * (gx - r.bx);
  console.log(`d ${Number(s['dist']).toFixed(1)} sp ${s['speed']} aimY ${s['aimY']} crossY ${crossY.toFixed(2)} k(${kx},${ky}) along ${along.toFixed(1)} lat ${lat.toFixed(2)} est ${s['est']} pB ${s['pB']} -> ${r.out} dt ${r.t1 !== undefined ? (r.t1 - r.t0).toFixed(1) : '-'} ${r.k ? JSON.stringify(r.k) : ''} at ${r.kAt ? r.kAt.x + "," + r.kAt.y : ""} ${(r as Row & { dv?: string }).dv ?? "nodive"}`);
}
const tally: Record<string, number> = {};
for (const r of rows) tally[r.out] = (tally[r.out] ?? 0) + 1;
console.log(rows.length, tally);
