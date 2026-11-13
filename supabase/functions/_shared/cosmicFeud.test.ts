// ── supabase/functions/_shared/cosmicFeud.test.ts ────────────────────────────
// The feud rules (issue #760): the cycle, grudges, motives, reversals and
// settling a match where several voices acted.

import { describe, expect, it } from 'vitest';
import {
  BEATS,
  COSMIC_ACTORS,
  EMPTY_FEUD,
  GRUDGE_STEP,
  arbiterMoves,
  arbiterStrikes,
  canReverse,
  clampStat,
  clashWinner,
  decayGrudges,
  grudgeMove,
  grudgeOf,
  lastHelpedTeam,
  moveToReverse,
  parseFeud,
  recordClash,
  settleMatch,
  strongestGrudge,
  tricksterMove,
  tricksterReds,
  type LoggedMove,
  type TablePlace,
} from './cosmicFeud';

describe('the cycle', () => {
  it('is rock, paper, scissors: each voice beats exactly one other and loses to the third', () => {
    expect(clashWinner('architect', 'trickster')).toBe('architect');
    expect(clashWinner('trickster', 'arbiter')).toBe('trickster');
    expect(clashWinner('arbiter', 'architect')).toBe('arbiter');
    for (const a of COSMIC_ACTORS) {
      const beaten = COSMIC_ACTORS.filter((b) => b !== a && clashWinner(a, b) === a);
      expect(beaten, a).toEqual([BEATS[a]]);
    }
  });

  it('is symmetric in argument order and refuses a voice against itself', () => {
    expect(clashWinner('trickster', 'architect')).toBe('architect');
    expect(() => clashWinner('arbiter', 'arbiter')).toThrow();
  });

  it('lets a voice reverse only the voice it beats', () => {
    expect(canReverse('arbiter', 'architect')).toBe(true);
    expect(canReverse('architect', 'arbiter')).toBe(false);
    expect(canReverse('trickster', 'trickster')).toBe(false);
  });
});

describe('grudges', () => {
  const clash = { winner: 'arbiter' as const, loser: 'architect' as const, at: '2026-11-13T12:00:00Z', where: 'match m1' };

  it('raise the loser’s grudge against the winner, and only that one', () => {
    const s = recordClash(EMPTY_FEUD, clash);
    expect(grudgeOf(s, 'architect', 'arbiter')).toBeCloseTo(GRUDGE_STEP);
    expect(grudgeOf(s, 'arbiter', 'architect')).toBe(0);
    expect(s.clashes[0]).toEqual(clash);
    expect(EMPTY_FEUD.clashes).toHaveLength(0); // input untouched
  });

  it('cap at 1 however often the same loss repeats', () => {
    let s = EMPTY_FEUD;
    for (let i = 0; i < 10; i++) s = recordClash(s, clash);
    expect(grudgeOf(s, 'architect', 'arbiter')).toBe(1);
  });

  it('halve each week and vanish when tiny', () => {
    const s0 = { ...recordClash(EMPTY_FEUD, clash), decayedAt: '2026-11-01T00:00:00Z' };
    const s1 = decayGrudges(s0, new Date('2026-11-08T00:00:00Z'));
    expect(grudgeOf(s1, 'architect', 'arbiter')).toBeCloseTo(GRUDGE_STEP / 2);
    const s2 = decayGrudges(s1, new Date('2027-03-01T00:00:00Z'));
    expect(s2.grudge).toEqual({});
  });

  it('name the voice most resented, above a threshold', () => {
    const s = recordClash(recordClash(EMPTY_FEUD, clash), clash);
    expect(strongestGrudge(s, 'architect')).toEqual({ against: 'arbiter', grudge: 2 * GRUDGE_STEP });
    expect(strongestGrudge(s, 'arbiter')).toBeNull();
  });

  it('parse stored state defensively', () => {
    expect(parseFeud(null)).toEqual(EMPTY_FEUD);
    expect(parseFeud({ grudge: { 'arbiter>architect': 0.5, 'arbiter>arbiter': 1, 'x>y': 1, 'trickster>arbiter': 7 }, clashes: [{ bad: 1 }] }))
      .toEqual({ grudge: { 'arbiter>architect': 0.5, 'trickster>arbiter': 1 }, clashes: [], decayedAt: null });
  });
});

describe('motives between matches', () => {
  const table: TablePlace[] = Array.from({ length: 9 }, (_, i) => ({ teamId: `t${i + 1}`, leagueId: 'L', position: i + 1, size: 9 }));

  it('the Arbiter lifts the bottom club and dulls the top one, gently', () => {
    expect(arbiterMoves(table)).toEqual([
      { actor: 'arbiter', teamId: 't9', direction: 1, size: 2, motive: 'level_up_bottom' },
      { actor: 'arbiter', teamId: 't1', direction: -1, size: 2, motive: 'level_down_top' },
    ]);
    expect(arbiterMoves(table.slice(0, 1))).toEqual([]);
  });

  it('the Trickster swings a mid-table club hard, either way', () => {
    const low = tricksterMove(table, () => 0)!;
    const high = tricksterMove(table, () => 0.99)!;
    for (const m of [low, high]) expect(['t4', 't5', 't6']).toContain(m.teamId);
    expect(low.direction).toBe(-1);
    expect(high.direction).toBe(1);
    expect(low.size).toBe(5);
    expect(tricksterMove([], () => 0)).toBeNull();
  });

  it('a grudge is paid back at the club the rival last helped, harder the angrier', () => {
    expect(grudgeMove('architect', 0.5, 't3')).toEqual({ actor: 'architect', teamId: 't3', direction: -1, size: 5, motive: 'grudge' });
    expect(grudgeMove('architect', 1, 't3')!.size).toBe(6);
    expect(grudgeMove('architect', 0.5, null)).toBeNull();
  });
});

describe('reversals', () => {
  const move = (o: Partial<LoggedMove>): LoggedMove => ({
    id: 'm', actor: 'architect', playerId: 'p', teamId: 't1', field: 'attacking',
    oldValue: 50, newValue: 53, at: '2026-11-12T00:00:00Z', reversedBy: null, ...o,
  });
  const now = new Date('2026-11-13T00:00:00Z');

  it('picks the newest unreversed move by the voice it beats, inside the window', () => {
    const log = [
      move({ id: 'old', at: '2026-11-10T00:00:00Z' }),
      move({ id: 'new', at: '2026-11-12T00:00:00Z' }),
      move({ id: 'done', at: '2026-11-12T06:00:00Z', reversedBy: 'arbiter' }),
      move({ id: 'trick', actor: 'trickster', at: '2026-11-12T09:00:00Z' }),
      move({ id: 'stale', at: '2026-10-01T00:00:00Z' }),
    ];
    expect(moveToReverse(log, 'arbiter', now)!.id).toBe('new');
    expect(moveToReverse(log, 'architect', now)!.id).toBe('trick');
    expect(moveToReverse(log, 'trickster', now)).toBeNull();
  });

  it('knows which club a voice last helped (a raise, not a cut)', () => {
    expect(lastHelpedTeam([move({ teamId: 'tA' })], 'architect')).toBe('tA');
    expect(lastHelpedTeam([move({ teamId: 'tA', newValue: 47 })], 'architect')).toBeNull();
  });

  it('keeps attributes inside the engine’s range', () => {
    expect(clampStat(104)).toBe(99);
    expect(clampStat(-3)).toBe(1);
  });
});

describe('in a match', () => {
  it('the Arbiter strikes off a goal that puts a side three clear', () => {
    expect(arbiterStrikes([3, 0])).toBe('home');
    expect(arbiterStrikes([1, 4])).toBe('away');
    expect(arbiterStrikes([2, 0])).toBeNull();
  });

  it('the Trickster reds the favourite while it is level or ahead', () => {
    expect(tricksterReds('home', 'home', [1, 0])).toBe(true);
    expect(tricksterReds('home', 'home', [0, 0])).toBe(true);
    expect(tricksterReds('home', 'home', [0, 1])).toBe(false);
    expect(tricksterReds('home', 'away', [1, 0])).toBe(false);
    expect(tricksterReds(null, 'home', [1, 0])).toBe(false);
  });

  it('settles by the cycle: the beaten voice’s effect is undone', () => {
    const r = settleMatch([{ actor: 'architect', id: 'a' }, { actor: 'arbiter', id: 'b' }], 't', 'm1');
    expect(r.stand.map((e) => e.id)).toEqual(['b']);
    expect(r.undone.map((e) => e.id)).toEqual(['a']);
    expect(r.clashes).toEqual([{ winner: 'arbiter', loser: 'architect', at: 't', where: 'match m1' }]);
  });

  it('a lone voice stands; all three cancel each other out', () => {
    expect(settleMatch([{ actor: 'trickster', id: 'x' }], 't', 'm').stand).toHaveLength(1);
    const all = settleMatch([{ actor: 'architect', id: 'a' }, { actor: 'arbiter', id: 'b' }, { actor: 'trickster', id: 'c' }], 't', 'm');
    expect(all.stand).toEqual([]);
    expect(all.clashes).toHaveLength(3);
  });
});
