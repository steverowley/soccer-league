// scripts/swap-identity.ts
// Shows why a venue swap of two IDENTICAL sides measures nothing: the
// engine keys every imprecision stream on roster index, and team ids are
// inert, so A(home) v B(away) and B(home) v A(away) on one seed are the same
// match.  A swap must use sides of different ratings (batch-json MODE=swap).
import { simulateSpatialMatch } from '../src/features/match/logic/spatial/simulateSpatialMatch';
import { team } from './lib/engineMetrics';

let same = 0;
const n = Number(process.env['MATCHES'] ?? 6);
for (let m = 0; m < n; m++) {
  const a = simulateSpatialMatch(team('A', 70), team('B', 70), { seed: 5000 + m });
  const b = simulateSpatialMatch(team('B', 70), team('A', 70), { seed: 5000 + m });
  const sig = (r: typeof a) => `${r.finalScore.join('-')}/${r.events.length}`;
  if (sig(a) === sig(b)) same++;
  console.log(`seed ${5000 + m}: ${sig(a)} vs swapped ${sig(b)}`);
}
console.log(`${same}/${n} swapped pairs identical`);
