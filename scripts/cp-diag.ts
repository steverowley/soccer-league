// scripts/cp-diag.ts
// Counter-press diagnostic: for every open-play loss by a counter-pressing
// side, the loser's outfielders' distances to the ball at the loss and 1.5 s
// later, how far the ball travelled, and the jobs the nearest men hold.
//   MATCHES=6 npx tsx scripts/cp-diag.ts
import { simulateSpatialMatch } from '../src/features/match/logic/spatial/simulateSpatialMatch';
import { STYLE_PRESETS, type GameModel } from '../src/features/match/logic/spatial/gameModel';
import type { PositionFrame } from '../src/features/match/logic/spatial/types';
import { team } from './lib/engineMetrics';

const n = Number(process.env['MATCHES'] ?? 6);
const bal = STYLE_PRESETS['Balanced']!;
const press: GameModel = { ...bal, onLoss: 'counterpress', counterpressPlayers: 4, counterpressSec: 5 };
const drop: GameModel = { ...bal, onLoss: 'recover' };
const hist0 = new Array(6).fill(0);
const hist15 = new Array(6).fill(0);
let losses = 0;
let ceil = 0;
let moved = 0;
const nearAt0: number[] = [];
const nearAt15: number[] = [];
const byMove: Record<string, [number, number]> = {};
for (let m = 0; m < n; m++) {
  const P = { ...team('P', 70), gameModel: press };
  const R = { ...team('R', 70), gameModel: drop };
  const r = simulateSpatialMatch(P, R, { seed: 2000 + m, frameEverySec: 0.1 });
  const frames = r.frames as PositionFrame[];
  const tl = (r as unknown as { phases: Record<string, Array<{ tSec: number; phase: string }>> }).phases['home']!;
  const at = (t: number): PositionFrame | undefined => frames.find((f) => f.tSec >= t - 1e-6);
  for (const c of tl) {
    if (c.phase !== 'defensive_transition') continue;
    if (tl.some((x) => x.tSec > c.tSec && x.tSec <= c.tSec + 1.5 && x.phase === 'set_piece')) continue;
    const f0 = at(c.tSec);
    const f1 = at(c.tSec + 1.5);
    if (!f0 || !f1) continue;
    const ds = (f: PositionFrame): number[] => f.players.filter((p) => p.id.startsWith('P-') && p.id !== 'P-0' && p.x >= 0)
      .map((p) => Math.hypot(p.x - f.ball.x, p.y - f.ball.y)).sort((a, b) => a - b);
    const d0 = ds(f0);
    const d1 = ds(f1);
    losses++;
    const w0 = d0.filter((d) => d <= 10).length;
    const w1 = d1.filter((d) => d <= 10).length;
    hist0[Math.min(5, w0)]++;
    hist15[Math.min(5, w1)]++;
    nearAt0.push(d0.slice(0, 4).reduce((a, b) => a + b, 0) / 4);
    nearAt15.push(d1.slice(0, 4).reduce((a, b) => a + b, 0) / 4);
    const mv = Math.hypot(f1.ball.x - f0.ball.x, f1.ball.y - f0.ball.y);
    // Ceiling: loser outfielders who could be within 10 m of the ball's 1.5 s
    // position if they sprinted straight there from the loss (7 m in 1.3 s).
    ceil += f0.players.filter((p) => p.id.startsWith('P-') && p.id !== 'P-0' && p.x >= 0 && Math.hypot(p.x - f1.ball.x, p.y - f1.ball.y) <= 17).length;
    const gkWin = f0.ball.ownerId === 'R-0' || f0.ball.ownerId === 'R-sub-0';
    const gk = (byMove[gkWin ? 'won by keeper' : 'won by outfielder'] ??= [0, 0]);
    gk[0]++; gk[1] += w1;
    const zone = Math.abs(f0.ball.x - 0) ; // P attacks toward x=105 as home
    const zk = zone > 70 ? 'lost in final third' : zone > 35 ? 'lost in middle third' : 'lost in own third';
    const zr = (byMove[zk] ??= [0, 0]); zr[0]++; zr[1] += w1;
    if (mv > 10) moved++;
    const k = mv < 5 ? 'ball moved <5m' : mv < 15 ? 'ball moved 5-15m' : 'ball moved >15m';
    const row = (byMove[k] ??= [0, 0]);
    row[0]++; row[1] += w1;
  }
}
const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
console.log('losses', losses, 'per match', (losses / n).toFixed(1));
console.log('within 10 m at loss  (0..5+)', hist0.map((x) => (x / losses).toFixed(2)).join(' '), 'mean', (hist0.reduce((s, x, i) => s + x * i, 0) / losses).toFixed(2));
console.log('within 10 m at 1.5 s (0..5+)', hist15.map((x) => (x / losses).toFixed(2)).join(' '), 'mean', (hist15.reduce((s, x, i) => s + x * i, 0) / losses).toFixed(2));
console.log('mean dist of nearest four: at loss', mean(nearAt0).toFixed(1), 'at 1.5 s', mean(nearAt15).toFixed(1));
console.log('ceiling (could be within 10 m at 1.5 s)', (ceil / losses).toFixed(2));
console.log('ball moved >10 m in 1.5 s share', (moved / losses).toFixed(2));
for (const [k, [c, w]] of Object.entries(byMove).sort()) console.log(k.padEnd(18), c, 'within10', (w / c).toFixed(2));
