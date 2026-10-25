// scripts/find-red-seed.ts
// Scan seeds for the sending-off test fixture (H 78 v A 60, no bench, full
// match): the first seed with a red card before 80'.   npx tsx scripts/find-red-seed.ts
import { simulateSpatialMatch } from '../src/features/match/logic/spatial/simulateSpatialMatch';
import type { Role } from '../src/features/match/logic/spatial/types';
import { stats } from './lib/engineMetrics';

const XI: Role[] = ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW'];
const team = (prefix: string, base: number) => ({ formation: '4-4-2', players: XI.map((role, i) => ({ id: `${prefix}-${i}`, name: `${prefix} ${i}`, role, stats: stats(base) })) });
for (let seed = 1; seed <= 80; seed++) {
  const r = simulateSpatialMatch(team('H', 78), team('A', 60), { matchSeconds: 90 * 60, frameEverySec: 2, seed });
  const red = r.events.find((e) => e.type === 'foul' && e.card === 'red' && e.playerId && e.tSec < 4800);
  if (red) { console.log('seed', seed, 'red at', red.tSec.toFixed(0), red.playerId); break; }
}
