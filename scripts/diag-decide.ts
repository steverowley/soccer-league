// scripts/diag-decide.ts: print a sample of carrier decisions with their top options.
import { simulateSpatialMatch } from '../src/features/match/logic/spatial/simulateSpatialMatch';
import type { TraceRecord } from '../src/features/match/logic/spatial/types';
import { team } from './lib/engineMetrics';

const recs: TraceRecord[] = [];
simulateSpatialMatch(team('H', 70), team('A', 70), { seed: Number(process.argv[2] ?? 1000), trace: (x: TraceRecord) => { recs.push(x); } });
let shown = 0;
for (let i = 0; i < recs.length && shown < Number(process.argv[3] ?? 40); i++) {
  const r = recs[i]!;
  if (r.kind !== 'pass' || r.data['restart'] !== 'open') continue;
  const dec = recs.slice(Math.max(0, i - 3), i).reverse().find((x) => x.kind === 'decide');
  console.log(r.tSec, r.playerId, 'dist', r.data['dist'], 'pC', r.data['pC'], 'u', r.data['u'], '|', dec ? dec.data['top'] : '', 'ball', r.ball.x, r.ball.y);
  shown++;
}
