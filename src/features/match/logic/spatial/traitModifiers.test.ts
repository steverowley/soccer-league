// ── features/match/logic/spatial/traitModifiers.test.ts ──────────────────────
// Tests for the entities → engine bridge: the pure personality → sim-stat
// modifier, and proof that wiring it ahead of the engine (a) preserves
// determinism, (b) is a strict no-op when no personality is present, and
// (c) actually changes the match for a known roster.

import { describe, it, expect } from 'vitest';
import { applyTraitModifiers, applyTeamTraits, type PlayerTraits } from './traitModifiers';
import {
  simulateSpatialMatch,
  type SpatialTeamInput,
  type SpatialPlayerInput,
} from './simulateSpatialMatch';
import type { SimPlayerStats, Role } from './types';

// ── Fixture builders ──────────────────────────────────────────────────────────

/** A uniform stat line so a delta on one stat is easy to read off. */
function stats(base: number): SimPlayerStats {
  return {
    shooting: base, passing: base, dribbling: base, speed: base, stamina: base,
    tackling: base, positioning: base, goalkeeping: base, vision: base,
  };
}

/** A standard 4-4-2 XI at a uniform rating; ids prefixed so sides never clash. */
function makeXI(prefix: string, base: number): SpatialPlayerInput[] {
  const roles: Role[] = ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW'];
  return roles.map((role, i) => ({ id: `${prefix}-${i}`, name: `${prefix} ${i}`, role, stats: stats(base) }));
}

function team(prefix: string, base: number): SpatialTeamInput {
  return { formation: '4-4-2', players: makeXI(prefix, base) };
}

/** Map every player on a team to the same personality (the all-X roster trick). */
function uniformPersonality(t: SpatialTeamInput, value: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of t.players) m.set(p.id, value);
  return m;
}

// Short match keeps the integration runs fast while still long enough that a
// stat change ripples into divergent geometry.
const SHORT = { matchSeconds: 1800, frameEverySec: 2 };

// ── applyTraitModifiers — per-archetype directions ────────────────────────────

describe('applyTraitModifiers — archetype deltas', () => {
  // Each row asserts the documented stats moved by the documented amount and
  // that no other stat drifted.  Base 70 keeps every result well inside [1,99].
  const CASES: Array<{ personality: string; expect: Partial<SimPlayerStats> }> = [
    { personality: 'selfish',     expect: { shooting: 73, passing: 67, vision: 68 } },
    { personality: 'team_player', expect: { passing: 73, vision: 73, shooting: 68 } },
    { personality: 'aggressive',  expect: { tackling: 73, positioning: 68 } },
    { personality: 'cautious',    expect: { positioning: 73, shooting: 68 } },
    { personality: 'creative',    expect: { dribbling: 73, vision: 73, stamina: 68 } },
    { personality: 'lazy',        expect: { stamina: 67, speed: 68 } },
    { personality: 'workhorse',   expect: { stamina: 73, positioning: 72 } },
  ];

  for (const { personality, expect: changed } of CASES) {
    it(`${personality} moves only the documented stats`, () => {
      const base = stats(70);
      const out = applyTraitModifiers(base, { personality });
      const expected: SimPlayerStats = { ...base, ...changed };
      expect(out).toStrictEqual(expected);
    });
  }

  it('balanced is a no-op', () => {
    const base = stats(70);
    expect(applyTraitModifiers(base, { personality: 'balanced' })).toStrictEqual(base);
  });
});

// ── applyTraitModifiers — no-op + clamping + determinism ──────────────────────

describe('applyTraitModifiers — invariants', () => {
  it('returns a value-equal stat line for absent / null / unknown personality', () => {
    const base = stats(64);
    const cases: PlayerTraits[] = [{}, { personality: null }, { personality: 'not_a_real_archetype' }];
    for (const traits of cases) {
      expect(applyTraitModifiers(base, traits)).toStrictEqual(base);
    }
  });

  it('clamps results into [1, 99]', () => {
    // selfish adds +3 shooting: 98 → 99 (not 101).
    const high = applyTraitModifiers({ ...stats(70), shooting: 98 }, { personality: 'selfish' });
    expect(high.shooting).toBe(99);
    // lazy subtracts 3 stamina: 2 → 1 (not -1).
    const low = applyTraitModifiers({ ...stats(70), stamina: 2 }, { personality: 'lazy' });
    expect(low.stamina).toBe(1);
  });

  it('does not mutate its input', () => {
    const base = stats(70);
    const snapshot = { ...base };
    applyTraitModifiers(base, { personality: 'selfish' });
    expect(base).toStrictEqual(snapshot);
  });

  it('is deterministic — same inputs, same output', () => {
    const base = stats(55);
    const a = applyTraitModifiers(base, { personality: 'creative' });
    const b = applyTraitModifiers(base, { personality: 'creative' });
    expect(a).toStrictEqual(b);
  });
});

// ── applyTeamTraits — wrapper behaviour ───────────────────────────────────────

describe('applyTeamTraits', () => {
  it('nudges mapped players and leaves unmapped / null players untouched', () => {
    // Explicit player refs so we can assert per-player without index access.
    const gk: SpatialPlayerInput = { id: 'gk', name: 'GK', role: 'GK', stats: stats(70) };
    const df1: SpatialPlayerInput = { id: 'df1', name: 'DF1', role: 'DF', stats: stats(70) };
    const df2: SpatialPlayerInput = { id: 'df2', name: 'DF2', role: 'DF', stats: stats(70) };
    const t: SpatialTeamInput = { formation: '4-4-2', players: [gk, df1, df2] };
    const map = new Map<string, string | null>([
      [gk.id, 'selfish'], // only the GK's stats should change
      [df1.id, null],     // explicit null → untouched
    ]);
    const out = applyTeamTraits(t, map);
    const byId = new Map(out.players.map((p) => [p.id, p]));

    expect(byId.get(gk.id)?.stats).toStrictEqual(applyTraitModifiers(gk.stats, { personality: 'selfish' }));
    expect(byId.get(df1.id)?.stats).toStrictEqual(df1.stats); // null → no-op
    expect(byId.get(df2.id)?.stats).toStrictEqual(df2.stats); // absent from map → no-op
    // formation and identity are carried through unchanged.
    expect(out.formation).toBe(t.formation);
    expect(byId.get(gk.id)?.id).toBe(gk.id);
  });

  it('an empty map is a whole-team no-op (value-equal stats)', () => {
    const t = team('H', 70);
    const out = applyTeamTraits(t, new Map());
    expect(out.players.map((p) => p.stats)).toStrictEqual(t.players.map((p) => p.stats));
  });
});

// ── Engine integration — determinism, no-op equivalence, real effect ──────────

describe('traits → engine integration', () => {
  it('same seed + same personalities → identical match', () => {
    const home = applyTeamTraits(team('H', 70), uniformPersonality(team('H', 70), 'aggressive'));
    const away = team('A', 70);
    const a = simulateSpatialMatch(home, away, { ...SHORT, seed: 99 });
    const b = simulateSpatialMatch(home, away, { ...SHORT, seed: 99 });
    expect(a.finalScore).toEqual(b.finalScore);
    expect(a.events).toEqual(b.events);
  });

  it('an empty trait map reproduces the untouched-roster match exactly', () => {
    const raw = team('H', 70);
    const away = team('A', 70);
    const wrapped = applyTeamTraits(raw, new Map()); // value-equal stats
    const base = simulateSpatialMatch(raw, away, { ...SHORT, seed: 7 });
    const through = simulateSpatialMatch(wrapped, away, { ...SHORT, seed: 7 });
    expect(through.finalScore).toEqual(base.finalScore);
    expect(through.events).toEqual(base.events);
  });

  it('personality actually changes the match (selfish XI diverges from balanced XI)', () => {
    const away = team('A', 70);
    let diverged = false;
    for (const seed of [1, 2, 3]) {
      const selfish = applyTeamTraits(team('H', 70), uniformPersonality(team('H', 70), 'selfish'));
      const balanced = applyTeamTraits(team('H', 70), uniformPersonality(team('H', 70), 'balanced'));
      const a = simulateSpatialMatch(selfish, away, { ...SHORT, seed });
      const b = simulateSpatialMatch(balanced, away, { ...SHORT, seed });
      if (JSON.stringify(a.events) !== JSON.stringify(b.events)) { diverged = true; break; }
    }
    expect(diverged).toBe(true);
  });
});
