// ── spatial/spatialArchitectInterference.test.ts ─────────────────────────────
// Acceptance tests for #530: prove the Architect's mechanical interference
// bites against the LIVE spatial engine (not just hand-authored fixtures).
// We drive ONE real seeded spatial match where both sides score and a tackle
// occurs, then replay the worker's post-pass against it:
//   • curse_player  → the scorer's goal leaves both the re-derived scoreline
//                     AND match_player_stats (leaving the other side intact).
//   • force_red_card → a real spatial tackle is promoted to a red card in the
//                     feed (commentary) and the stats (redCard) — criterion (b).

import { describe, it, expect, beforeAll } from 'vitest';
import {
  simulateSpatialMatch,
  type SpatialTeamInput,
  type SpatialPlayerInput,
} from './simulateSpatialMatch';
import type { SimPlayerStats, Role } from './types';
import { adaptSpatialResult, type PlayerIndex, type AdaptedEvent } from './spatialEventAdapter';
import {
  applyForceRedCards,
  resolveInterferenceStream,
  reconcileStatsAfterInterference,
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

const firstAttributedGoal = (a: { events: AdaptedEvent[] }, t: 'HOME' | 'AWAY') =>
  a.events.find((e) => e.type === 'goal' && e.payload['team'] === t && typeof e.payload['player'] === 'string');

describe('spatial engine × Architect interference (#530)', () => {
  // Near-equal ratings so BOTH sides score often — makes the "other side
  // untouched" assertion non-vacuous and guarantees an away co-scorer to
  // preserve.  (Post-calibration the engine scores ~2.5/match, so we scan a few
  // seeds for one where both teams found the net AND a tackle occurred.)
  const home = team('H', 75);
  const away = team('A', 74);
  const index = indexOf(home, away);

  let adapted: ReturnType<typeof adaptSpatialResult>;

  beforeAll(() => {
    for (let seed = 1; seed <= 40; seed++) {
      const a = adaptSpatialResult(simulateSpatialMatch(home, away, { ...FULL, seed }), index);
      const [h, aw] = deriveScore(a.events);
      const hasTackle = a.events.some((e) => e.type === 'tackle' && typeof e.payload['player'] === 'string');
      if (h > 0 && aw > 0 && hasTackle) { adapted = a; return; }
    }
    throw new Error('no seed produced a both-sides-scoring spatial match with a tackle');
  }, 60000);

  it('curse_player annuls the scorer’s goal in scoreline AND stats, leaving the other side intact', () => {
    const before = deriveScore(adapted.events);

    const homeGoal = firstAttributedGoal(adapted, 'HOME')!;
    const scorer = homeGoal.payload['player'] as string;
    const scorerGoals = adapted.playerStats[scorer]?.goals ?? 0;
    expect(scorerGoals).toBeGreaterThan(0);

    // Inescapable curse: magnitude 10, every roll fires.
    const mutated = resolveInterferenceStream(
      adapted.events,
      { curses: [{ playerName: scorer, magnitude: 10, startMin: 0 }], blesses: [] },
      () => 0,
    );
    expect(mutated.some((e) => e.payload['interferenceApplied'] === 'curse')).toBe(true);

    const after = deriveScore(mutated);
    expect(after[0]).toBe(before[0] - scorerGoals); // home loses exactly the cursed scorer's goals
    expect(after[1]).toBe(before[1]);               // away untouched...
    expect(after[1]).toBeGreaterThan(0);            // ...and this is a real (non-zero) invariant

    const reconciled = reconcileStatsAfterInterference(adapted.playerStats, mutated);
    expect(reconciled[scorer]?.goals).toBe(0);

    // A scorer on the untouched side keeps their goal (only the target is annulled).
    const awayScorer = firstAttributedGoal(adapted, 'AWAY')!.payload['player'] as string;
    expect(reconciled[awayScorer]?.goals).toBe(adapted.playerStats[awayScorer]?.goals);
  });

  it('force_red_card promotes a real spatial tackle to a red card in feed + stats (criterion b)', () => {
    const tackle = adapted.events.find((e) => e.type === 'tackle' && typeof e.payload['player'] === 'string')!;
    const tackler = tackle.payload['player'] as string;
    expect(adapted.playerStats[tackler]?.redCard).toBe(false); // not sent off pre-interference

    const mutated = applyForceRedCards(
      adapted.events,
      [{ playerName: tackler, minute: 0, magnitude: 10 }],
      () => 0,
    );

    const promoted = mutated.find((e) => e.payload['interferenceApplied'] === 'force_red_card');
    expect(promoted?.payload['cardType']).toBe('red');
    expect(promoted?.payload['commentary']).toBe(`${tackler} is shown a straight red card.`);

    const reconciled = reconcileStatsAfterInterference(adapted.playerStats, mutated);
    expect(reconciled[tackler]?.redCard).toBe(true);
  });
});
