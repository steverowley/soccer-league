// scripts/block-who.ts
// Who blocks shots: team-mate or opponent, how far from the shooter, and
// whether he had thrown himself into the lane (blocking) or was just there.
import { simulateSpatialMatch } from '../src/features/match/logic/spatial/simulateSpatialMatch';
import { team } from './lib/engineMetrics';
const n = Number(process.env['MATCHES'] ?? 8);
const t: Record<string, number> = {};
let shooter: { side: string; x: number; y: number; t: number } | null = null;
for (let m = 0; m < n; m++) {
  simulateSpatialMatch(team('H', 70), team('A', 70), { seed: 9100 + m, trace: (r) => {
    if (r.kind === 'shot') shooter = { side: String(r.side), x: r.ball.x, y: r.ball.y, t: r.tSec };
    if (r.kind === 'block' && shooter && r.tSec - shooter.t < 2) {
      const d = Math.hypot(r.ball.x - shooter.x, r.ball.y - shooter.y);
      const k = `${r.side === shooter.side ? 'mate' : 'opp '} d${d < 3 ? '<3' : d < 8 ? '3-8' : '8+'} z${r.ball.z < 0.9 ? 'low' : 'high'}`;
      t[k] = (t[k] ?? 0) + 1;
      shooter = null;
    }
  } });
}
for (const [k, v] of Object.entries(t).sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(4), k);
