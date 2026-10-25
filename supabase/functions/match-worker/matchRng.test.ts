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
import { narrativeRngForMatch, seedFromMatchId, newMatchSeed, recordSeedOnKickoff, resolveMatchSeed, type SeedStore } from './matchRng.ts';
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

// Engine v2 (#698): each match gets a fresh random seed, recorded on the
// kickoff event so the persisted match can be replayed exactly.
describe('engine v2 match seed', () => {
  it('draws an unsigned 32-bit integer from the injected source', () => {
    expect(newMatchSeed((buf) => { buf[0] = 0xdeadbeef; return buf; })).toBe(0xdeadbeef);
    expect(newMatchSeed((buf) => { buf[0] = 0; return buf; })).toBe(0);
  });

  it('uses Web Crypto by default and varies between matches', () => {
    const seeds = new Set(Array.from({ length: 16 }, () => newMatchSeed()));
    for (const seed of seeds) {
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(0xffffffff);
    }
    expect(seeds.size).toBeGreaterThan(1);
  });

  it('records the seed on the first kickoff event only', () => {
    const events = [
      { type: 'kickoff', payload: { commentary: 'Kickoff!' } as Record<string, unknown> },
      { type: 'pass', payload: {} as Record<string, unknown> },
      { type: 'kickoff', payload: {} as Record<string, unknown> },
    ];
    recordSeedOnKickoff(events, 12345);
    expect(events[0]!.payload).toEqual({ commentary: 'Kickoff!', seed: 12345 });
    expect(events[1]!.payload).toEqual({});
    expect(events[2]!.payload).toEqual({});
  });

  it('leaves a feed with no kickoff untouched', () => {
    const events = [{ type: 'pass', payload: {} as Record<string, unknown> }];
    recordSeedOnKickoff(events, 1);
    expect(events[0]!.payload).toEqual({});
  });
});
// ── Retry safety: the seed lives on the match row ──────────────────────────
/** The spatial engine, imported once for the whole file. */
let enginePromise: Promise<typeof import('./spatial/simulateSpatialMatch.ts')> | null = null;
function engine(): Promise<typeof import('./spatial/simulateSpatialMatch.ts')> {
  enginePromise ??= import('./spatial/simulateSpatialMatch.ts');
  return enginePromise;
}

// A worker that crashes after claiming is retried.  The retry must simulate
// the SAME match, so the seed is stored on matches.sim_seed before the first
// simulation and read back on every later attempt (migration 0088).

/** An in-memory stand-in for the matches row with the worker's conditional write. */
function rowStore(initial: number | string | null = null): SeedStore & { value: number | string | null; writes: number } {
  const st = {
    value: initial,
    writes: 0,
    async persistIfUnset(seed: number) {
      if (st.value === null) { st.value = seed; st.writes += 1; }
      return st.value;
    },
  };
  return st;
}

const fixed = (v: number) => (buf: Uint32Array) => { buf[0] = v; return buf; };

describe('resolveMatchSeed (worker retry safety)', () => {
  it('generates and stores a seed on the first attempt', async () => {
    const row = rowStore();
    const seed = await resolveMatchSeed(null, row, fixed(4242));
    expect(seed).toBe(4242);
    expect(row.value).toBe(4242);
    expect(row.writes).toBe(1);
  });

  it('reuses the stored seed on a retry and never writes again', async () => {
    const row = rowStore();
    const first = await resolveMatchSeed(null, row, fixed(777));
    // The retry re-claims the row and reads sim_seed back from it.
    const retry = await resolveMatchSeed(row.value, row, fixed(999));
    expect(retry).toBe(first);
    expect(row.writes).toBe(1);
  });

  // Two ten-minute simulations: well over vitest's 5 s default when the full
  // suite runs in parallel, so the budget is explicit.  The engine module is
  // loaded once and shared (the import is most of the cold-start cost).
  it('a retry replays a byte-identical match', async () => {
    const { simulateSpatialMatch } = await engine();
    const stats = { shooting: 70, passing: 70, dribbling: 70, speed: 70, stamina: 70, tackling: 70, positioning: 70, goalkeeping: 70, vision: 70 };
    const roles = ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW'] as const;
    const side = (p: string) => ({ formation: '4-4-2', players: roles.map((role, i) => ({ id: `${p}${i}`, name: `${p}${i}`, role, stats })) });
    const row = rowStore();
    const s1 = await resolveMatchSeed(null, row, fixed(31337));
    const s2 = await resolveMatchSeed(row.value, row, fixed(1));
    const short = { matchSeconds: 600, stoppage: false };
    const a = simulateSpatialMatch(side('h'), side('a'), { ...short, seed: s1 });
    const b = simulateSpatialMatch(side('h'), side('a'), { ...short, seed: s2 });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  }, 180_000);

  it('accepts a bigint column read back as a numeric string', async () => {
    const row = rowStore('4294967295');
    expect(await resolveMatchSeed('4294967295', row, fixed(5))).toBe(4294967295);
    expect(row.writes).toBe(0);
  });

  it('adopts the value a racing attempt stored first', async () => {
    // Another attempt wrote 123 between our claim (null) and our write.
    const row = rowStore(123);
    expect(await resolveMatchSeed(null, row, fixed(456))).toBe(123);
    expect(row.writes).toBe(0);
  });

  it('refuses to simulate when the seed cannot be stored', async () => {
    const failing: SeedStore = { async persistIfUnset() { throw new Error('db down'); } };
    await expect(resolveMatchSeed(null, failing, fixed(1))).rejects.toThrow('db down');
    const lost: SeedStore = { async persistIfUnset() { return null; } };
    await expect(resolveMatchSeed(null, lost, fixed(1))).rejects.toThrow(/not persisted/);
  });

  it('rejects a corrupt stored seed rather than silently re-rolling', async () => {
    await expect(resolveMatchSeed(-1, rowStore(), fixed(1))).rejects.toThrow(/invalid seed/);
    await expect(resolveMatchSeed('abc', rowStore(), fixed(1))).rejects.toThrow(/invalid seed/);
  });
});
