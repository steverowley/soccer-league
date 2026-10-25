// ── features/match/logic/spatial/phaseOfPlay.test.ts ─────────────────────────
// Phases of play and the manager's game model (docs/phases-of-play.md):
// parsing and presets, the phase machine's transitions, and the shapes the
// plans produce (in/out of possession length and width, the rest-defence
// count, distinct managers' blocks).  The shape tests drive the real engine.

import { describe, it, expect, beforeAll } from 'vitest';
import { simulateSpatialMatch, type SpatialTeamInput, type SpatialPlayerInput } from './simulateSpatialMatch';
import { parseGameModel, presetFor, STYLE_PRESETS, NEUTRAL_GAME_MODEL, restSplit, buildUpLines, type GameModel } from './gameModel';
import { toSpatialTeamInput } from './spatialEventAdapter';
import type { Role, SimPlayerStats, SpatialMatchResult, TeamSide } from './types';
import type { TeamPhase } from './phase';

const stats = (b: number): SimPlayerStats => ({
  shooting: b, passing: b, dribbling: b, speed: b, stamina: b, tackling: b, positioning: b, goalkeeping: b, vision: b,
});
const XI: Role[] = ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW'];
function team(prefix: string, style: string, gameModel?: GameModel, formation = '4-4-2'): SpatialTeamInput {
  const players: SpatialPlayerInput[] = XI.map((role, i) => ({ id: `${prefix}-${i}`, name: `${prefix} ${i}`, role, stats: stats(70) }));
  return { formation, players, playStyle: style, ...(gameModel ? { gameModel } : {}) };
}

/** The phase a side is in at time t, from the result's timeline. */
function phaseAt(r: SpatialMatchResult, side: TeamSide, t: number): TeamPhase {
  let ph: TeamPhase = 'set_piece';
  for (const c of r.phases![side]) { if (c.tSec <= t) ph = c.phase; else break; }
  return ph;
}

interface Shape { len: number; wid: number; cent: number; behind: number; n: number }
/** Mean outfield shape of a side over frames where it is in one of `phases`. */
function shapeIn(r: SpatialMatchResult, side: TeamSide, phases: TeamPhase[]): Shape {
  const own = side === 'home' ? 0 : 105;
  const acc = { len: 0, wid: 0, cent: 0, behind: 0, n: 0 };
  for (const f of r.frames) {
    if (!phases.includes(phaseAt(r, side, f.tSec))) continue;
    const mine = f.players.filter((p) => p.id.startsWith(side === 'home' ? 'H-' : 'A-') && !p.id.endsWith('-0') && p.x >= 0);
    if (mine.length < 8) continue;
    const ds = mine.map((p) => Math.abs(p.x - own));
    const ys = mine.map((p) => p.y);
    const ballD = Math.abs(f.ball.x - own);
    acc.len += Math.max(...ds) - Math.min(...ds);
    acc.wid += Math.max(...ys) - Math.min(...ys);
    acc.cent += ds.reduce((a, b) => a + b, 0) / ds.length;
    // Held back: more than 12 m goal-side of the ball (the rest defence, not
    // the men arriving at the edge of the box).
    acc.behind += ds.filter((d) => d < ballD - 12).length;
    acc.n++;
  }
  const k = Math.max(1, acc.n);
  return { len: acc.len / k, wid: acc.wid / k, cent: acc.cent / k, behind: acc.behind / k, n: acc.n };
}

const SETTLED_IN: TeamPhase[] = ['build_up', 'progression', 'final_third'];
const BLOCKS: TeamPhase[] = ['high_block', 'mid_block', 'low_block'];

describe('game model: presets and parsing', () => {
  it('has a preset for each of the eight league styles, Balanced as the neutral one', () => {
    for (const s of ['Possession', 'High Pressing', 'Aggressive', 'Direct', 'Counterattacking', 'Offensive', 'Balanced', 'Defensive']) {
      expect(STYLE_PRESETS[s], s).toBeDefined();
      const m = STYLE_PRESETS[s]!;
      const [b, mid, f] = buildUpLines(m.buildUpShape);
      expect(b + mid + f).toBe(10);
      const [rb, rs] = restSplit(m, m.restDefence);
      expect(rb + rs).toBe(m.restDefence);
    }
    expect(presetFor('Nonsense')).toBe(NEUTRAL_GAME_MODEL);
    expect(presetFor(null)).toBe(STYLE_PRESETS['Balanced']);
  });

  it('applies valid stored choices over the style preset and ignores the rest', () => {
    const m = parseGameModel('Defensive', {
      restDefence: 4, blockHeight: 'high', pressTriggers: ['always', 'always'],
      settledLineHeight: 999, width: 'enormous', onLoss: 42, mystery: true,
    });
    const base = STYLE_PRESETS['Defensive']!;
    expect(m.restDefence).toBe(4);
    expect(m.blockHeight).toBe('high');
    expect(m.pressTriggers).toEqual(['always']);
    expect(m.settledLineHeight).toBe(base.settledLineHeight);
    expect(m.width).toBe(base.width);
    expect(m.onLoss).toBe(base.onLoss);
    expect((m as unknown as Record<string, unknown>)['mystery']).toBeUndefined();
    expect(parseGameModel('Possession', 'not an object')).toBe(STYLE_PRESETS['Possession']);
    expect(parseGameModel('Possession', { pressTriggers: ['sometimes'] }).pressTriggers).toEqual(STYLE_PRESETS['Possession']!.pressTriggers);
  });

  it('toSpatialTeamInput builds the model from managers.style and meta.game_model', () => {
    const plain = toSpatialTeamInput({ managers: [{ style: 'Direct' }], players: [] });
    expect(plain.gameModel).toEqual(STYLE_PRESETS['Direct']);
    const own = toSpatialTeamInput({ managers: [{ style: 'Direct', game_model: { blockHeight: 'low' } }], players: [] });
    expect(own.gameModel?.blockHeight).toBe('low');
    expect(own.gameModel?.tempo).toBe('direct');
    expect(toSpatialTeamInput({ players: [] }).gameModel).toEqual(NEUTRAL_GAME_MODEL);
  });
});

describe('phase machine', () => {
  let r: SpatialMatchResult;
  beforeAll(() => { r = simulateSpatialMatch(team('H', 'Balanced'), team('A', 'Balanced'), { seed: 4242, matchSeconds: 900, stoppage: false }); }, 180_000);

  it('starts at the kickoff restart and records every change once', () => {
    for (const side of ['home', 'away'] as const) {
      const tl = r.phases![side];
      expect(tl[0]).toEqual({ tSec: 0, phase: 'set_piece' });
      expect(tl.length).toBeGreaterThan(20);
      for (let i = 1; i < tl.length; i++) {
        expect(tl[i]!.phase).not.toBe(tl[i - 1]!.phase);
        expect(tl[i]!.tSec).toBeGreaterThanOrEqual(tl[i - 1]!.tSec);
      }
    }
  });

  it('a regain is an attacking transition for one side and a defensive transition for the other, at once', () => {
    let n = 0;
    for (const c of r.phases!.home) {
      if (c.phase === 'attacking_transition') { expect(phaseAt(r, 'away', c.tSec)).toBe('defensive_transition'); n++; }
      if (c.phase === 'defensive_transition') { expect(phaseAt(r, 'away', c.tSec)).toBe('attacking_transition'); n++; }
    }
    expect(n).toBeGreaterThan(10);
  });

  it('never has both sides in possession, or both out of it, in open play', () => {
    const IN = new Set<TeamPhase>(['attacking_transition', ...SETTLED_IN]);
    for (let t = 1; t < 900; t += 3) {
      const h = phaseAt(r, 'home', t);
      const a = phaseAt(r, 'away', t);
      if (h === 'set_piece' || a === 'set_piece') continue;
      expect(IN.has(h), `t=${t} ${h}/${a}`).not.toBe(IN.has(a));
    }
  });
});

describe('shape by phase and by manager', () => {
  let std: SpatialMatchResult;
  let rest4: SpatialMatchResult;
  let rest6: SpatialMatchResult;
  let duel: SpatialMatchResult;
  beforeAll(() => {
    std = simulateSpatialMatch(team('H', 'Balanced'), team('A', 'Balanced'), { seed: 7, frameEverySec: 1 });
    const poss = (rest: number): GameModel => parseGameModel('Possession', { restDefence: rest, restShape: rest === 4 ? '2+2' : '4+2' });
    rest4 = simulateSpatialMatch(team('H', 'Possession', poss(4)), team('A', 'Defensive'), { seed: 11, frameEverySec: 1, matchSeconds: 2700, stoppage: false });
    rest6 = simulateSpatialMatch(team('H', 'Possession', poss(6)), team('A', 'Defensive'), { seed: 11, frameEverySec: 1, matchSeconds: 2700, stoppage: false });
    // Gravel Asante's and Titan Krell's seeded models (migration 0089).
    const asante = parseGameModel('Defensive', { settledLineHeight: 25, blockLength: 26, pressTriggers: [] });
    const krell = parseGameModel('Aggressive', { buildUpShape: '3-1-6', restDefence: 4, restShape: '3+1', counterpressPlayers: 4, blockLength: 36 });
    duel = simulateSpatialMatch(team('H', 'Defensive', asante, '5-4-1'), team('A', 'Aggressive', krell, '5-4-1'), { seed: 21, frameEverySec: 1 });
  }, 240_000);

  it('a team is longer and wider in possession than out of it', () => {
    for (const side of ['home', 'away'] as const) {
      const inP = shapeIn(std, side, SETTLED_IN);
      const out = shapeIn(std, side, BLOCKS);
      expect(inP.n).toBeGreaterThan(200);
      expect(out.n).toBeGreaterThan(200);
      expect(inP.len, `${side} length`).toBeGreaterThan(out.len);
      expect(inP.wid, `${side} width`).toBeGreaterThan(out.wid);
    }
  });

  it('the back line is no longer a flat line in its own half while its side attacks', () => {
    const fin = shapeIn(std, 'home', ['final_third']);
    // Behind the ball but well upfield: the rest defence, not a back four on its box.
    expect(fin.cent).toBeGreaterThan(50);
  });

  it('the rest-defence count follows the manager: six held back leaves more behind the ball than four', () => {
    const four = shapeIn(rest4, 'home', ['final_third']);
    const six = shapeIn(rest6, 'home', ['final_third']);
    expect(four.n).toBeGreaterThan(30);
    expect(six.n).toBeGreaterThan(30);
    expect(six.behind).toBeGreaterThan(four.behind + 0.5);
  });

  it('a high-block manager defends much further up than a low-block one', () => {
    const asante = shapeIn(duel, 'home', BLOCKS);
    const krell = shapeIn(duel, 'away', BLOCKS);
    expect(krell.cent - asante.cent).toBeGreaterThan(8);
  });
});
