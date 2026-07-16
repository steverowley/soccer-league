// ── realMatch.test.ts ───────────────────────────────────────────────────────
// Verifies a real-team matchup: real names/positions/colours/formation flow
// through, the rendered roster ids match the frame ids, and it's deterministic.

import { describe, it, expect, vi } from 'vitest';

import { simulateMatchFromTeams, type TeamSimData } from './realMatch';

// Each test runs at least one full 90-minute sim; the determinism test runs two.
// Give headroom so two sims don't trip vitest's 5s default on slower CI runners.
vi.setConfig({ testTimeout: 30000 });

/** Build a full 4-4-2 team row with neutral composite stats. */
function team(prefix: string, formation: string): TeamSimData {
  const roles = ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW'];
  return {
    name: prefix,
    managers: [{ preferred_formation: formation }],
    players: roles.map((position, i) => ({
      id: `${prefix}-${i}`,
      name: `${prefix} Player ${i}`,
      position,
      starter: true,
      is_active: true,
      attacking: 70,
      defending: 70,
      mental: 70,
      athletic: 70,
      technical: 70,
    })),
  };
}

describe('simulateMatchFromTeams', () => {
  it('carries real names, positions and formation through', () => {
    const m = simulateMatchFromTeams(team('home', '4-4-2'), team('away', '3-4-3'), 5);
    expect(m.homePlayers).toHaveLength(11);
    expect(m.awayPlayers).toHaveLength(11);
    // Slot 0 is the keeper on both sides.
    expect(m.homePlayers[0]!.position).toBe('GK');
    expect(m.awayPlayers[0]!.position).toBe('GK');
    // Real display names propagate (no anonymous fillers for a full XI).
    expect(m.homePlayers.every((p) => !!p.name)).toBe(true);
    expect(m.homeFormation).toBe('4-4-2');
    expect(m.awayFormation).toBe('3-4-3');
    expect(m.homeTeamName).toBe('home');
  });

  it('renders roster ids that exactly match the frame ids', () => {
    const m = simulateMatchFromTeams(team('h', '4-4-2'), team('a', '4-4-2'), 9);
    const frameIds = new Set(m.frames[0]!.snapshots.players.map((p) => p.id));
    for (const p of [...m.homePlayers, ...m.awayPlayers]) {
      expect(frameIds.has(p.id)).toBe(true);
    }
    expect(m.frames.length).toBeGreaterThan(1000); // full 90-minute match
  });

  it('is deterministic for the same teams + seed', () => {
    const a = simulateMatchFromTeams(team('h', '4-4-2'), team('a', '4-4-2'), 3);
    const b = simulateMatchFromTeams(team('h', '4-4-2'), team('a', '4-4-2'), 3);
    expect(a.finalScore).toEqual(b.finalScore);
    expect(a.frames.length).toBe(b.frames.length);
  });

  it('falls back to fillers (no crash) when a team has no players', () => {
    const empty: TeamSimData = { name: 'Empty', managers: [], players: [] };
    const m = simulateMatchFromTeams(empty, team('a', '4-4-2'), 1);
    expect(m.homePlayers).toHaveLength(11); // synthesised reserves fill the XI
    expect(m.frames.length).toBeGreaterThan(0);
  });

  it('labels the bench so substitutes can be rendered when they come on', () => {
    // A full XI plus five substitutes (starter: false) — the engine's bench.
    const withBench = (prefix: string): TeamSimData => {
      const base = team(prefix, '4-4-2');
      return {
        ...base,
        players: [
          ...(base.players ?? []),
          ...['GK', 'DF', 'MF', 'MF', 'FW'].map((position, i) => ({
            id: `${prefix}-sub-${i}`, name: `${prefix} Sub ${i}`, position,
            starter: false, is_active: true,
            attacking: 70, defending: 70, mental: 70, athletic: 70, technical: 70,
          })),
        ],
      };
    };
    const m = simulateMatchFromTeams(withBench('h'), withBench('a'), 5);

    // The XI (11) and the bench (5) are both labelled, per side.
    expect(m.homePlayers).toHaveLength(16);
    expect(m.awayPlayers).toHaveLength(16);
    expect(m.homePlayers.some((p) => p.id === 'h-sub-0')).toBe(true);

    // A substitute isn't on the pitch at kickoff but takes the field later, so
    // their frame id now resolves to a label the viewer can draw.
    const subOnPitch = (f: { snapshots: { players: Array<{ id: string }> } }) =>
      f.snapshots.players.some((p) => p.id.includes('-sub-'));
    expect(subOnPitch(m.frames[0]!)).toBe(false);
    expect(m.frames.some(subOnPitch)).toBe(true);
  });
});
