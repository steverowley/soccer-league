// scripts/shooter-roles.ts
// Who shoots: shots per match by the shooter's slot in the standard 4-4-2
// fixture (FB, CB, WM, CM, ST) and distance band, plus goals.
//   MATCHES=24 npx tsx scripts/shooter-roles.ts
import { simulateSpatialMatch } from '../src/features/match/logic/spatial/simulateSpatialMatch';
import { team } from './lib/engineMetrics';

const SLOT = ['GK', 'FB', 'CB', 'CB', 'FB', 'WM', 'CM', 'CM', 'WM', 'ST', 'ST'];
const n = Number(process.env['MATCHES'] ?? 24);
const t: Record<string, number[]> = {};
for (let m = 0; m < n; m++) {
  const base = 60 + (m % 21);
  simulateSpatialMatch(team('H', base), team('A', base), { seed: 1000 + m, trace: (r) => {
    if (r.kind !== 'shot' || !r.playerId) return;
    const idx = Number(r.playerId.split('-').pop());
    const role = r.playerId.includes('sub') ? 'SUB' : SLOT[idx] ?? '?';
    const d = Number(r.data['dist']);
    const row = (t[role] ??= [0, 0, 0]);
    row[d < 11 ? 0 : d < 18 ? 1 : 2]!++;
  } });
}
for (const [k, v] of Object.entries(t).sort()) console.log(`${k.padEnd(4)} <11 ${(v[0]! / n).toFixed(2)}  11-18 ${(v[1]! / n).toFixed(2)}  18+ ${(v[2]! / n).toFixed(2)}`);
