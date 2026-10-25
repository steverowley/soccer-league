// scripts/shot-phase.ts
// Which phase shots and goals come from: the shooting side's phase and the
// defending side's phase at the moment of the strike, plus shot distance.
//   MATCHES=24 npx tsx scripts/shot-phase.ts
import { simulateSpatialMatch } from '../src/features/match/logic/spatial/simulateSpatialMatch';
import type { TraceRecord, TeamSide } from '../src/features/match/logic/spatial/types';
import { team } from './lib/engineMetrics';

const n = Number(process.env['MATCHES'] ?? 24);
const tally: Record<string, { shots: number; goals: number; near: number }> = {};
let total = 0;
for (let m = 0; m < n; m++) {
  const shots: Array<{ t: number; side: TeamSide; d: number }> = [];
  const goals: Array<{ t: number; side: TeamSide }> = [];
  const trace = (r: TraceRecord): void => {
    if (r.kind === 'shot' && r.side) shots.push({ t: r.tSec, side: r.side, d: Number(r.data['dist']) });
  };
  const res = simulateSpatialMatch(team('H', 60 + (m % 21)), team('A', 60 + (m % 21)), { seed: 1000 + m, trace });
  for (const e of res.events) if (e.type === 'goal' && e.side) goals.push({ t: e.tSec, side: e.side });
  const at = (side: TeamSide, t: number): string => {
    const tl = res.phases![side];
    let ph = tl[0]!.phase as string;
    for (const c of tl) { if (c.tSec <= t) ph = c.phase; else break; }
    return ph;
  };
  for (const s of shots) {
    const opp: TeamSide = s.side === 'home' ? 'away' : 'home';
    const k = `${at(s.side, s.t)} v ${at(opp, s.t)}`;
    const row = (tally[k] ??= { shots: 0, goals: 0, near: 0 });
    row.shots++;
    if (s.d < 11) row.near++;
    if (goals.some((g) => g.side === s.side && g.t >= s.t && g.t - s.t < 3)) row.goals++;
    total++;
  }
}
console.log(`matches ${n}, shots ${total} (${(total / n).toFixed(1)} per match)`);
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1].shots - a[1].shots)) {
  console.log(`${k.padEnd(44)} shots ${(v.shots / n).toFixed(2).padStart(5)}  <11m ${(v.near / n).toFixed(2).padStart(5)}  goals ${(v.goals / n).toFixed(2).padStart(5)}`);
}
