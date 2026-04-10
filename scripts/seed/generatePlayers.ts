// ── generatePlayers.ts ───────────────────────────────────────────────────────
// WHY THIS FILE EXISTS:
//   The Phase 0.5 task is to expand rosters from 16 players per team to 22,
//   matching the ISL game design document's "22-25 players per club" spec.
//   Doing that by hand would be tedious, non-deterministic, and would scatter
//   the balancing assumptions (what makes a 'starter' vs 'bench' player,
//   what rating spread is healthy, how ages are distributed) across thousands
//   of hand-typed SQL rows.
//
//   This module centralises ALL of those assumptions in one typed,
//   unit-testable place. The output is a plain-data array of GeneratedPlayer
//   rows; the SQL emitter (emitSql.ts) is a thin layer on top.
//
// CRITICAL INVARIANTS (do not violate without updating gameEngine.js):
//   1. Every team MUST have at least 1 GK starter and 1 GK bench. The match
//      engine expects a GK substitute available for red-card replacements.
//   2. Starter count MUST be exactly 11 (1 GK + 4 DF + 3 MF + 3 FW). The
//      engine builds a lineup from the `starter = true` rows directly.
//   3. overall_rating MUST stay within [65, 90]. Values outside that range
//      break the contest roll calibrations in resolveContest().
//   4. Name uniqueness WITHIN a team is enforced by the generator — two
//      players on the same roster with identical names would produce broken
//      match feed strings ("Nova shoots. Nova shoots again.").
//
// DETERMINISM:
//   The generator takes a SeedRng (Mulberry32-backed). Given the same seed
//   string, re-running the generator produces byte-identical output. Any
//   call to Math.random inside this file is a BUG.
//
// ROSTER SHAPE (22 players per team — Phase 0.5 expansion):
//   Starters (11): 1 GK, 4 DF, 3 MF, 3 FW   — `starter = true`
//   Bench    (11): 2 GK, 4 DF, 3 MF, 2 FW   — `starter = false`
//
//   Two GK bench is intentional: red-card GK replacement + injury cover. The
//   old 16-player seed only had 1 bench GK which made red cards dangerous.
//
//   Bench counts lean slightly DF-heavy (4 vs 3 MF / 2 FW) because forwards
//   are the most "fungible" position — a sub FW can be substituted for a
//   winger, but a sub DF cannot cover for a CB shortage.

import type { SeedRng } from './rng';
import { SHARED_SURNAMES, type TeamDef } from './teamData';

// ── Public types ────────────────────────────────────────────────────────────

/**
 * Position codes used by the match engine. MUST match the CHECK constraint
 * on `players.position` in supabase/schema.sql (GK/DF/MF/FW only). Adding a
 * new position requires a coordinated schema migration.
 */
export type Position = 'GK' | 'DF' | 'MF' | 'FW';

/**
 * Personality archetype — determines how a player reacts under pressure,
 * their contest bonus profile, and their commentary hooks. Weights below
 * are tuned to match the approximate distribution in the hand-written
 * 512-player seed, so the expansion to 704 doesn't shift league meta.
 *
 * See src/gameEngine.js `createAgent()` for how each archetype modifies
 * bonus pools in `resolveContest()`.
 */
export type Personality =
  | 'balanced'     // neutral baseline, ~30% of players
  | 'aggressive'   // +attack bonus, +foul risk
  | 'creative'     // +chance creation, -defensive work rate
  | 'team_player'  // +assist bonus, -shot attempts
  | 'workhorse'    // +stamina, +pressing, -technical flair
  | 'selfish'      // +shot attempts, -assist rate
  | 'cautious'     // GK-leaning; -attacking
  | 'lazy';        // bench flavour; -stamina

/**
 * A generated player row — the shape fed into the SQL emitter. Stat columns
 * (attacking/defending/etc.) are NOT emitted here because seed.sql derives
 * them from overall_rating + position in a post-INSERT UPDATE block; see
 * the `-- PLAYER SIMULATION STATS` section of emitSql.ts for the exact
 * formulas we preserve verbatim.
 */
export interface GeneratedPlayer {
  teamId: string;
  name: string;
  position: Position;
  nationality: string;
  age: number;
  overallRating: number;
  personality: Personality;
  starter: boolean;
}

// ── Generator tuning constants ──────────────────────────────────────────────
// All magic numbers that drive roster balance live here so a single edit
// ripples through every team's output. Comment each one with WHY the value
// is what it is — not just the what.

/**
 * Starter position distribution (sums to 11). Matches a flexible 4-3-3
 * preference which is the default formation in src/gameEngine.js's
 * manager tactics defaults; the match engine can reshape this into 4-4-2
 * or 4-5-1 via bench swaps so we don't need more than one canonical shape
 * at seed time.
 */
const STARTER_SHAPE: Readonly<Record<Position, number>> = {
  GK: 1,
  DF: 4,
  MF: 3,
  FW: 3,
};

/**
 * Bench position distribution (sums to 11 for Phase 0.5's 22-player squads).
 * Two GK bench is required for red-card coverage; see file-level invariant 1.
 */
const BENCH_SHAPE: Readonly<Record<Position, number>> = {
  GK: 2,
  DF: 4,
  MF: 3,
  FW: 2,
};

/**
 * Starter overall_rating range. Top end is capped at 90 because values >90
 * in resolveContest() produce runaway dominance — a single 95-rated striker
 * can score 4+ goals per match against average defences, breaking odds
 * calibration downstream in the betting system (Phase 2).
 *
 * Bottom end (75) ensures even the worst starter on the worst team is still
 * clearly a tier above bench players — otherwise the game's "starter means
 * something" signal gets lost.
 */
const STARTER_RATING_MIN = 75;
const STARTER_RATING_MAX = 90;

/**
 * Bench overall_rating range. Upper bound (78) overlaps slightly with the
 * starter minimum (75) so that there's a small "fringe starter" zone that
 * the Phase 4 voting system ("promote youth", "sign a new player") can
 * realistically shift between starter and bench rows without needing to
 * rewrite the rating itself.
 */
const BENCH_RATING_MIN = 65;
const BENCH_RATING_MAX = 78;

/**
 * Age distribution tunings.
 *
 * STARTER_AGE_MIN/MAX: established pros. 20-year-old starter is the youngest
 * realistic regular; 34 is the oldest before stamina decay dominates under
 * the engine's athletic stat formula.
 *
 * BENCH_AGE_DISTRIBUTION: mix of youth prospects (18-21), fringe pros
 * (22-28), and veteran squad players (30-36). Weights are tuned so every
 * team has at least one teenager for academy narrative hooks (Phase 4
 * "promote youth" focus) AND at least one veteran for "retiring legend"
 * arcs that the Architect can weave into commentary.
 */
const STARTER_AGE_MIN = 20;
const STARTER_AGE_MAX = 34;

/** Bench age buckets with weights. Values are picked via rng.weightedPick. */
const BENCH_AGE_BUCKETS: ReadonlyArray<readonly [readonly [number, number], number]> = [
  [[18, 21], 4],  // youth prospects — heaviest weight so every team has ≥1
  [[22, 28], 3],  // fringe pros in their prime
  [[29, 33], 2],  // squad veterans
  [[34, 36], 1],  // cameo elders — rare, for narrative flavour
];

/**
 * Personality weights by position. Forwards trend selfish/creative; defenders
 * trend aggressive/workhorse; GKs trend cautious. These match the hand-tuned
 * distribution of the 512-player seed so Phase 0.5 doesn't shift the feel
 * of commentary — archetype frequencies determine how often you hear certain
 * commentary lines (e.g. "workhorse" tropes).
 */
const PERSONALITY_BY_POSITION: Readonly<
  Record<Position, ReadonlyArray<readonly [Personality, number]>>
> = {
  GK: [
    ['balanced', 5],
    ['cautious', 4],
    ['team_player', 2],
    ['workhorse', 1],
  ],
  DF: [
    ['aggressive', 4],
    ['balanced', 4],
    ['team_player', 3],
    ['workhorse', 3],
    ['lazy', 1],
  ],
  MF: [
    ['creative', 4],
    ['balanced', 4],
    ['team_player', 3],
    ['workhorse', 2],
    ['lazy', 1],
  ],
  FW: [
    ['selfish', 4],
    ['balanced', 3],
    ['aggressive', 3],
    ['workhorse', 2],
    ['team_player', 2],
  ],
};

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Pick a first name from the team's theme pool, ensuring uniqueness within
 * the team. If the pool is exhausted (which only happens on unusually small
 * theme pools or very large rosters), we suffix with a digit until a unique
 * combination is found — this is deterministic because we walk the suffix
 * space in a fixed order.
 *
 * WHY uniqueness matters: two "Nova Hashimoto" players on the same team
 * produce garbled match commentary ("Nova Hashimoto passes to Nova
 * Hashimoto"). Cross-team duplicates are fine and expected — "Nova" is a
 * common themed name across multiple inner-planet clubs.
 *
 * @param rng          Seeded RNG so the generator stays deterministic.
 * @param themePool    First-name pool for this team (nationality themed).
 * @param usedOnTeam   Set of names already assigned to this team; mutated.
 * @returns            A unique "First Last" full name for one player.
 */
function pickUniqueName(
  rng: SeedRng,
  themePool: readonly string[],
  usedOnTeam: Set<string>,
): string {
  // First try: pick a first name + surname and hope it's unique on the team.
  // With ~18 theme names × 60 surnames = 1080 combinations, the first few
  // tries almost always succeed.
  for (let attempt = 0; attempt < 20; attempt++) {
    const first = rng.pick(themePool);
    const last = rng.pick(SHARED_SURNAMES);
    const candidate = `${first} ${last}`;
    if (!usedOnTeam.has(candidate)) {
      usedOnTeam.add(candidate);
      return candidate;
    }
  }
  // Fallback: add a numeric suffix to the next random pick. This is
  // deterministic because rng advances the same way on every run; we'll
  // only ever land here if the pool is genuinely exhausted, which should
  // never happen for 22-player squads but is defended against so the
  // generator can't infinite-loop.
  for (let suffix = 2; suffix < 99; suffix++) {
    const first = rng.pick(themePool);
    const last = rng.pick(SHARED_SURNAMES);
    const candidate = `${first} ${last} ${suffix}`;
    if (!usedOnTeam.has(candidate)) {
      usedOnTeam.add(candidate);
      return candidate;
    }
  }
  throw new Error('pickUniqueName: name pool exhausted — expand SHARED_SURNAMES or team themePool.');
}

/**
 * Distribute overall_rating values across an ordered list of players so the
 * best players on a team get the highest ratings. Uses a linear spread from
 * `max` down to `min` across the count, with a small RNG jitter (±1) so the
 * output doesn't look mechanical.
 *
 * Linear (rather than normal-distributed) is intentional: it guarantees the
 * top starter of every team is at or near the max, which matches the feel
 * of the hand-written seed where every team has at least one "star".
 *
 * @param rng    Seeded RNG (jitter source).
 * @param count  How many ratings to produce.
 * @param min    Lowest rating in the distribution (inclusive).
 * @param max    Highest rating in the distribution (inclusive).
 * @returns      Array of `count` integers in [min-1, max+1], highest first.
 */
function distributeRatings(rng: SeedRng, count: number, min: number, max: number): number[] {
  const out: number[] = [];
  // Edge case: if count is 1, return a value near the top of the range —
  // tiny rosters shouldn't land on the mean.
  if (count === 1) {
    return [max - rng.int(0, 2)];
  }
  // Linear step from max down to min. Math.max guards against count=1 (handled
  // above) but kept here for future-proofing if STARTER_SHAPE totals change.
  const step = (max - min) / Math.max(1, count - 1);
  for (let i = 0; i < count; i++) {
    // Perfectly linear target value, then jitter by ±1 to break the grid.
    // Clamp to [min, max] after jitter so the top/bottom never exceed bounds.
    const linear = max - step * i;
    const jitter = rng.int(-1, 1);
    const rating = Math.max(min, Math.min(max, Math.round(linear + jitter)));
    out.push(rating);
  }
  return out;
}

/**
 * Pick an age for a starter — uniform-ish in [STARTER_AGE_MIN, STARTER_AGE_MAX]
 * but with a slight bias toward the 23-27 "prime" range, because too many
 * teenage regulars makes the league feel youth-league; too many 33-year-olds
 * makes commentary lean "retirement watch" constantly.
 */
function pickStarterAge(rng: SeedRng): number {
  // 70% chance: prime window 22-29.  30% chance: full range 20-34.
  // The prime window is hand-tuned to match what a realistic first-team squad
  // looks like across major world leagues — most starters are mid-20s.
  if (rng.float() < 0.7) {
    return rng.int(22, 29);
  }
  return rng.int(STARTER_AGE_MIN, STARTER_AGE_MAX);
}

/**
 * Pick an age for a bench player using BENCH_AGE_BUCKETS weighted distribution.
 */
function pickBenchAge(rng: SeedRng): number {
  const [minAge, maxAge] = rng.weightedPick(BENCH_AGE_BUCKETS);
  return rng.int(minAge, maxAge);
}

/**
 * Generate the full 22-player roster for a single team. Internal helper;
 * the public entry point is `generateAllPlayers` below.
 */
function generateTeamRoster(rng: SeedRng, team: TeamDef): GeneratedPlayer[] {
  const players: GeneratedPlayer[] = [];
  const usedNames = new Set<string>();

  // ── Build the starter list (11 players, highest-rated first) ─────────────
  // We interleave positions in the order GK → DF → MF → FW so that when the
  // rating distribution is applied, the top-rated starter is almost always
  // a DF or MF (rather than always a GK), matching the "best player on the
  // team is a striker or playmaker" expectation.
  const starterPositionOrder: Position[] = [];
  // Build the position list by flattening STARTER_SHAPE. Order matters for
  // rating distribution so this explicit loop is clearer than Object.entries.
  for (const pos of ['GK', 'DF', 'MF', 'FW'] as const) {
    for (let i = 0; i < STARTER_SHAPE[pos]; i++) {
      starterPositionOrder.push(pos);
    }
  }
  // Shuffle within position groups so the top-rated starter isn't always a GK.
  // We want the best player spread across outfield positions, so we just
  // shuffle the whole list and trust the distributeRatings call below to
  // apply a "best player gets highest rating" ordering to the SHUFFLED list.
  const shuffledStarters = rng.shuffle(starterPositionOrder);

  const starterRatings = distributeRatings(
    rng,
    STARTER_SHAPE.GK + STARTER_SHAPE.DF + STARTER_SHAPE.MF + STARTER_SHAPE.FW,
    STARTER_RATING_MIN,
    STARTER_RATING_MAX,
  );

  for (let i = 0; i < shuffledStarters.length; i++) {
    const pos = shuffledStarters[i]!;
    const name = pickUniqueName(rng, team.themePool, usedNames);
    players.push({
      teamId: team.id,
      name,
      position: pos,
      nationality: team.nationality,
      age: pickStarterAge(rng),
      overallRating: starterRatings[i]!,
      personality: rng.weightedPick(PERSONALITY_BY_POSITION[pos]),
      starter: true,
    });
  }

  // ── Build the bench list (11 players, Phase 0.5 expansion) ──────────────
  const benchPositionOrder: Position[] = [];
  for (const pos of ['GK', 'DF', 'MF', 'FW'] as const) {
    for (let i = 0; i < BENCH_SHAPE[pos]; i++) {
      benchPositionOrder.push(pos);
    }
  }
  const shuffledBench = rng.shuffle(benchPositionOrder);

  const benchRatings = distributeRatings(
    rng,
    BENCH_SHAPE.GK + BENCH_SHAPE.DF + BENCH_SHAPE.MF + BENCH_SHAPE.FW,
    BENCH_RATING_MIN,
    BENCH_RATING_MAX,
  );

  for (let i = 0; i < shuffledBench.length; i++) {
    const pos = shuffledBench[i]!;
    const name = pickUniqueName(rng, team.themePool, usedNames);
    players.push({
      teamId: team.id,
      name,
      position: pos,
      nationality: team.nationality,
      age: pickBenchAge(rng),
      overallRating: benchRatings[i]!,
      personality: rng.weightedPick(PERSONALITY_BY_POSITION[pos]),
      starter: false,
    });
  }

  return players;
}

/**
 * Top-level entry: generate every player for every team in `teams`, in the
 * order the teams appear in the input array. Output is one flat array that
 * the SQL emitter walks sequentially to produce `INSERT INTO players (...)`
 * rows with a `-- <team_id>` section marker between teams.
 *
 * The function is a pure transform — no I/O, no Supabase, no console output.
 * All randomness flows through the `rng` parameter so unit tests can inject
 * a spy RNG and assert on specific outputs.
 *
 * @param rng    Seeded RNG (must be deterministic — never pass a Math.random wrapper).
 * @param teams  Ordered array of teams to generate rosters for. Order is preserved.
 * @returns      Flat array of 22 × teams.length GeneratedPlayer rows.
 */
export function generateAllPlayers(
  rng: SeedRng,
  teams: readonly TeamDef[],
): GeneratedPlayer[] {
  const all: GeneratedPlayer[] = [];
  for (const team of teams) {
    all.push(...generateTeamRoster(rng, team));
  }
  return all;
}

/**
 * Total players per team — exported so the SQL emitter and unit tests can
 * cross-check the generator output without hard-coding 22 everywhere. If
 * this number ever changes, update the WHY comments at the top of this file.
 */
export const PLAYERS_PER_TEAM: number =
  STARTER_SHAPE.GK + STARTER_SHAPE.DF + STARTER_SHAPE.MF + STARTER_SHAPE.FW +
  BENCH_SHAPE.GK + BENCH_SHAPE.DF + BENCH_SHAPE.MF + BENCH_SHAPE.FW;
