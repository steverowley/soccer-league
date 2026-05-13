// ── finance/logic/applyFanBoost.ts ───────────────────────────────────────────
//
// Pure helper that returns a SHALLOW CLONE of an engine-format team object
// with every player's five stat categories (attacking, defending, mental,
// athletic, technical) increased by `points`.
//
// WHY THIS LIVES NEXT TO calculateFanBoost
//   `fanBoost.ts` decides WHICH side wins the support contest and BY HOW MUCH.
//   This module applies that decision to the engine's team shape.  The split
//   keeps the calculation pure-pure (no team-shape coupling) while still
//   giving every consumer one import to wire fan boosts end to end.
//
// WHY A CLONE RATHER THAN IN-PLACE MUTATION
//   The input team object may be shared with other state (matchState, team
//   detail pages, react-query caches).  Mutating its player array would
//   leak the boost into unrelated views for the rest of the session.
//   createAgent() reads the stats ONCE at construction to pick personalities
//   and penalty ability — boosting BEFORE the clone-and-map call is the
//   only moment the bonus can take effect; after construction, agents cache
//   their own numbers.
//
// WHY +points ON EVERY STAT (not just attacking)
//   Base 1–99 scale: +2 is roughly the delta between "well-rested" and
//   "tired" in the engine's stat consumption.  Subtle but meaningful in
//   close matches — exactly the design goal of fan support (see
//   FAN_BOOST_POINTS).  Applying uniformly preserves the team's tactical
//   shape; it simply sharpens every player.
//
// Non-player fields (stadium, manager, tactics, etc.) are reused by
// reference — they're immutable within a match so sharing them is safe.
//
// HISTORY
//   This helper started life as `applyFanBoostToTeam` in `src/App.jsx`
//   (the legacy client-side match simulator).  It's extracted here so the
//   server-side `scripts/match-worker.ts` pipeline can apply the same boost
//   contract end-to-end through `simulateFullMatch.ts`.

/**
 * Stat-bearing fields on an engine player.  Listed once so future stat
 * additions only need to touch this array (and the defaults table below).
 */
const STAT_FIELDS = ['attacking', 'defending', 'mental', 'athletic', 'technical'] as const;

/**
 * Default fallback for any stat that's `null` / `undefined` on the input
 * player.  70 mirrors `normalizeTeamForEngine()` in `src/lib/supabase.js`
 * so an unseeded player still gets a sensible boosted total (72 instead
 * of `NaN + 2`).
 */
const STAT_FALLBACK = 70;

/**
 * Minimal shape of the team objects passed to the match engine.  We model
 * only the fields this helper touches so callers from both the JS and TS
 * sides can use it without import gymnastics.  No index signature is
 * required — concrete callers (EngineTeam / EnginePlayer) can have any
 * additional fields and they pass through structurally.
 */
export interface FanBoostablePlayer {
  attacking?: number | null;
  defending?: number | null;
  mental?:    number | null;
  athletic?:  number | null;
  technical?: number | null;
}

export interface FanBoostableTeam {
  players?: FanBoostablePlayer[] | undefined;
}

/**
 * Return a shallow clone of `team` with every player's five stat fields
 * increased by `points`.  Zero-point boosts and missing teams pass through
 * by reference so the common "no boost this match" case allocates nothing.
 *
 * The generic is unconstrained because matching against `FanBoostableTeam`
 * would require concrete EngineTeam/EnginePlayer types to declare index
 * signatures.  We accept ANY team-shaped object and let structural typing
 * pick out the stat fields at runtime.  Internally we coerce through
 * `FanBoostableTeam` so the body remains type-safe.
 *
 * @param team   Engine-format team object.
 * @param points Stat points to add to each category. 0 = pass-through.
 * @returns      Either the original team (zero/no-op) or a new team with
 *               a new `players[]` array of boosted player rows.
 */
export function applyFanBoostToTeam<T>(
  team: T,
  points: number,
): T {
  const boostable = team as unknown as FanBoostableTeam;
  // Zero-point boost is the common case (no fans online, or fan counts tied).
  // Fast-path to avoid the array clone so repeated kickoffs with no fans
  // don't allocate a pointless new players[] every match.
  if (!points || !team || !Array.isArray(boostable.players)) return team;

  // Clone-and-map: every player gets a fresh row with each stat field
  // bumped by `points`, defaulting through STAT_FALLBACK so a missing
  // stat doesn't render the boost as NaN.
  const boostedPlayers = boostable.players.map((p) => {
    const next = { ...p } as FanBoostablePlayer;
    for (const field of STAT_FIELDS) {
      next[field] = ((p[field] ?? STAT_FALLBACK) as number) + points;
    }
    return next;
  });

  return { ...(team as object), players: boostedPlayers } as T;
}
