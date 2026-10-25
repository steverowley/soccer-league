// scripts/red-reasons.ts
// Why players are sent off (DOGSO, a severe challenge, a charge), and the
// phase the offending side was in and for how long.
//   MATCHES=40 npx tsx scripts/red-reasons.ts
import { simulateSpatialMatch } from '../src/features/match/logic/spatial/simulateSpatialMatch';
import type { TeamSide } from '../src/features/match/logic/spatial/types';
import { team } from './lib/engineMetrics';

const n = Number(process.env['MATCHES'] ?? 40);
const why: Record<string, number> = {};
const phaseOf: Record<string, number> = {};
let reds = 0;
for (let m = 0; m < n; m++) {
  const base = 60 + (m % 21);
  const hits: Array<{ t: number; side: TeamSide; k: string }> = [];
  const res = simulateSpatialMatch(team('H', base), team('A', base), { seed: 1000 + m, trace: (r) => {
    if (r.data['outcome'] !== 'foul' || r.data['card'] !== 'red') return;
    const k = `${r.data['how']}${r.data['dogso'] ? ' dogso' : ''}${Number(r.data['severity']) >= 2.1 ? ' severe' : ''}`;
    hits.push({ t: r.tSec, side: r.side as TeamSide, k });
  } });
  for (const h of hits) {
    reds++;
    why[h.k] = (why[h.k] ?? 0) + 1;
    let ph = 'none';
    let since = 0;
    for (const c of res.phases?.[h.side] ?? []) if (c.tSec <= h.t) { ph = c.phase; since = c.tSec; }
    const key = `${ph} (${h.t - since < 3 ? 'under 3 s' : '3 s or more'})`;
    phaseOf[key] = (phaseOf[key] ?? 0) + 1;
  }
}
console.log('reds per match', (reds / n).toFixed(3), why);
console.log('offending side phase', phaseOf);
