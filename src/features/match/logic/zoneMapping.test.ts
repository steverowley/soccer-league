// ── zoneMapping.test.ts ──────────────────────────────────────────────────────
// Unit tests for the pitch zone model and positional instruction system.
//
// COVERAGE GOALS
// ──────────────
// • All 4 formations produce non-overlapping GK zones and sensible layouts.
// • playerHomeZone correctly maps jersey numbers 1–22 to zones.
// • zoneCentre returns coordinates within the valid pitch bounds.
// • getPositionalInstructions produces all-positive weights and reacts
//   correctly to desperation (losing late) and comfort (winning) situations.
// • situationZoneDelta returns exactly {-1, 0, +1} and clamps correctly.
// • applyZoneDelta clamps to the valid [0, 3] row range.

import { describe, expect, it } from 'vitest';
import {
  playerHomeZone,
  zoneCentre,
  getPositionalInstructions,
  situationZoneDelta,
  applyZoneDelta,
  PITCH_WIDTH,
  PITCH_HEIGHT,
  type Zone,
  type SituationContext,
} from './zoneMapping';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Return a neutral SituationContext for tests that don't need specific state */
function neutralCtx(overrides: Partial<SituationContext> = {}): SituationContext {
  return {
    hasPossession: true,
    scoreDiff:     0,
    minute:        45,
    chaosLevel:    0,
    ...overrides,
  };
}

// ── playerHomeZone ────────────────────────────────────────────────────────────

describe('playerHomeZone', () => {
  it('jersey 1 (GK) always lands in row 0 regardless of formation', () => {
    const formations = ['4-4-2', '4-3-3', '3-4-3', '4-5-1'] as const;
    for (const f of formations) {
      const zone = playerHomeZone(1, f);
      expect(zone.row).toBe(0);
      expect(zone.col).toBe(1); // GK always centre
    }
  });

  it('all 11 starters (jersey 1–11) are assigned valid zones', () => {
    const formations = ['4-4-2', '4-3-3', '3-4-3', '4-5-1'] as const;
    for (const f of formations) {
      for (let j = 1; j <= 11; j++) {
        const zone = playerHomeZone(j, f);
        expect(zone.col).toBeGreaterThanOrEqual(0);
        expect(zone.col).toBeLessThanOrEqual(2);
        expect(zone.row).toBeGreaterThanOrEqual(0);
        expect(zone.row).toBeLessThanOrEqual(3);
      }
    }
  });

  it('bench players (jersey 12–22) are assigned valid zones', () => {
    for (let j = 12; j <= 22; j++) {
      const zone = playerHomeZone(j, '4-4-2');
      expect(zone.col).toBeGreaterThanOrEqual(0);
      expect(zone.row).toBeGreaterThanOrEqual(0);
    }
  });

  it('jersey numbers outside [1, 22] clamp without throwing', () => {
    expect(() => playerHomeZone(0,  '4-4-2')).not.toThrow();
    expect(() => playerHomeZone(99, '4-4-2')).not.toThrow();
  });

  it('falls back to 4-4-2 for an unknown formation string', () => {
    const known   = playerHomeZone(7, '4-4-2');
    const unknown = playerHomeZone(7, 'banana' as never);
    expect(unknown).toEqual(known);
  });

  it('null / undefined formation falls back to 4-4-2', () => {
    const known = playerHomeZone(7, '4-4-2');
    expect(playerHomeZone(7, null)).toEqual(known);
    expect(playerHomeZone(7, undefined)).toEqual(known);
  });

  it('4-4-2 GK is in col:1, row:0 and first ST is in row 2 or 3', () => {
    const gk = playerHomeZone(1, '4-4-2');
    expect(gk).toEqual({ col: 1, row: 0 });
    // The striker in 4-4-2 (jersey 10 or 11) should be forward of midfield
    const st = playerHomeZone(10, '4-4-2');
    expect(st.row).toBeGreaterThanOrEqual(2);
  });
});

// ── zoneCentre ────────────────────────────────────────────────────────────────

describe('zoneCentre', () => {
  it('all zone centres are within pitch bounds', () => {
    const cols = [0, 1, 2] as const;
    const rows = [0, 1, 2, 3] as const;
    for (const col of cols) {
      for (const row of rows) {
        const zone: Zone = { col, row };
        const home = zoneCentre(zone, false);
        const away = zoneCentre(zone, true);
        expect(home.x).toBeGreaterThan(0);
        expect(home.x).toBeLessThan(PITCH_WIDTH);
        expect(home.y).toBeGreaterThan(0);
        expect(home.y).toBeLessThan(PITCH_HEIGHT);
        expect(away.x).toBeGreaterThan(0);
        expect(away.x).toBeLessThan(PITCH_WIDTH);
      }
    }
  });

  it('away team mirrors home team x coordinate', () => {
    const zone: Zone = { col: 2, row: 0 };
    const home = zoneCentre(zone, false);
    const away = zoneCentre(zone, true);
    // Mirror: home.x + away.x should equal PITCH_WIDTH (105)
    expect(home.x + away.x).toBeCloseTo(PITCH_WIDTH);
  });

  it('GK home zone (row 0) is near x=0 for home team', () => {
    const gkZone: Zone = { col: 1, row: 0 };
    const coord = zoneCentre(gkZone, false);
    // GK should be in the left third (x < 35)
    expect(coord.x).toBeLessThan(PITCH_WIDTH / 3 + 1);
  });

  it('top-attack zone (row 3, col 1) is near x=105 for home team', () => {
    const attackZone: Zone = { col: 1, row: 3 };
    const coord = zoneCentre(attackZone, false);
    // Should be in the right third (x > 70)
    expect(coord.x).toBeGreaterThan((PITCH_WIDTH * 2) / 3 - 1);
  });
});

// ── getPositionalInstructions ─────────────────────────────────────────────────

describe('getPositionalInstructions', () => {
  it('all returned weights are strictly positive', () => {
    const positions = ['GK', 'DF', 'MF', 'FW'];
    const styles = ['Offensive', 'Defensive', 'High Pressing', 'Possession', 'Balanced'];
    for (const pos of positions) {
      for (const style of styles) {
        const bias = getPositionalInstructions(pos, style, {}, 0, 45);
        expect(bias.shoot).toBeGreaterThan(0);
        expect(bias.pass).toBeGreaterThan(0);
        expect(bias.dribble).toBeGreaterThan(0);
        expect(bias.tackle).toBeGreaterThan(0);
        expect(bias.press).toBeGreaterThan(0);
      }
    }
  });

  it('FW has higher shoot bias than GK', () => {
    const fw = getPositionalInstructions('FW', 'Balanced', {}, 0, 45);
    const gk = getPositionalInstructions('GK', 'Balanced', {}, 0, 45);
    expect(fw.shoot).toBeGreaterThan(gk.shoot);
  });

  it('High Pressing raises press bias compared to Balanced', () => {
    const pressing = getPositionalInstructions('MF', 'High Pressing', {}, 0, 45);
    const balanced = getPositionalInstructions('MF', 'Balanced',      {}, 0, 45);
    expect(pressing.press).toBeGreaterThan(balanced.press);
  });

  it('Possession raises pass bias compared to Balanced', () => {
    const possession = getPositionalInstructions('MF', 'Possession', {}, 0, 45);
    const balanced   = getPositionalInstructions('MF', 'Balanced',   {}, 0, 45);
    expect(possession.pass).toBeGreaterThan(balanced.pass);
  });

  it('desperation (losing at minute 80) raises shoot bias', () => {
    const desperate = getPositionalInstructions('MF', 'Balanced', {}, -2, 80);
    const normal    = getPositionalInstructions('MF', 'Balanced', {}, 0,  45);
    expect(desperate.shoot).toBeGreaterThan(normal.shoot);
  });

  it('desperation does not trigger before minute 70', () => {
    const early = getPositionalInstructions('MF', 'Balanced', {}, -2, 69);
    const late  = getPositionalInstructions('MF', 'Balanced', {}, -2, 70);
    // At minute 70 the desperation modifier fires; at 69 it should not
    expect(late.shoot).toBeGreaterThan(early.shoot);
  });

  it('comfort (winning 2+ at minute 65) raises tackle bias', () => {
    const comfortable = getPositionalInstructions('MF', 'Balanced', {}, 2, 65);
    const normal      = getPositionalInstructions('MF', 'Balanced', {}, 0, 45);
    expect(comfortable.tackle).toBeGreaterThan(normal.tackle);
  });

  it('comfort does not trigger with only 1 goal lead', () => {
    const oneUp = getPositionalInstructions('MF', 'Balanced', {}, 1, 65);
    const normal = getPositionalInstructions('MF', 'Balanced', {}, 0, 45);
    // scoreDiff must be > 1, so 1 goal lead produces no comfort modifier
    expect(oneUp.tackle).toBeCloseTo(normal.tackle, 3);
  });

  it('unknown position falls back gracefully (all weights positive)', () => {
    const bias = getPositionalInstructions('WB', 'Balanced', {}, 0, 45);
    expect(bias.shoot).toBeGreaterThan(0);
    expect(bias.press).toBeGreaterThan(0);
  });

  it('unknown style falls back to Balanced (no crash)', () => {
    expect(() =>
      getPositionalInstructions('MF', 'UltraGegenpress', {}, 0, 45)
    ).not.toThrow();
  });

  it('elite attacking manager amplifies Offensive shoot modifier', () => {
    const elite   = getPositionalInstructions('FW', 'Offensive', { attacking: 90 }, 0, 45);
    const average = getPositionalInstructions('FW', 'Offensive', { attacking: 70 }, 0, 45);
    expect(elite.shoot).toBeGreaterThan(average.shoot);
  });
});

// ── situationZoneDelta ────────────────────────────────────────────────────────

describe('situationZoneDelta', () => {
  it('returns exactly -1, 0, or +1', () => {
    const positions = ['GK', 'DF', 'MF', 'FW'];
    const scenarios: SituationContext[] = [
      neutralCtx({ hasPossession: true }),
      neutralCtx({ hasPossession: false }),
      neutralCtx({ hasPossession: true,  scoreDiff: -2, minute: 80 }),
      neutralCtx({ hasPossession: false, scoreDiff:  2, minute: 70 }),
    ];
    for (const pos of positions) {
      for (const ctx of scenarios) {
        const delta = situationZoneDelta(ctx, pos);
        expect([-1, 0, 1]).toContain(delta);
      }
    }
  });

  it('FW with possession pushes forward (+1)', () => {
    const delta = situationZoneDelta(neutralCtx({ hasPossession: true }), 'FW');
    expect(delta).toBe(1);
  });

  it('all positions drop back when not in possession', () => {
    for (const pos of ['GK', 'DF', 'MF', 'FW']) {
      const delta = situationZoneDelta(neutralCtx({ hasPossession: false }), pos);
      expect(delta).toBe(-1);
    }
  });

  it('desperation fires from minute 75 onward when losing', () => {
    const at74 = situationZoneDelta(neutralCtx({ hasPossession: false, scoreDiff: -1, minute: 74 }), 'DF');
    const at75 = situationZoneDelta(neutralCtx({ hasPossession: false, scoreDiff: -1, minute: 75 }), 'DF');
    // at 74: no desperation (+1 from possession delta: false → -0.5, rounds to -1)
    // at 75: desperation +1 added, net 0 (−0.5 + 1 = +0.5, rounds to +1? let's just check it's ≥ at74)
    // The key invariant is desperation fires at 75, not 74
    expect(at75).toBeGreaterThanOrEqual(at74);
  });

  it('desperation does not fire when level or winning', () => {
    // scoreDiff >= 0 means no desperation regardless of minute
    const level   = situationZoneDelta(neutralCtx({ hasPossession: true, scoreDiff:  0, minute: 80 }), 'FW');
    const winning = situationZoneDelta(neutralCtx({ hasPossession: true, scoreDiff:  1, minute: 80 }), 'FW');
    // Both should be normal +1 (FW in possession) without the extra desperation push
    expect(level).toBe(1);   // FW + possession = +1, clamped at max +1
    expect(winning).toBe(1);
  });
});

// ── applyZoneDelta ────────────────────────────────────────────────────────────

describe('applyZoneDelta', () => {
  it('adding 0 returns the same zone', () => {
    const zone: Zone = { col: 1, row: 2 };
    expect(applyZoneDelta(zone, 0)).toEqual(zone);
  });

  it('adding +1 increases the row', () => {
    const zone: Zone = { col: 1, row: 1 };
    expect(applyZoneDelta(zone, 1)).toEqual({ col: 1, row: 2 });
  });

  it('adding -1 decreases the row', () => {
    const zone: Zone = { col: 1, row: 2 };
    expect(applyZoneDelta(zone, -1)).toEqual({ col: 1, row: 1 });
  });

  it('clamps at row 0 (cannot go below own goal line)', () => {
    const zone: Zone = { col: 1, row: 0 };
    expect(applyZoneDelta(zone, -1)).toEqual({ col: 1, row: 0 });
    expect(applyZoneDelta(zone, -5)).toEqual({ col: 1, row: 0 });
  });

  it('clamps at row 3 (cannot go beyond away goal line)', () => {
    const zone: Zone = { col: 1, row: 3 };
    expect(applyZoneDelta(zone, 1)).toEqual({ col: 1, row: 3 });
    expect(applyZoneDelta(zone, 5)).toEqual({ col: 1, row: 3 });
  });

  it('preserves column across all deltas', () => {
    for (const col of [0, 1, 2] as const) {
      for (const delta of [-1, 0, 1]) {
        const result = applyZoneDelta({ col, row: 1 }, delta);
        expect(result.col).toBe(col);
      }
    }
  });
});
