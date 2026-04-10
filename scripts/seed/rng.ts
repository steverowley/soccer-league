// ── rng.ts ───────────────────────────────────────────────────────────────────
// WHY: The seed generator MUST be deterministic — re-running the script with
// the same seed string must produce the exact same 704-player output. We
// cannot rely on Math.random because it is implementation-defined and differs
// between Node versions. Mulberry32 is a tiny, well-understood PRNG with a
// 2^32 period; more than enough for seeding 704 players.
//
// Why not seedrandom or another library? A hand-rolled PRNG is 15 lines, has
// no supply-chain risk, and removes a dev-time dependency for a single use.
// If we ever need better statistical quality we can swap in a library then.
//
// USAGE:
//   const rng = createRng('isl-season-1-v1');
//   const n = rng.int(1, 100);      // 1..100 inclusive
//   const f = rng.float(0, 1);      // [0, 1)
//   const x = rng.pick(['a','b']);  // element from array
//
// CRITICAL: never call Math.random inside any code path reachable from the
// generator. Any non-deterministic call poisons the whole output.

/** Deterministic RNG interface exposed to the seed script. */
export interface SeedRng {
  /** Raw float in [0, 1). */
  float(): number;
  /** Integer in [min, max] (inclusive on both ends). */
  int(min: number, max: number): number;
  /** Pick a single element from a readonly array; throws if empty. */
  pick<T>(arr: readonly T[]): T;
  /** Fisher-Yates shuffle returning a NEW array (never mutates input). */
  shuffle<T>(arr: readonly T[]): T[];
  /** Weighted pick: pass `[['key', weight], ...]`. Heavier = more likely. */
  weightedPick<T>(entries: ReadonlyArray<readonly [T, number]>): T;
}

/**
 * Create a deterministic RNG seeded from a string.
 *
 * The string is hashed into a 32-bit integer via a simple xmur3 variant so
 * that tiny changes in the seed string produce wildly different PRNG streams
 * (good avalanche property). Then we feed that integer to Mulberry32.
 *
 * @param seed  Any string. Change this to regenerate the entire seed output.
 */
export function createRng(seed: string): SeedRng {
  // ── xmur3 string → 32-bit int hash ──────────────────────────────────────
  // Standard hash with decent avalanche — used only to derive the starting
  // state for Mulberry32. Not cryptographic; don't use for anything sensitive.
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }

  // ── Mulberry32 state ────────────────────────────────────────────────────
  // A 32-bit integer; each `float()` advances it by a linear step and mixes
  // with xor-shifts. Period: 2^32 (4.29 billion). Perfectly adequate for a
  // deterministic 704-player seed.
  let state = h >>> 0;

  function float(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function int(min: number, max: number): number {
    // Inclusive on both ends. Matches the familiar dice-roll semantics used
    // elsewhere in the engine (rndI in src/shared/utils/random.ts).
    return Math.floor(float() * (max - min + 1)) + min;
  }

  function pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) {
      throw new Error('pick() called with empty array — check your name pools.');
    }
    // Non-null assertion is safe: we just verified length > 0.
    return arr[Math.floor(float() * arr.length)]!;
  }

  function shuffle<T>(arr: readonly T[]): T[] {
    const out = arr.slice();
    // Classic Fisher-Yates from the high index down. Using our seeded float()
    // (NOT Math.random) is the whole reason we wrap shuffle here at all.
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(float() * (i + 1));
      const tmp = out[i]!;
      out[i] = out[j]!;
      out[j] = tmp;
    }
    return out;
  }

  function weightedPick<T>(entries: ReadonlyArray<readonly [T, number]>): T {
    if (entries.length === 0) {
      throw new Error('weightedPick() called with empty entries.');
    }
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    if (total <= 0) {
      throw new Error('weightedPick() total weight must be > 0.');
    }
    let roll = float() * total;
    for (const [value, weight] of entries) {
      roll -= weight;
      if (roll < 0) return value;
    }
    // Floating-point epsilon guard: if we somehow didn't return above
    // (because roll started at exactly total), fall through to the last item.
    return entries[entries.length - 1]![0];
  }

  return { float, int, pick, shuffle, weightedPick };
}
