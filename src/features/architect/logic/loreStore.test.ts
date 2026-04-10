// ── loreStore.test.ts ───────────────────────────────────────────────────────
// WHY: Unit tests for the pure conversion functions (rowsToLore, loreToRows)
// and the LoreStore class lifecycle. These functions are the bridge between
// the DB's (scope, key, payload) rows and the in-memory ArchitectLore object
// used by CosmicArchitect. Getting this mapping wrong would silently corrupt
// the shared narrative.

import { describe, it, expect } from 'vitest';
import {
  emptyLore,
  rowsToLore,
  loreToRows,
  MAX_LEDGER,
} from './loreStore';
import type { ArchitectLoreRow } from '../types';

// ── Helper: build a minimal ArchitectLoreRow ────────────────────────────────

function row(
  scope: string,
  key: string,
  payload: Record<string, unknown>,
): ArchitectLoreRow {
  return {
    id: 'test-id',
    scope,
    key,
    payload,
    updated_at: '2026-01-01T00:00:00Z',
  };
}

// ── emptyLore ───────────────────────────────────────────────────────────────

describe('emptyLore', () => {
  it('returns version 2 with all fields initialised', () => {
    const lore = emptyLore();
    expect(lore.version).toBe(2);
    expect(lore.playerArcs).toEqual({});
    expect(lore.managerFates).toEqual({});
    expect(lore.rivalryThreads).toEqual({});
    expect(lore.seasonArcs).toEqual({});
    expect(lore.matchLedger).toEqual([]);
    expect(lore.currentSeason).toBeNull();
    expect(lore.playerRelationships).toEqual({});
  });

  it('returns a new object each time (no shared references)', () => {
    const a = emptyLore();
    const b = emptyLore();
    expect(a).not.toBe(b);
    expect(a.playerArcs).not.toBe(b.playerArcs);
  });
});

// ── rowsToLore ──────────────────────────────────────────────────────────────

describe('rowsToLore', () => {
  it('returns empty lore for empty rows', () => {
    const lore = rowsToLore([]);
    expect(lore).toEqual(emptyLore());
  });

  it('reconstructs playerArcs from player:{name} scope', () => {
    const rows = [
      row('player:Kael Vorn', 'arc', { team: 'Mars Athletic', arc: 'The defiant striker' }),
      row('player:Zyx Alpha', 'arc', { team: 'Jupiter Royals FC', arc: 'Silent guardian' }),
    ];
    const lore = rowsToLore(rows);
    expect(lore.playerArcs['Kael Vorn']).toEqual({
      team: 'Mars Athletic',
      arc: 'The defiant striker',
    });
    expect(lore.playerArcs['Zyx Alpha']).toEqual({
      team: 'Jupiter Royals FC',
      arc: 'Silent guardian',
    });
  });

  it('reconstructs managerFates from manager:{name} scope', () => {
    const rows = [
      row('manager:Coach Nexus', 'fate', { team: 'Saturn Rings United', fate: 'Doomed to fail' }),
    ];
    const lore = rowsToLore(rows);
    expect(lore.managerFates['Coach Nexus']).toEqual({
      team: 'Saturn Rings United',
      fate: 'Doomed to fail',
    });
  });

  it('reconstructs rivalryThreads from rivalry:{key} scope', () => {
    const rows = [
      row('rivalry:mars_vs_saturn', 'thread', {
        thread: 'Ancient enemies since the Belt Wars',
        lastResult: 'mars',
      }),
    ];
    const lore = rowsToLore(rows);
    expect(lore.rivalryThreads['mars_vs_saturn']).toEqual({
      thread: 'Ancient enemies since the Belt Wars',
      lastResult: 'mars',
    });
  });

  it('reconstructs seasonArcs from season:{id} scope', () => {
    const rows = [
      row('season:2026_1', 'arc', { arc: 'The year of cosmic upheaval' }),
    ];
    const lore = rowsToLore(rows);
    expect(lore.seasonArcs['2026_1']).toEqual({
      arc: 'The year of cosmic upheaval',
    });
  });

  it('reconstructs playerRelationships from relationship:{key} scope', () => {
    const rel = {
      type: 'rivalry',
      intensity: 0.7,
      thread: 'Bitter foes since the Solar Cup final',
      teams: ['Mars Athletic', 'Saturn Rings United'],
      createdMatch: 'match-001',
      matchCount: 5,
    };
    const rows = [row('relationship:alice_vs_bob', 'details', rel)];
    const lore = rowsToLore(rows);
    expect(lore.playerRelationships['alice_vs_bob']).toEqual(rel);
  });

  it('reconstructs global match_ledger', () => {
    const entries = [
      {
        home: 'Mars',
        away: 'Saturn',
        score: [2, 1],
        league: 'Rocky Inner',
        season: 2026,
        matchday: 15,
        architectVerdict: 'Spectacular',
        keyThreads: ['thread1'],
        mvp: 'Kael Vorn',
      },
    ];
    const rows = [row('global', 'match_ledger', { entries })];
    const lore = rowsToLore(rows);
    expect(lore.matchLedger).toEqual(entries);
  });

  it('reconstructs global current_season', () => {
    const rows = [row('global', 'current_season', { value: 'season_2026_1' })];
    const lore = rowsToLore(rows);
    expect(lore.currentSeason).toBe('season_2026_1');
  });

  it('handles null current_season', () => {
    const rows = [row('global', 'current_season', { value: null })];
    const lore = rowsToLore(rows);
    expect(lore.currentSeason).toBeNull();
  });

  it('silently ignores unknown scope prefixes', () => {
    const rows = [
      row('unknown:something', 'data', { foo: 'bar' }),
      row('player:Kael Vorn', 'arc', { team: 'Mars', arc: 'Hero' }),
    ];
    const lore = rowsToLore(rows);
    // Unknown scope ignored, player arc still parsed.
    expect(Object.keys(lore.playerArcs)).toEqual(['Kael Vorn']);
  });

  it('silently ignores scopes without a colon separator (except global)', () => {
    const rows = [
      row('malformed', 'key', { data: true }),
      row('global', 'current_season', { value: 's1' }),
    ];
    const lore = rowsToLore(rows);
    expect(lore.currentSeason).toBe('s1');
  });

  it('handles mixed scope types in a single batch', () => {
    const rows = [
      row('global', 'match_ledger', { entries: [] }),
      row('global', 'current_season', { value: 's1' }),
      row('player:A', 'arc', { team: 'T1', arc: 'arc-a' }),
      row('player:B', 'arc', { team: 'T2', arc: 'arc-b' }),
      row('manager:M', 'fate', { team: 'T1', fate: 'fate-m' }),
      row('rivalry:t1_vs_t2', 'thread', { thread: 'rivals', lastResult: 'draw' }),
      row('season:s1', 'arc', { arc: 'chaos' }),
      row('relationship:a_vs_b', 'details', {
        type: 'rivalry',
        intensity: 0.5,
        thread: 'foes',
        teams: ['T1', 'T2'],
        createdMatch: 'm1',
        matchCount: 1,
      }),
    ];
    const lore = rowsToLore(rows);
    expect(lore.currentSeason).toBe('s1');
    expect(Object.keys(lore.playerArcs)).toHaveLength(2);
    expect(Object.keys(lore.managerFates)).toHaveLength(1);
    expect(Object.keys(lore.rivalryThreads)).toHaveLength(1);
    expect(Object.keys(lore.seasonArcs)).toHaveLength(1);
    expect(Object.keys(lore.playerRelationships)).toHaveLength(1);
  });
});

// ── loreToRows ──────────────────────────────────────────────────────────────

describe('loreToRows', () => {
  it('converts empty lore to 2 global rows', () => {
    const rows = loreToRows(emptyLore());
    // Always emits match_ledger + current_season even when empty.
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      scope: 'global',
      key: 'match_ledger',
      payload: { entries: [] },
    });
    expect(rows[1]).toEqual({
      scope: 'global',
      key: 'current_season',
      payload: { value: null },
    });
  });

  it('emits one row per player arc', () => {
    const lore = emptyLore();
    lore.playerArcs['Kael Vorn'] = { team: 'Mars', arc: 'Hero' };
    lore.playerArcs['Zyx Alpha'] = { team: 'Jupiter', arc: 'Shadow' };
    const rows = loreToRows(lore);
    const playerRows = rows.filter((r) => r.scope.startsWith('player:'));
    expect(playerRows).toHaveLength(2);
    expect(playerRows[0]).toEqual({
      scope: 'player:Kael Vorn',
      key: 'arc',
      payload: { team: 'Mars', arc: 'Hero' },
    });
  });

  it('emits one row per manager fate', () => {
    const lore = emptyLore();
    lore.managerFates['Coach X'] = { team: 'T1', fate: 'Doomed' };
    const rows = loreToRows(lore);
    const managerRows = rows.filter((r) => r.scope.startsWith('manager:'));
    expect(managerRows).toHaveLength(1);
    expect(managerRows[0]!.scope).toBe('manager:Coach X');
  });

  it('emits one row per rivalry thread', () => {
    const lore = emptyLore();
    lore.rivalryThreads['a_vs_b'] = { thread: 'Enemies', lastResult: 'draw' };
    const rows = loreToRows(lore);
    const rivalryRows = rows.filter((r) => r.scope.startsWith('rivalry:'));
    expect(rivalryRows).toEqual([
      { scope: 'rivalry:a_vs_b', key: 'thread', payload: { thread: 'Enemies', lastResult: 'draw' } },
    ]);
  });

  it('emits one row per season arc', () => {
    const lore = emptyLore();
    lore.seasonArcs['s1'] = { arc: 'Chaos reigns' };
    const rows = loreToRows(lore);
    const seasonRows = rows.filter((r) => r.scope.startsWith('season:'));
    expect(seasonRows).toEqual([
      { scope: 'season:s1', key: 'arc', payload: { arc: 'Chaos reigns' } },
    ]);
  });

  it('emits one row per relationship', () => {
    const lore = emptyLore();
    lore.playerRelationships['x_vs_y'] = {
      type: 'grudge',
      intensity: 0.9,
      thread: 'Bitter',
      teams: ['T1', 'T2'],
      createdMatch: 'm1',
      matchCount: 3,
    };
    const rows = loreToRows(lore);
    const relRows = rows.filter((r) => r.scope.startsWith('relationship:'));
    expect(relRows).toHaveLength(1);
    expect(relRows[0]!.scope).toBe('relationship:x_vs_y');
    expect(relRows[0]!.key).toBe('details');
  });
});

// ── Round-trip: lore → rows → lore ──────────────────────────────────────────

describe('round-trip conversion', () => {
  it('empty lore survives a round-trip', () => {
    const original = emptyLore();
    const rows = loreToRows(original).map((r) =>
      row(r.scope, r.key, r.payload),
    );
    const reconstructed = rowsToLore(rows);
    expect(reconstructed).toEqual(original);
  });

  it('populated lore survives a round-trip', () => {
    const original = emptyLore();
    original.currentSeason = 'season_2026_1';
    original.playerArcs['Kael'] = { team: 'Mars', arc: 'Defiant' };
    original.managerFates['Coach'] = { team: 'Saturn', fate: 'Fallen' };
    original.rivalryThreads['mars_vs_saturn'] = {
      thread: 'Ancient enemies',
      lastResult: 'mars',
    };
    original.seasonArcs['2026_1'] = { arc: 'Upheaval' };
    original.playerRelationships['kael_vs_zyx'] = {
      type: 'rivalry',
      intensity: 0.6,
      thread: 'Foes',
      teams: ['Mars', 'Jupiter'],
      createdMatch: 'm1',
      matchCount: 2,
    };
    original.matchLedger = [
      {
        home: 'Mars',
        away: 'Saturn',
        score: [3, 0],
        league: 'Rocky',
        season: 2026,
        matchday: 1,
        architectVerdict: 'Glorious',
        keyThreads: ['t1'],
        mvp: 'Kael',
      },
    ];

    const rows = loreToRows(original).map((r) =>
      row(r.scope, r.key, r.payload),
    );
    const reconstructed = rowsToLore(rows);
    expect(reconstructed).toEqual(original);
  });
});

// ── MAX_LEDGER constant ─────────────────────────────────────────────────────

describe('MAX_LEDGER', () => {
  it('matches the CosmicArchitect constant (50)', () => {
    expect(MAX_LEDGER).toBe(50);
  });
});
