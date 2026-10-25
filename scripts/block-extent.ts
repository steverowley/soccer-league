// scripts/block-extent.ts
// Who sets the length of a block out of possession: per frame of a settled
// block (out of possession, 6 s or more after the loss, play live), the role
// of the deepest and the most advanced outfielder and how far each line sits
// from the back line.   MATCHES=12 npx tsx scripts/block-extent.ts
import { simulateSpatialMatch } from '../src/features/match/logic/spatial/simulateSpatialMatch';
import type { PositionFrame } from '../src/features/match/logic/spatial/types';
import { team } from './lib/engineMetrics';

const n = Number(process.env['MATCHES'] ?? 12);
const roleOf = (id: string): string => {
  const k = Number(id.split('-').pop());
  if (id.includes('sub')) return 'sub';
  return k === 0 ? 'GK' : k <= 4 ? 'DF' : k <= 8 ? 'MF' : 'FW';
};
const top: Record<string, number> = {};
const bottom: Record<string, number> = {};
const lineSum: Record<string, number> = { DF: 0, MF: 0, FW: 0 };
let frames = 0;
let lenSum = 0;
let gapTop = 0;
let gapBottom = 0;
for (let m = 0; m < n; m++) {
  const base = 60 + (m % 21);
  const r = simulateSpatialMatch(team('H', base), team('A', base), { seed: 1000 + m, frameEverySec: 1 });
  const tl = r.phases!;
  const idx: Record<string, number> = { home: 0, away: 0 };
  const phaseAt = (side: 'home' | 'away', t: number): string => {
    const a = tl[side];
    while (idx[side]! + 1 < a.length && a[idx[side]! + 1]!.tSec <= t) idx[side]!++;
    return a[idx[side]!]!.phase;
  };
  let poss: string | null = null;
  let changeAt = -100;
  for (const f of r.frames as PositionFrame[]) {
    const o = f.ball.ownerId ? f.ball.ownerId[0]! : null;
    if (o && o !== poss) { if (poss) changeAt = f.tSec; poss = o; }
    if (!poss || f.tSec - changeAt < 6) continue;
    for (const s of ['H', 'A']) {
      const dead = phaseAt(s === 'H' ? 'home' : 'away', f.tSec) === 'set_piece';
      if (s === poss || (dead ? 'dead' : 'live') !== (process.env['WHICH'] ?? 'live')) continue;
      const own = s === 'H' ? 0 : 105;
      const ps = f.players.filter((p) => p.id[0] === s && p.x >= 0 && roleOf(p.id) !== 'GK')
        .map((p) => ({ id: p.id, r: roleOf(p.id), d: Math.abs(p.x - own) }));
      if (ps.length < 8) continue;
      const cent = ps.reduce((a, p) => a + p.d, 0) / ps.length;
      if (cent < 20 || cent > 60) continue;
      ps.sort((a, b) => a.d - b.d);
      frames++;
      lenSum += ps[ps.length - 1]!.d - ps[0]!.d;
      gapTop += ps[ps.length - 1]!.d - ps[ps.length - 2]!.d;
      gapBottom += ps[1]!.d - ps[0]!.d;
      top[ps[ps.length - 1]!.r] = (top[ps[ps.length - 1]!.r] ?? 0) + 1;
      bottom[ps[0]!.r] = (bottom[ps[0]!.r] ?? 0) + 1;
      const back = ps[1]!.d;
      for (const k of ['DF', 'MF', 'FW']) {
        const xs = ps.filter((p) => p.r === k);
        if (xs.length) lineSum[k] = lineSum[k]! + xs.reduce((a, p) => a + p.d, 0) / xs.length - back;
      }
    }
  }
}
console.log('mid-block frames', frames, 'length', (lenSum / frames).toFixed(1), 'top man ahead of next', (gapTop / frames).toFixed(1), 'deepest behind next', (gapBottom / frames).toFixed(1));
console.log('most advanced by role', Object.fromEntries(Object.entries(top).map(([k, v]) => [k, (v / frames).toFixed(2)])));
console.log('deepest by role', Object.fromEntries(Object.entries(bottom).map(([k, v]) => [k, (v / frames).toFixed(2)])));
console.log('line mean ahead of back two', Object.fromEntries(Object.entries(lineSum).map(([k, v]) => [k, (v / frames).toFixed(1)])));
