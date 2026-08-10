// ── match-worker/matchRng.test.ts ────────────────────────────────────────────
// Guards the "a fixture always reproduces the same match" invariant across the
// Architect's post-simulation passes.
//
// THE BUG THIS LOCKS OUT
//   The spatial engine has always been seeded from the match UUID, but the
//   Architect's mechanical rewrites (curse / annul_goal / force_red_card) rolled
//   against the global `Math.random`.  Two of them strike goals off the stream
//   and the worker re-derives `finalScore` from the mutated stream — so a worker
//   retry could persist a different scoreline from a byte-identical simulation,
//   after wagers had been settled against the first one.
//
// WHAT IS AND ISN'T DETERMINISTIC
//   The Architect's INTENTS come from the LLM and stay non-deterministic by
//   design.  What these tests pin is the RESOLUTION of a given set of intents:
//   same match id + same intents → same events, same score, every time.

import { describe, it, expect } from 'vitest';
import { narrativeRngForMatch, seedFromMatchId } from './matchRng.ts';
import { makeRng } from './spatial/rng.ts';
import { applyAnnulGoals, type AnnulGoalIntent } from './interferenceResolver.ts';
import type { SimulatedEvent } from './simEvent.ts';

/** A stand-in fixture id; any valid UUID works — only its first 8 hex digits matter. */
const MATCH_ID = '3f2a91c4-77b8-4e2d-9a10-5c6d8e0f1234';

/** Four goals for one side, so an annul intent has somewhere to land. */
function goalStream(): SimulatedEvent[] {
  return [10, 25, 61, 78].map((minute) => ({
    minute,
    subminute: 0,
    type: 'goal',
    payload: { team: 'HOM', player: `Striker ${minute}`, isGoal: true },
  }));
}

/** Count the goals still standing after a post-pass — the worker's own re-derivation. */
function goalsIn(events: SimulatedEvent[]): number {
  return events.filter((ev) => ev.payload['isGoal'] === true).length;
}

describe('match-seeded narrative RNG', () => {
  it('derives the simulation seed from the first 8 hex digits of the UUID', () => {
    // The worker has used this exact expression since the spatial engine
    // landed. Changing it re-rolls every future fixture, so it is pinned here.
    expect(seedFromMatchId(MATCH_ID)).toBe(0x3f2a91c4);
    expect(seedFromMatchId('00000000-0000-4000-8000-000000000000')).toBe(0);
  });

  it('emits an identical sequence for the same match id', () => {
    const first = Array.from({ length: 16 }, narrativeRngForMatch(MATCH_ID));
    const second = Array.from({ length: 16 }, narrativeRngForMatch(MATCH_ID));
    expect(first).toEqual(second);
  });

  it('emits a different sequence for a different match id', () => {
    const other = '9b7c1d0e-1111-4222-8333-444455556666';
    expect(Array.from({ length: 8 }, narrativeRngForMatch(MATCH_ID))).not.toEqual(
      Array.from({ length: 8 }, narrativeRngForMatch(other)),
    );
  });

  it('runs on a stream independent of the simulation seed', () => {
    // If the Architect shared the engine's stream, its rolls would be a
    // function of how many draws the sim happened to consume.
    expect(Array.from({ length: 8 }, narrativeRngForMatch(MATCH_ID))).not.toEqual(
      Array.from({ length: 8 }, makeRng(seedFromMatchId(MATCH_ID))),
    );
  });
});

describe('Architect result rewrites are reproducible per match', () => {
  // magnitude 5 → a 50% firing chance, so the outcome genuinely depends on the
  // roll; a constant RNG would pass the "same twice" test trivially, hence the
  // spread assertion below.
  const intents: AnnulGoalIntent[] = [
    { team: 'HOM', minute: 0, magnitude: 5 },
    { team: 'HOM', minute: 40, magnitude: 5 },
  ];

  it('annuls the same goals and lands the same score on a re-run', () => {
    const first = applyAnnulGoals(goalStream(), intents, narrativeRngForMatch(MATCH_ID));
    const second = applyAnnulGoals(goalStream(), intents, narrativeRngForMatch(MATCH_ID));

    expect(second).toEqual(first);
    expect(goalsIn(second)).toBe(goalsIn(first));
  });

  it('still varies across fixtures rather than resolving one fixed way', () => {
    const scores = new Set<number>();
    for (let i = 1; i <= 40; i++) {
      // Vary the leading hex digits so each id seeds a distinct stream.
      const id = `${i.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
      scores.add(goalsIn(applyAnnulGoals(goalStream(), intents, narrativeRngForMatch(id))));
    }
    expect(scores.size).toBeGreaterThan(1);
  });
});
