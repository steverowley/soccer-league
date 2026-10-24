// scripts/possession-profile.ts
// Team possessions per match: how many, how long, how far they got, and
// how many ended in a shot.  A possession is a run of controls by one side.
//   npx tsx scripts/possession-profile.ts --seeds 2000,2001,2002

import { simulateSpatialMatch } from '../src/features/match/logic/spatial/simulateSpatialMatch';
import type { TraceRecord, TeamSide } from '../src/features/match/logic/spatial/types';
import { team } from './lib/engineMetrics';

const i = process.argv.indexOf('--seeds');
const seeds = (i >= 0 ? process.argv[i + 1]! : '2000,2001,2002').split(',').map(Number);
let poss = 0;
let withShot = 0;
let reachedFinalThird = 0;
let reachedBox = 0;
let totalDur = 0;
const endKinds: Record<string, number> = {};
for (const seed of seeds) {
  let side: TeamSide | null = null;
  let start = 0;
  let shot = false;
  let ft = false;
  let box = false;
  let lastKind = '';
  const close = (t: number, why: string): void => {
    if (side === null) return;
    poss++;
    totalDur += t - start;
    if (shot) withShot++;
    if (ft) reachedFinalThird++;
    if (box) reachedBox++;
    endKinds[why] = (endKinds[why] ?? 0) + 1;
  };
  simulateSpatialMatch(team('H', 70), team('A', 70), {
    seed,
    trace: (r: TraceRecord) => {
      if (r.kind === 'dead') { close(r.tSec, 'dead:' + String(r.data['kind'])); side = null; return; }
      if (r.kind === 'shot') shot = true;
      if ((r.kind === 'control' || r.kind === 'decide') && r.side) {
        if (r.side !== side) {
          close(r.tSec, lastKind || 'turnover');
          side = r.side; start = r.tSec; shot = false; ft = false; box = false;
        }
        const prog = side === 'home' ? r.ball.x / 105 : 1 - r.ball.x / 105;
        if (prog > 2 / 3) ft = true;
        if (prog > 0.843 && r.ball.y > 13.84 && r.ball.y < 54.16) box = true;
      }
      if (r.kind === 'challenge' || r.kind === 'steal' || r.kind === 'pass_end' || r.kind === 'block') lastKind = r.kind + (r.data['outcome'] ? ':' + String(r.data['outcome']) : '');
    },
  });
}
const n = seeds.length;
console.log(`possessions per match ${(poss / n).toFixed(1)} (real: about 180 to 200 both sides)`);
console.log(`mean duration ${(totalDur / poss).toFixed(1)} s`);
console.log(`reached final third ${(reachedFinalThird / n).toFixed(1)}, reached box ${(reachedBox / n).toFixed(1)}, ended with shot ${(withShot / n).toFixed(1)}`);
console.log('how possessions ended (per match):');
for (const [k, v] of Object.entries(endKinds).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${k.padEnd(28)} ${(v / n).toFixed(1)}`);
