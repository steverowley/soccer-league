// ── features/match/logic/calibration/counterpressMetric.ts ──────────────────
// The counter-press measurement shared by spatial/counterpress.test.ts and
// scripts/counterpress-batch.ts, so the test and the batch that sets its
// threshold measure exactly the same thing (docs/phases-of-play.md section 4).
//
// One PAIR is two full matches between the same two 4-4-2 sides rated 70,
// identical except for the plan on losing the ball: one counter-presses
// (Balanced preset, onLoss 'counterpress', 4 men for 5 s), the other recovers
// into its block.  The pair plays once each way round (seeds s and s + 1).
// For every open-play loss with play still live 1.5 s later it counts the
// loser's outfielders within 10 m of the ball at 1.5 s and whether the loser
// won the ball back in open play within 6 s.

import { simulateSpatialMatch, type SpatialTeamInput, type SpatialPlayerInput } from '../spatial/simulateSpatialMatch';
import { STYLE_PRESETS, type GameModel } from '../spatial/gameModel';
import type { PositionFrame, Role, SimPlayerStats } from '../spatial/types';

const stats = (b: number): SimPlayerStats => ({
  shooting: b, passing: b, dribbling: b, speed: b, stamina: b, tackling: b, positioning: b, goalkeeping: b, vision: b,
});
const XI: Role[] = ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW'];
function team(prefix: string, gameModel: GameModel): SpatialTeamInput {
  const players: SpatialPlayerInput[] = XI.map((role, i) => ({ id: `${prefix}-${i}`, name: `${prefix} ${i}`, role, stats: stats(70) }));
  return { formation: '4-4-2', players, gameModel };
}

const bal = STYLE_PRESETS['Balanced']!;
const PRESS: GameModel = { ...bal, onLoss: 'counterpress', counterpressPlayers: 4, counterpressSec: 5 };
const RECOVER: GameModel = { ...bal, onLoss: 'recover' };

/** Losses counted, men within 10 m summed over them, losses regained within 6 s. */
export interface CounterpressTally { losses: number; near: number; regained: number }

export interface CounterpressPair { P: CounterpressTally; R: CounterpressTally }

function one(homeIs: 'P' | 'R', seed: number, out: CounterpressPair): void {
  const home = homeIs === 'P' ? team('P', PRESS) : team('R', RECOVER);
  const away = homeIs === 'P' ? team('R', RECOVER) : team('P', PRESS);
  const r = simulateSpatialMatch(home, away, { seed, frameEverySec: 0.5, stoppage: false });
  const frames = r.frames as PositionFrame[];
  for (const side of ['home', 'away'] as const) {
    const label = (side === 'home' ? home : away).players[0]!.id[0] as 'P' | 'R';
    const tl = r.phases![side];
    for (const c of tl) {
      if (c.phase !== 'defensive_transition') continue;
      if (tl.some((x) => x.tSec > c.tSec && x.tSec <= c.tSec + 1.5 && x.phase === 'set_piece')) continue;
      const f = frames.find((x) => x.tSec >= c.tSec + 1.5 - 1e-6);
      if (!f) continue;
      const t = out[label];
      t.losses++;
      t.near += f.players.filter((p) => p.id.startsWith(label) && p.id !== `${label}-0` && p.x >= 0
        && Math.hypot(p.x - f.ball.x, p.y - f.ball.y) <= 10).length;
      if (tl.some((x) => x.tSec > c.tSec && x.tSec <= c.tSec + 6 && x.phase === 'attacking_transition')) t.regained++;
    }
  }
}

/** One pair: the pressing side at home on `seed`, away on `seed + 1`. */
export function counterpressPair(seed: number): CounterpressPair {
  const out: CounterpressPair = { P: { losses: 0, near: 0, regained: 0 }, R: { losses: 0, near: 0, regained: 0 } };
  one('P', seed, out);
  one('R', seed + 1, out);
  return out;
}
