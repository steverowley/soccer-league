// ── features/match/logic/spatial/counterpress.test.ts ────────────────────────
// The manager's onLoss choice must show on the pitch (docs/phases-of-play.md
// section 4): 1.5 s after an open-play loss a counter-pressing side has more
// men within 10 m of the ball than a side that recovers into its block, and
// it wins the ball back within 6 s more often.  Same sides, same ratings, one
// full match each way round, so only the plan differs.

import { describe, it, expect, beforeAll } from 'vitest';
import { simulateSpatialMatch, type SpatialTeamInput, type SpatialPlayerInput } from './simulateSpatialMatch';
import { STYLE_PRESETS, type GameModel } from './gameModel';
import type { PositionFrame, Role, SimPlayerStats } from './types';

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

interface Tally { losses: number; near: number; regained: number }
const tally: Record<'P' | 'R', Tally> = { P: { losses: 0, near: 0, regained: 0 }, R: { losses: 0, near: 0, regained: 0 } };

function measure(homeIs: 'P' | 'R', seed: number): void {
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
      const t = tally[label];
      t.losses++;
      t.near += f.players.filter((p) => p.id.startsWith(label) && p.id !== `${label}-0` && p.x >= 0
        && Math.hypot(p.x - f.ball.x, p.y - f.ball.y) <= 10).length;
      if (tl.some((x) => x.tSec > c.tSec && x.tSec <= c.tSec + 6 && x.phase === 'attacking_transition')) t.regained++;
    }
  }
}

describe('phases of play: the counter-press happens as the manager plans it', () => {
  beforeAll(() => {
    measure('P', 4100);
    measure('R', 4101);
  }, 180_000);

  it('puts more men around the ball 1.5 s after a loss than recovering does', () => {
    const p = tally.P.near / tally.P.losses;
    const r = tally.R.near / tally.R.losses;
    expect(tally.P.losses).toBeGreaterThan(100);
    // v1 (a press that only acted on a carried ball): 1.72 v 1.34.
    expect(p, `counter-press ${p.toFixed(2)} v recover ${r.toFixed(2)} within 10 m`).toBeGreaterThan(1.9);
    expect(p, `counter-press ${p.toFixed(2)} v recover ${r.toFixed(2)} within 10 m`).toBeGreaterThan(r + 0.3);
  });

  it('wins the ball back within six seconds clearly more often', () => {
    const p = tally.P.regained / tally.P.losses;
    const r = tally.R.regained / tally.R.losses;
    // v1: 0.453 v 0.356.
    expect(p, `counter-press ${p.toFixed(3)} v recover ${r.toFixed(3)} regained in 6 s`).toBeGreaterThan(r + 0.16);
  });
});
