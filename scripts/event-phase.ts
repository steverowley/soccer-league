// scripts/event-phase.ts
// Where events happen by the acting side's phase of play (engine timeline):
// interceptions, tackles, fouls, per match.   MATCHES=24 TYPES=interception,tackle,foul npx tsx scripts/event-phase.ts
import { simulateSpatialMatch } from '../src/features/match/logic/spatial/simulateSpatialMatch';
import { team } from './lib/engineMetrics';
import { STYLE_PRESETS, type GameModel } from '../src/features/match/logic/spatial/gameModel';

// MODE=cp: a counter-pressing side (P) v a recovering one (R), venue alternating;
// rows are then split by the acting side's label.
const cp = process.env['MODE'] === 'cp';
const bal = STYLE_PRESETS['Balanced']!;
const press: GameModel = { ...bal, onLoss: 'counterpress', counterpressPlayers: 4, counterpressSec: 5 };
const drop: GameModel = { ...bal, onLoss: 'recover' };

const n = Number(process.env['MATCHES'] ?? 24);
const types = (process.env['TYPES'] ?? 'interception,tackle,foul').split(',');
const t: Record<string, Record<string, number>> = {};
for (let m = 0; m < n; m++) {
  const base = 60 + (m % 21);
  const P = { ...team('P', base), gameModel: press };
  const R = { ...team('R', base), gameModel: drop };
  const [h, a] = !cp ? [team('H', base), team('A', base)] : m % 2 === 0 ? [P, R] : [R, P];
  const r = simulateSpatialMatch(h, a, { seed: 1000 + m });
  const label = (s: string): string => (cp ? `${(s === 'home' ? h : a).players[0]!.id[0]} ` : '');
  for (const e of r.events) {
    if (!types.includes(e.type) || !e.side) continue;
    let ph = 'none';
    let since = 0;
    for (const c of r.phases?.[e.side] ?? []) if (c.tSec <= e.tSec) { ph = c.phase; since = c.tSec; }
    const key = label(e.side) + (ph === 'defensive_transition' ? `${ph} ${e.tSec - since < 2 ? '<2s' : e.tSec - since < 4 ? '2-4s' : '4-6s'}` : ph);
    (t[e.type] ??= {})[key] = ((t[e.type] ??= {})[key] ?? 0) + 1;
  }
}
for (const [ty, row] of Object.entries(t)) {
  const tot = Object.values(row).reduce((a, b) => a + b, 0);
  console.log(`${ty} ${(tot / n).toFixed(1)}/match: ` + Object.entries(row).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / n).toFixed(1)}`).join(', '));
}
