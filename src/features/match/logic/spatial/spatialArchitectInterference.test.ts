// ── spatial/spatialArchitectInterference.test.ts ─────────────────────────────
// Acceptance test for #530: prove the Architect's mechanical interference
// actually bites against the LIVE spatial engine (not just the legacy
// dice-roller fixtures).  Drives a real seeded spatial match, adapts it to the
// match_events shape, casts a curse_player decree at the first scorer, then
// replays the worker's post-pass: resolve curse → re-derive scoreline →
// reconcile stats.  Asserts the cursed player's goal leaves BOTH the scoreline
// and match_player_stats — the end-to-end guarantee the worker relies on.

import { describe, it, expect } from 'vitest';
import {
  simulateSpatialMatch,
  type SpatialTeamInput,
  type SpatialPlayerInput,
} from './simulateSpatialMatch';
import type { SimPlayerStats, Role } from './types';
import { adaptSpatialResult, type PlayerIndex, type AdaptedEvent } from './spatialEventAdapter';
import {
  resolveInterferenceStream,
  reconcileStatsAfterInterference,
  type InterferenceContext,
} from '../interferenceResolver';

// ── Fixtures (mirror simulateSpatialMatch.test.ts) ──────────────────────────

function stats(base: number): SimPlayerStats {
  return {
    shooting: base, passing: base, dribbling: base, speed: base, stamina: base,
    tackling: base, positioning: base, goalkeeping: base, vision: base,
  };
}

function makeXI(prefix: string, base: number): SpatialPlayerInput[] {
  const roles: Role[] = ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW'];
  return roles.map((role, i) => ({ id: `${prefix}-${i}`, name: `${prefix} ${i}`, role, stats: stats(base) }));
}

function team(prefix: string, base: number): SpatialTeamInput {
  return { formation: '4-4-2', players: makeXI(prefix, base) };
}

/** Index with deterministic team short-names so payload.team is predictable. */
function indexOf(home: SpatialTeamInput, away: SpatialTeamInput): PlayerIndex {
  const m: PlayerIndex = new Map();
  for (const p of home.players) m.set(p.id, { id: p.id, name: p.name, teamName: 'HOME', side: 'home' });
  for (const p of away.players) m.set(p.id, { id: p.id, name: p.name, teamName: 'AWAY', side: 'away' });
  return m;
}

const FULL = { matchSeconds: 90 * 60, frameEverySec: 2 };

/** Re-derive [home, away] the same way the worker does: count attributed goals by team. */
function deriveScore(events: AdaptedEvent[]): [number, number] {
  let home = 0;
  let away = 0;
  for (const ev of events) {
    if (ev.payload['isGoal'] !== true) continue;
    if (ev.payload['team'] === 'HOME') home++;
    else if (ev.payload['team'] === 'AWAY') away++;
  }
  return [home, away];
}

describe('spatial engine × Architect interference (#530)', () => {
  it('a curse_player decree annuls that scorer’s goal — scoreline and stats both drop', () => {
    const home = team('H', 80);
    const away = team('A', 55); // lopsided so an attributed goal is effectively certain
    const index = indexOf(home, away);

    // Find a seed whose match yields at least one attributed goal.
    let adapted: ReturnType<typeof adaptSpatialResult> | null = null;
    let scorer = '';
    let scorerTeam = '';
    for (const seed of [10, 20, 30, 40, 50]) {
      const a = adaptSpatialResult(simulateSpatialMatch(home, away, { ...FULL, seed }), index);
      const goal = a.events.find((e) => e.type === 'goal' && typeof e.payload['player'] === 'string');
      if (goal) {
        adapted = a;
        scorer = goal.payload['player'] as string;
        scorerTeam = goal.payload['team'] as string;
        break;
      }
    }

    // Precondition: the spatial engine attributed a goal (the #522/#533 fix).
    expect(adapted).not.toBeNull();
    const a = adapted!;
    const sideIdx = scorerTeam === 'HOME' ? 0 : 1;
    const otherIdx = sideIdx === 0 ? 1 : 0;

    const scoreBefore = deriveScore(a.events);
    const scorerGoalsBefore = a.playerStats[scorer]?.goals ?? 0;
    expect(scorerGoalsBefore).toBeGreaterThan(0);

    // Cast an inescapable curse (magnitude 10) and force every roll to fire.
    const ctx: InterferenceContext = {
      curses: [{ playerName: scorer, magnitude: 10, startMin: 0 }],
      blesses: [],
    };
    const mutated = resolveInterferenceStream(a.events, ctx, () => 0);

    // The curse actually fired.
    expect(mutated.some((e) => e.payload['interferenceApplied'] === 'curse')).toBe(true);

    // Scoreline: the cursed side loses exactly the scorer's goals; the other side is untouched.
    const scoreAfter = deriveScore(mutated);
    expect(scoreAfter[sideIdx]).toBe(scoreBefore[sideIdx] - scorerGoalsBefore);
    expect(scoreAfter[otherIdx]).toBe(scoreBefore[otherIdx]);

    // Stats: the scorer's goal tally is reconciled to zero, matching the scoreline.
    const reconciled = reconcileStatsAfterInterference(a.playerStats, mutated);
    expect(reconciled[scorer]?.goals).toBe(0);
  }, 30000);
});
