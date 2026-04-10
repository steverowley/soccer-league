// ── finance/logic/fanBoost.ts ────────────────────────────────────────────────
// WHY: Pure fan support boost calculation. Compares the number of logged-in
// fans for each team and determines who gets a stat bonus. The bonus is
// passed to the match engine's `createAgent()` bonus pool.
//
// DESIGN:
//   - The team with more present fans gets a flat stat bonus.
//   - If fan counts are equal, neither team gets a bonus.
//   - The bonus is small enough to influence close matches without
//     overwhelming base team quality. A 2-point bonus on a 1–99 scale
//     is roughly equivalent to each starter being marginally sharper.
//
// This module is 100% pure — no React, no Supabase, no side effects.

/**
 * Stat bonus applied to each of the 5 stat categories (attacking, defending,
 * mental, athletic, technical) for the team with more fan support.
 *
 * 2 points on a 1–99 scale is subtle but meaningful in close contests.
 * It's roughly the difference between "well-rested" and "tired" in the
 * engine's stat consumption logic.
 */
export const FAN_BOOST_POINTS = 2;

/**
 * Minimum number of minutes a fan must have been "seen" (last_seen_at)
 * before kickoff to count as present. 5 minutes = 300,000 ms.
 *
 * This window is wide enough that a fan who loads the page and watches the
 * pre-match screen counts, but narrow enough that fans who logged in
 * yesterday don't inflate counts.
 */
export const FAN_PRESENCE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Result of a fan boost calculation. Indicates which side (if any) gets the
 * stat bonus and by how much.
 */
export interface FanBoostResult {
  /** Which side gets the boost: 'home', 'away', or 'none'. */
  boostedSide: 'home' | 'away' | 'none';
  /** Stat points added to each of the 5 categories. 0 if no boost. */
  boostAmount: number;
  /** Number of home fans present at kickoff. */
  homeFanCount: number;
  /** Number of away fans present at kickoff. */
  awayFanCount: number;
}

/**
 * Determine which team (if any) gets a fan support boost based on the
 * number of logged-in fans for each side.
 *
 * The team with strictly more fans gets FAN_BOOST_POINTS added to each
 * stat category for all their players during the match. If counts are
 * equal (including 0 vs 0), no boost is applied.
 *
 * @param homeFanCount  Number of fans present for the home team.
 * @param awayFanCount  Number of fans present for the away team.
 * @returns             FanBoostResult with the boosted side and amounts.
 *
 * @example
 *   calculateFanBoost(15, 8)   // → { boostedSide: 'home', boostAmount: 2, ... }
 *   calculateFanBoost(5, 12)   // → { boostedSide: 'away', boostAmount: 2, ... }
 *   calculateFanBoost(10, 10)  // → { boostedSide: 'none', boostAmount: 0, ... }
 */
export function calculateFanBoost(
  homeFanCount: number,
  awayFanCount: number,
): FanBoostResult {
  if (homeFanCount > awayFanCount) {
    return {
      boostedSide: 'home',
      boostAmount: FAN_BOOST_POINTS,
      homeFanCount,
      awayFanCount,
    };
  }
  if (awayFanCount > homeFanCount) {
    return {
      boostedSide: 'away',
      boostAmount: FAN_BOOST_POINTS,
      homeFanCount,
      awayFanCount,
    };
  }
  return {
    boostedSide: 'none',
    boostAmount: 0,
    homeFanCount,
    awayFanCount,
  };
}
