// scripts/goal-origin.ts
// Where goals come from: the kind of the last kick before the ball crossed
// the line (shot, parry, deflection, pass...), and shots by distance band.
//   MATCHES=20 npx tsx scripts/goal-origin.ts
import { simulateSpatialMatch } from '../src/features/match/logic/spatial/simulateSpatialMatch';
import { team } from './lib/engineMetrics';
const n = Number(process.env['MATCHES'] ?? 20);
const kinds: Record<string, number> = {};
const dist: Record<string, [number, number]> = {};
let last: { d: number } | null = null;
for (let m = 0; m < n; m++) {
  simulateSpatialMatch(team('H', 70), team('A', 70), { seed: 9000 + m, trace: (r) => {
    if (r.kind === 'shot') last = { d: Number(r.data['dist']) };
    if (r.kind === 'shot' || r.kind === 'goal') {
      if (r.kind === 'goal') {
        const k = `${r.data['kick']}${r.data['kickBy'] === false ? '(def)' : ''}`;
        kinds[k] = (kinds[k] ?? 0) + 1;
      }
    }
    if (r.kind === 'shot') {
      const b = r.data['dist'] as number < 11 ? '<11' : (r.data['dist'] as number) < 18 ? '11-18' : '18+';
      (dist[b] ??= [0, 0])[0]++;
    }
    if (r.kind === 'goal' && r.data['kick'] === 'shot' && last) {
      const b = last.d < 11 ? '<11' : last.d < 18 ? '11-18' : '18+';
      (dist[b] ??= [0, 0])[1]++;
    }
  } });
}
console.log('goals by last kick:', JSON.stringify(kinds));
for (const [b, [s, g]] of Object.entries(dist)) console.log(`shots ${b}: ${(s / n).toFixed(1)}/match, direct goals ${g}, conv ${(g / s).toFixed(3)}`);
