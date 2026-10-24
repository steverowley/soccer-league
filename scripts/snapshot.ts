// scripts/snapshot.ts
// Positions of all 22 players and the ball at given match seconds.
//   npx tsx scripts/snapshot.ts --seed 2001 --t 1934,1936,1938

import { simulateSpatialMatch } from '../src/features/match/logic/spatial/simulateSpatialMatch';
import { team } from './lib/engineMetrics';

const arg = (k: string, d: string): string => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1]! : d;
};
const seed = Number(arg('--seed', '1000'));
const base = Number(arg('--base', '70'));
const times = arg('--t', '600').split(',').map(Number);
const r = simulateSpatialMatch(team('H', base), team('A', base), { seed });
for (const t of times) {
  const f = r.frames.reduce((best, fr) => (Math.abs(fr.tSec - t) < Math.abs(best.tSec - t) ? fr : best), r.frames[0]!);
  console.log(`t=${f.tSec}s ball (${f.ball.x.toFixed(1)}, ${f.ball.y.toFixed(1)}, z${f.ball.ownerId ?? "-"})`);
  const row = (side: 'home' | 'away'): string => f.players
    .filter((p) => (side === 'home' ? p.id.startsWith('H') : p.id.startsWith('A')))
    .map((p) => `${p.id}(${p.x.toFixed(0)},${p.y.toFixed(0)})`).join(' ');
  console.log('  home ' + row('home'));
  console.log('  away ' + row('away'));
}
