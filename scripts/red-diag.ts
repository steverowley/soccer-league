// scripts/red-diag.ts
// What the defender decided before each red card: the lunge record that led
// to it (tactical foul or a go at the ball, his own estimate of winning the
// ball, last man or not, behind the carrier or not) and the foul facts.
//   MATCHES=60 npx tsx scripts/red-diag.ts
import { simulateSpatialMatch } from '../src/features/match/logic/spatial/simulateSpatialMatch';
import { team } from './lib/engineMetrics';

const n = Number(process.env['MATCHES'] ?? 60);
const seedBase = Number(process.env['SEED_BASE'] ?? 1000);
const tally: Record<string, number> = {};
const lungeTally: Record<string, number> = {};
let reds = 0;
const fouls: Record<string, number> = {};
for (let m = 0; m < n; m++) {
  const base = 60 + (m % 21);
  const last = new Map<string, Record<string, unknown>>();
  simulateSpatialMatch(team('H', base), team('A', base), { seed: seedBase + m, trace: (r) => {
    const id = r.playerId ?? '';
    if (r.kind === 'lunge') {
      last.set(id, r.data);
      const k = `${r.data['tactical'] ? 'tactical' : 'ball'}${r.data['lastMan'] ? ' lastMan' : ''}${r.data['inBox'] ? ' inBox' : ''}`;
      lungeTally[k] = (lungeTally[k] ?? 0) + 1;
    }
    if (r.kind === 'challenge' && r.data['outcome'] === 'foul') {
      const L = last.get(id);
      const k = `${r.data['how']}${r.data['how'] === 'lunge' && L ? (L['tactical'] ? ' tactical' : ' at ball') : ''}${r.data['card'] ? ' ' + r.data['card'] : ''}`;
      fouls[k] = (fouls[k] ?? 0) + 1;
    }
    if (r.kind === 'challenge' && r.data['outcome'] === 'foul' && r.data['card'] === 'red') {
      reds++;
      const L = last.get(id);
      const k = `${r.data['how']}${r.data['dogso'] ? ' dogso' : ''}${Number(r.data['severity']) >= 2.1 ? ' severe' : ''}`
        + (L && r.data['how'] === 'lunge' ? ` | ${L['tactical'] ? 'tactical' : 'ball'} pBall ${Number(L['pBall']) >= 0.5 ? '>=.5' : '<.5'}${L['behind'] ? ' behind' : ''}` : '');
      tally[k] = (tally[k] ?? 0) + 1;
    }
  } });
}
console.log('reds per match', (reds / n).toFixed(3));
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(4), k);
console.log('fouls per match by kind');
for (const [k, v] of Object.entries(fouls).sort((a, b) => b[1] - a[1])) console.log((v / n).toFixed(2).padStart(7), k);
console.log('lunges per match by kind');
for (const [k, v] of Object.entries(lungeTally).sort((a, b) => b[1] - a[1])) console.log((v / n).toFixed(2).padStart(7), k);
