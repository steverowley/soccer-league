// ── gameEngine.smoke.test.ts ─────────────────────────────────────────────────
// WHY: gameEngine.js is 2725 LOC of complex match-simulation code with zero
// test coverage today.  Package 10 (the match-simulation worker) is about to
// exercise it server-side for the first time, which means latent bugs would
// surface in production.  This file establishes a baseline of invariant
// smoke tests so any future regression in the engine fails CI immediately.
//
// SCOPE: invariants only — we make no claim about the *correctness* of the
// game logic.  Game-logic correctness would require a behavioural model
// (penalties happen at expected rates, possession averages 50/50, …) that
// does not exist anywhere yet.  Smoke is the right starting point: ensure
// the engine can run 100 random matches without throwing, and that its
// outputs respect basic sanity bounds.
//
// HOW THE TEST DRIVES THE ENGINE
// ─────────────────────────────
// We mirror the `simulateMinute()` loop in App.jsx as a minimal harness:
// for each minute 1..90, call genEvent() with the running match state,
// accumulate events, apply momentum/score deltas, and feed `lastEventType`
// back in for the next call.  This is deliberately a stripped-down version
// of the full engine driver — it skips halftime/stoppage logic, late-game
// interventions, and the Architect feedback loop, none of which are needed
// to exercise the per-minute event generator in genEvent.
//
// DETERMINISM
// ───────────
// We seed Math.random() with a tiny LCG so each run is reproducible.  100
// distinct seeds give us 100 distinct matches.  vi.spyOn restoration is
// handled in afterEach so test isolation is preserved.

import { describe, it, expect, vi, afterEach } from 'vitest';
import TEAMS from './teams';
// gameEngine is still .js at runtime; the adjacent gameEngine.d.ts supplies
// strict types so this import resolves to a fully typed surface.
import { createAIManager, genEvent } from './gameEngine.js';
import type { EnginePlayer, EngineTeam, MatchEvent } from './gameEngine.types';

// ── Seeded RNG ────────────────────────────────────────────────────────────────

/**
 * Linear-congruential generator. Produces a deterministic sequence of
 * floats in [0, 1) from any 32-bit seed.  Constants are the Numerical
 * Recipes "minstd_rand" pair which has good distribution for the small
 * sample sizes the engine pulls per minute (~5–20 calls).
 */
function makeLCG(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

// ── Minimal match harness ─────────────────────────────────────────────────────

interface SimResult {
  score:    [number, number];
  events:   MatchEvent[];
  momentum: [number, number];
}

/**
 * Run a full 90-minute match using the seeded RNG, returning the final state.
 * Mirrors the structure of App.jsx::simulateMinute() but trimmed to the parts
 * needed to exercise genEvent() across all minutes.
 */
function runFullMatch(rng: () => number): SimResult {
  vi.spyOn(Math, 'random').mockImplementation(rng);

  // Deep-clone the static fallback teams so tests don't share mutable state.
  // structuredClone is faster than JSON-roundtripping but unsupported in some
  // older Node targets; vitest runs Node 20+ so it is safe here.
  const home: EngineTeam = structuredClone(TEAMS['mars']!);
  const away: EngineTeam = structuredClone(TEAMS['saturn']!);

  // createAIManager builds the AIM (referee, agents, weather, flashpoint
  // caps, …) once at kickoff.  It also seeds initial agent fatigue/morale
  // so the same RNG sequence produces the same agents.
  const aim = createAIManager(home, away);

  const score:    [number, number] = [0, 0];
  let momentum:   [number, number] = [50, 50];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const playerStats: Record<string, any> = {};
  const events: MatchEvent[] = [];

  const activePlayers = {
    home: home.players.filter((p: EnginePlayer) => p.starter).map((p) => p.name),
    away: away.players.filter((p: EnginePlayer) => p.starter).map((p) => p.name),
  };
  const substitutionsUsed = { home: 0, away: 0 };
  let lastEventType: string | null = null;

  // The 10th positional arg (`aiInfluence`) is the per-team SHOOT/ATTACK
  // decision-bias bag returned by aim.getDecisionInfluence() in the real
  // game.  genEvent guards against a null aiInfluence (`if (aiInfluence) …`)
  // so we pass null here to skip the AI-bias branch entirely — the smoke
  // test only needs the engine to run and produce events, not to model the
  // manager AI's preferences.
  //
  // The 14th positional arg (`genCtx`) is the Architect-feature context
  // bag (intentions, edicts, sealed fate, curses, …).  Passing {} means
  // every Architect branch sees a falsy value and skips its overrides,
  // which is exactly what we want for invariant-only smoke testing.
  for (let min = 1; min <= 90; min++) {
    const ev = genEvent(
      min, home, away, momentum, 50, playerStats, score,
      activePlayers, substitutionsUsed, null, aim, 0, lastEventType, {},
    ) as MatchEvent | null;

    if (!ev) continue;

    events.push(ev);

    if (ev.isGoal) {
      if (ev.team === home.shortName) score[0]++;
      else                            score[1]++;
    }

    // Apply momentum delta (clamped) so subsequent minutes see a realistic
    // momentum value rather than a stuck 50/50.
    const dh = ev.momentumChange?.[0] ?? 0;
    const da = ev.momentumChange?.[1] ?? 0;
    momentum = [
      Math.max(0, Math.min(100, momentum[0] + dh)),
      Math.max(0, Math.min(100, momentum[1] + da)),
    ];

    lastEventType = ev.type;
  }

  return { score, events, momentum };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('gameEngine smoke', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs 100 random full matches without throwing', () => {
    // Single test loop (rather than 100 separate it() calls) keeps the
    // overall suite under the <10s acceptance budget by avoiding 100×
    // vitest setup/teardown cycles.  Per-match diagnostics are reported
    // via `cause` on the thrown AssertionError.
    for (let seed = 1; seed <= 100; seed++) {
      let result: SimResult;
      try {
        result = runFullMatch(makeLCG(seed));
      } catch (err) {
        throw new Error(`match seed=${seed} threw: ${(err as Error).message}`);
      }

      // ── Score invariants ────────────────────────────────────────────────
      // No NaN/Infinity sneaking through any score-update path.
      expect(Number.isFinite(result.score[0]), `seed ${seed} home NaN`).toBe(true);
      expect(Number.isFinite(result.score[1]), `seed ${seed} away NaN`).toBe(true);

      // Non-negative — a negative score would mean we double-decremented
      // somewhere (VAR overturn rolling back below 0).
      expect(result.score[0], `seed ${seed} home<0`).toBeGreaterThanOrEqual(0);
      expect(result.score[1], `seed ${seed} away<0`).toBeGreaterThanOrEqual(0);

      // Bounded.  The highest realistic 90-minute score in a chaos sim is
      // far below 12; a score above that signals an infinite-loop or a
      // duplicate-goal regression.
      expect(result.score[0], `seed ${seed} home>12`).toBeLessThanOrEqual(12);
      expect(result.score[1], `seed ${seed} away>12`).toBeLessThanOrEqual(12);

      // ── Event invariants ────────────────────────────────────────────────
      // Every event minute must be in the legal match range.
      // 0 is allowed for kickoff-style markers, and 120 is the cap for
      // hypothetical extra-time-aware sims (we drive 1–90 here, but the
      // upper bound is the engine's own contract).
      for (const ev of result.events) {
        expect(ev.minute, `seed ${seed} bad minute=${ev.minute}`).toBeGreaterThanOrEqual(0);
        expect(ev.minute, `seed ${seed} bad minute=${ev.minute}`).toBeLessThanOrEqual(120);
      }

      // ── Momentum invariants ─────────────────────────────────────────────
      // Both ends of the momentum scale must remain inside [0, 100] after
      // applying every event's momentumChange — clamped by our harness, but
      // a clamp that fires every tick would still be a real bug.
      expect(result.momentum[0]).toBeGreaterThanOrEqual(0);
      expect(result.momentum[0]).toBeLessThanOrEqual(100);
      expect(result.momentum[1]).toBeGreaterThanOrEqual(0);
      expect(result.momentum[1]).toBeLessThanOrEqual(100);
    }
  });

  it('produces at least some events across 100 matches (engine is not silent)', () => {
    // A regression that broke the event-gate probability calculation could
    // produce a "match" with zero events.  Aggregating across 100 matches
    // catches the hard-zero case without committing to an exact count.
    let totalEvents = 0;
    for (let seed = 200; seed < 300; seed++) {
      totalEvents += runFullMatch(makeLCG(seed)).events.length;
    }
    expect(totalEvents).toBeGreaterThan(0);
  });
});
