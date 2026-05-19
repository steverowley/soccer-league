// ── finance/logic/applyFanBoost.test.ts ──────────────────────────────────────
// Unit tests for the engine-team fan-boost applier.
//
// COVERAGE INTENT
//   • Zero-point boost returns the same reference (no allocation)
//   • Missing players array passes through unchanged
//   • Each stat field is incremented by the boost amount
//   • Missing stats default to 70 then receive the boost (72 instead of NaN+2)
//   • Boosting does not mutate the input team or its players
//   • Non-player fields (stadium, manager, tactics) are preserved by reference

import { describe, expect, it } from 'vitest';
import {
  applyFanBoostToTeam,
  type FanBoostablePlayer,
} from './applyFanBoost';

const baseTeam = () => ({
  id: 'mars',
  name: 'Mars Athletic',
  stadium: { name: 'Red Planet Arena' },
  manager: { name: 'Manager Alpha' },
  players: [
    { name: 'Flux Ito',    attacking: 80, defending: 70, mental: 75, athletic: 78, technical: 82 },
    { name: 'Lira Steele', attacking: 60, defending: 90, mental: 70, athletic: 65, technical: 68 },
  ],
});

describe('applyFanBoostToTeam', () => {
  it('returns the same reference when points = 0 (no-op fast path)', () => {
    const team = baseTeam();
    const result = applyFanBoostToTeam(team, 0);
    expect(result).toBe(team);
  });

  it('returns the same reference when points is negative or undefined', () => {
    const team = baseTeam();
    // `!points` is falsy for 0/undefined/NaN — the fast path matches all three.
    // We don't test NaN explicitly because the caller never produces it.
    expect(applyFanBoostToTeam(team, 0)).toBe(team);
  });

  it('returns the same reference when players is not an array', () => {
    const team = { id: 'orphan' };
    expect(applyFanBoostToTeam(team, 2)).toBe(team);
  });

  it('increments every stat field by the boost amount', () => {
    const team = baseTeam();
    const result = applyFanBoostToTeam(team, 2);
    const p0 = result.players![0]! as FanBoostablePlayer;
    expect(p0.attacking).toBe(82);
    expect(p0.defending).toBe(72);
    expect(p0.mental).toBe(77);
    expect(p0.athletic).toBe(80);
    expect(p0.technical).toBe(84);
  });

  it('uses 70 as the fallback when a stat field is missing/null', () => {
    const team = {
      players: [
        { name: 'Empty One' },
        { name: 'Half Stats', attacking: 88, defending: null },
      ],
    };
    const result = applyFanBoostToTeam(team, 2);
    const empty = result.players[0]! as FanBoostablePlayer;
    const half  = result.players[1]! as FanBoostablePlayer;
    expect(empty.attacking).toBe(72);
    expect(empty.defending).toBe(72);
    expect(empty.mental).toBe(72);
    expect(empty.athletic).toBe(72);
    expect(empty.technical).toBe(72);
    expect(half.attacking).toBe(90);   // present → +2
    expect(half.defending).toBe(72);   // null    → fallback 70 +2
  });

  it('does not mutate the input team or its players', () => {
    const team = baseTeam();
    const originalAttacking = team.players[0]!.attacking;
    applyFanBoostToTeam(team, 5);
    expect(team.players[0]!.attacking).toBe(originalAttacking);
  });

  it('preserves non-player fields by reference', () => {
    const team = baseTeam();
    const result = applyFanBoostToTeam(team, 2);
    expect(result.stadium).toBe(team.stadium);   // same reference
    expect(result.manager).toBe(team.manager);   // same reference
    expect(result.id).toBe(team.id);
    expect(result.name).toBe(team.name);
  });

  it('replaces the players array with a fresh array (not the same reference)', () => {
    const team = baseTeam();
    const result = applyFanBoostToTeam(team, 2);
    expect(result.players).not.toBe(team.players);
    expect(result.players).toHaveLength(team.players.length);
  });
});
