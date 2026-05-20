// ── applyFanBoost.ts ───────────────────────────────────────────────────────
// Apply fan-support stat boosts to a team's players before match simulation.
// When a team has more logged-in fans, every player gets +2 to each stat
// category, improving their contest rolls throughout the match.

/**
 * Stat-bearing fields on an engine player that can receive a boost.
 * These five categories cover all contest-affecting stats in the engine.
 */
const STAT_FIELDS = ['attacking', 'defending', 'mental', 'athletic', 'technical'] as const;

/**
 * Fallback stat value when a player's stat is null or undefined.
 * Mirrors the 70-point baseline in normalizeTeamForEngine so unseeded
 * players don't suffer NaN after boosting.
 */
const STAT_FALLBACK = 70;

export interface FanBoostablePlayer {
  attacking?: number | null;
  defending?: number | null;
  mental?: number | null;
  athletic?: number | null;
  technical?: number | null;
}

export interface FanBoostableTeam {
  players?: FanBoostablePlayer[] | undefined;
}

/**
 * Return a shallow clone of `team` with every player's stat fields
 * increased by `points`.  When `points` is 0 or the team has no players,
 * the original team is returned by reference (no allocation).
 *
 * The boost applies BEFORE match simulation so each player's agent is
 * constructed with the boosted stat values, affecting personality selection,
 * contest bonuses, and penalty-kick ability throughout the match.
 *
 * @param team   Engine-format team object.
 * @param points Stat points to add to each category (0 = no-op pass-through).
 * @returns      Either the original team (zero points) or a new team with
 *               boosted player stats.
 */
export function applyFanBoostToTeam<T>(team: T, points: number): T {
  const boostable = team as unknown as FanBoostableTeam;

  // Fast-path: zero-point boost is the common case (no fans, tied counts, etc.).
  // Avoid allocating a new players[] when nothing changes.
  if (!points || !team || !Array.isArray(boostable.players)) {
    return team;
  }

  // Clone-and-map: each player gets a fresh row with boosted stats.
  // Default through STAT_FALLBACK so missing stats don't become NaN.
  const boostedPlayers = boostable.players.map((p) => {
    const next = { ...p } as FanBoostablePlayer;
    for (const field of STAT_FIELDS) {
      next[field] = ((p[field] ?? STAT_FALLBACK) as number) + points;
    }
    return next;
  });

  return { ...(team as object), players: boostedPlayers } as T;
}
