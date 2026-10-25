// scripts/diag-out.ts: for throw-ins, print what led up to the ball going out.
import { simulateSpatialMatch } from '../src/features/match/logic/spatial/simulateSpatialMatch';
import type { TraceRecord } from '../src/features/match/logic/spatial/types';
import { team } from './lib/engineMetrics';

const recs: TraceRecord[] = [];
const r = simulateSpatialMatch(team('H', 70), team('A', 70), { seed: Number(process.argv[2] ?? 1000), trace: (x: TraceRecord) => { recs.push(x); } });
let shown = 0;
for (const e of r.events) {
  if (e.type !== 'out_throw' || shown >= Number(process.argv[3] ?? 25)) continue;
  const before = recs.filter((x) => x.tSec <= e.tSec + 0.05 && x.tSec > e.tSec - 2.5 && x.kind !== 'confidence');
  console.log(`-- throw at ${e.tSec.toFixed(1)} to ${e.side}`);
  for (const x of before.slice(-6)) {
    console.log(`   ${x.tSec} ${x.kind} ${x.playerId ?? ''} ball(${x.ball.x},${x.ball.y},${x.ball.z}) ${JSON.stringify(x.data).slice(0, 110)}`);
  }
  shown++;
}
