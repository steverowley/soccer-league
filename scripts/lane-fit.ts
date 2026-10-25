// scripts/lane-fit.ts
// Shots against what the physics did with them, by the nearest opponent's
// distance off the realised line at the strike (laneD): the block rate the
// shooter's estimate (evaluate.ts estimateShot pClear) has to reproduce.
// Also the keeper: on-target unblocked shots by the keeper's distance off
// the line and the ball's time to him.
//   MATCHES=20 npx tsx scripts/lane-fit.ts
import { simulateSpatialMatch } from '../src/features/match/logic/spatial/simulateSpatialMatch';
import { airTravelTime } from '../src/features/match/logic/spatial/ball';
import { team } from './lib/engineMetrics';
const n = Number(process.env['MATCHES'] ?? 20);
type S = { laneD: number; laneFrom: number; blk: number; pCl: number; out: string; lat: number; tK: number; onT: boolean; pB: number };
const shots: S[] = [];
let cur: S | null = null;
let t0 = 0;
for (let m = 0; m < n; m++) {
  simulateSpatialMatch(team('H', 70), team('A', 70), { seed: 9100 + m, trace: (r) => {
    if (r.kind === 'shot') {
      const d = r.data;
      if (d['laneD'] === undefined || d['restart'] !== 'open') { cur = null; return; }
      const gx = r.ball.x > 52 ? 105 : 0;
      const ang = Math.atan2(Number(d['aimY']) - r.ball.y, gx - r.ball.x) + Number(d['angErr']);
      const kx = Number(d['kx']), ky = Number(d['ky']);
      const dx = Math.cos(ang), dy = Math.sin(ang);
      const along = (kx - r.ball.x) * dx + (ky - r.ball.y) * dy;
      const lat = Math.abs(-(kx - r.ball.x) * dy + (ky - r.ball.y) * dx);
      cur = { laneD: Number(d['laneD']), laneFrom: Number(d['laneFrom']), blk: Number(d['laneBlk']), pCl: Number(d['pCl']), out: '?', lat, tK: airTravelTime(Number(d['speed']), Math.max(0, along)), onT: d['onTarget'] === true, pB: Number(d['pB']) };
      shots.push(cur); t0 = r.tSec;
      return;
    }
    if (cur && cur.out === 'shot' && r.kind === 'block' && r.tSec - t0 < 1.5) { cur.out = 'block'; return; }
    if (!cur || cur.out !== '?') return;
    if (r.kind === 'block') cur.out = 'block';
    else if (r.kind === 'keeper') cur.out = 'save';
    else if (r.kind === 'goal') cur.out = 'goal';
    else if (r.kind === 'shot_end') cur.out = String(r.data['outcome']);
  } });
}
console.log('shots', shots.length, 'blocked', shots.filter((s) => s.out === 'block').length);
const bins = [0, 0.3, 0.6, 0.9, 1.2, 1.6, 2.2, 3, 5, 99];
for (const near of [true, false]) {
  for (let i = 0; i < bins.length - 1; i++) {
    const b = shots.filter((s) => s.laneD >= bins[i]! && s.laneD < bins[i + 1]! && (s.laneFrom < 7) === near);
    if (b.length < 3) continue;
    const blocked = b.filter((s) => s.out === 'block').length / b.length;
    const est = b.reduce((a, s) => a + s.pCl, 0) / b.length;
    console.log(`${near ? 'from<7 ' : 'from7+ '} laneD ${bins[i]}-${bins[i + 1]} n ${b.length} blocked ${blocked.toFixed(2)} thrown ${(b.filter((s) => s.blk).length / b.length).toFixed(2)} | est pCl ${est.toFixed(2)}`);
  }
}
const onT = shots.filter((s) => s.onT && s.out !== 'block' && s.out !== '?');
console.log('keeper: on-target unblocked', onT.length);
for (const [lo, hi] of [[0, 1], [1, 1.75], [1.75, 2.5], [2.5, 3.25], [3.25, 9]] as const) {
  for (const [tl, th] of [[0, 0.35], [0.35, 0.55], [0.55, 0.75], [0.75, 9]] as const) {
    const b = onT.filter((s) => s.lat >= lo && s.lat < hi && s.tK >= tl && s.tK < th);
    if (b.length < 3) continue;
    console.log(`lat ${lo}-${hi} tK ${tl}-${th} n ${b.length} goal ${(b.filter((s) => s.out === 'goal').length / b.length).toFixed(2)} est pB ${(b.reduce((a, s) => a + s.pB, 0) / b.length).toFixed(2)}`);
  }
}
// Fit the keeper model of evaluate.ts (react, reach) to what happened.
import { diveTime } from '../src/features/match/logic/spatial/evaluate';
let bestLL = -Infinity, bestP = '';
for (let react = 0.0; react <= 0.4; react += 0.025) {
  for (let reach = 1.0; reach <= 2.6; reach += 0.05) {
    let ll = 0;
    for (const s of onT) {
      const need = react + diveTime(Math.max(0, s.lat - reach), 5.1);
      const p = Math.min(0.999, Math.max(0.001, 1 / (1 + Math.exp(-(s.tK - need) / 0.09))));
      ll += s.out === 'goal' ? Math.log(p) : Math.log(1 - p);
    }
    if (ll > bestLL) { bestLL = ll; bestP = `react ${react.toFixed(3)} reach ${reach.toFixed(2)} ll ${ll.toFixed(1)}`; }
  }
}
console.log('keeper fit', bestP);
