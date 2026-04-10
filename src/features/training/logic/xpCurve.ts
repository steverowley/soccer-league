// ── training/logic/xpCurve.ts ────────────────────────────────────────────────
// WHY: Pure XP-to-stat-bump conversion. Given a player's previous total XP
// and an incoming click, this module decides (a) whether the click crossed a
// threshold, (b) which stat got bumped, and (c) how much total XP is now
// accumulated. No React, no Supabase, no randomness — a deterministic
// function so we can unit-test every edge case.
//
// DESIGN CONTRAINTS:
//   - Stat bumps must feel *earned*. A fan who clicks 200 times should see
//     visible progress; a fan who clicks 5 times should not.
//   - Bumps must be *small enough* that no single fan can unilaterally
//     transform a player. The community effect is the game, not the grind.
//   - The curve must slow down as a player accumulates bumps, so legendary
//     players aren't just whoever got clicked the most in week one.
//   - Deterministic: same inputs → same outputs. The round-robin stat
//     rotation means bumps distribute across all 5 stats evenly over time,
//     never concentrating on a single column.
//
// HOW THE CURVE WORKS:
//   - Each click adds `XP_PER_CLICK` to the player's cumulative XP.
//   - The Nth stat bump is awarded when cumulative XP crosses
//     `xpRequiredForBump(N)`. The curve is super-linear: bump #1 costs
//     BASE_XP_COST, bump #2 costs BASE_XP_COST * CURVE_MULTIPLIER, etc.
//   - When a bump is awarded, the stat bumped is determined by
//     (bumpNumber - 1) mod 5 against the STAT_ROTATION array. This gives a
//     fair round-robin rotation across all 5 core stats.
//
// TUNING NOTE: these numbers were chosen to make the first bump feel quick
// (10 clicks) but the 10th bump feel like real commitment (~150 clicks). If
// playtesting shows the curve is wrong, change the constants — don't change
// the shape of the function.

import type { TrainingStat, ClickResult } from '../types';

// ── Tuning constants ────────────────────────────────────────────────────────

/**
 * XP added per click. A flat rate keeps the mental model simple: one click
 * = one unit of effort. Future phases may add multipliers for combos,
 * Architect interference, or critical hits — when that happens, this
 * constant becomes a ceiling rather than a truth, and the API layer is
 * responsible for computing the actual amount.
 */
export const XP_PER_CLICK = 10;

/**
 * XP required to trigger the FIRST stat bump. Set so ~10 clicks → first
 * visible reward; fast enough that first-time players feel the loop
 * instantly, slow enough that it isn't a freebie.
 */
export const BASE_XP_COST = 100;

/**
 * Multiplier applied to BASE_XP_COST for each subsequent bump. A value of
 * 1.5 gives a gentle super-linear curve:
 *   bump 1 → 100 XP (10 clicks)
 *   bump 2 → 150 XP cumulative from bump 1 → 250 total
 *   bump 3 → 225 XP cumulative → 475 total
 *   bump 10 → ~3,844 total XP (~385 clicks)
 * This prevents early-week click-farms from dominating late-season rosters
 * while still rewarding sustained engagement.
 */
export const CURVE_MULTIPLIER = 1.5;

/**
 * Round-robin stat rotation. The Nth bump (0-indexed) touches
 * STAT_ROTATION[N mod 5]. Order is attacking → defending → mental →
 * athletic → technical so goalscoring gets the very first bump (fans like
 * scoring goals) and technical comes last (hardest to see in a match).
 *
 * IMPORTANT: the order here is a *design choice*, not an implementation
 * detail. Changing it reshuffles every player's stat history.
 */
export const STAT_ROTATION: readonly TrainingStat[] = [
  'attacking',
  'defending',
  'mental',
  'athletic',
  'technical',
] as const;

// ── Pure curve helpers ──────────────────────────────────────────────────────

/**
 * Cumulative XP required to reach the Nth stat bump (1-indexed). Uses a
 * geometric series so bumps get progressively more expensive.
 *
 * The formula is:
 *   sum_{i=0}^{N-1} BASE_XP_COST * CURVE_MULTIPLIER^i
 *   = BASE_XP_COST * (CURVE_MULTIPLIER^N - 1) / (CURVE_MULTIPLIER - 1)
 *
 * Returns 0 for N = 0 (no bumps yet) and Infinity for negative N (guards
 * against programmer errors rather than producing nonsense thresholds).
 *
 * @param bumpCount  The bump number to compute the threshold for. 1 = the
 *                   first bump, 2 = the second, etc.
 * @returns          Cumulative XP required to earn `bumpCount` bumps.
 */
export function xpRequiredForBump(bumpCount: number): number {
  if (bumpCount <= 0) return 0;
  if (!Number.isFinite(bumpCount)) return Infinity;
  // Geometric series closed form. Using Math.pow explicitly for clarity.
  const numerator = Math.pow(CURVE_MULTIPLIER, bumpCount) - 1;
  const denominator = CURVE_MULTIPLIER - 1;
  return Math.ceil(BASE_XP_COST * (numerator / denominator));
}

/**
 * Given a cumulative XP total, returns the number of stat bumps earned so
 * far. This is the inverse of `xpRequiredForBump` — we walk forward from
 * zero, counting thresholds crossed, rather than solving the log directly
 * (the loop is cheap and the closed form introduces floating-point drift
 * at the threshold boundaries where it matters most).
 *
 * @param totalXp  The player's lifetime XP.
 * @returns        Number of stat bumps earned at this XP level.
 */
export function bumpsEarned(totalXp: number): number {
  if (totalXp <= 0 || !Number.isFinite(totalXp)) return 0;
  let count = 0;
  // Walk the thresholds in order until we exceed the player's XP. The loop
  // terminates quickly because the curve is super-linear.
  while (xpRequiredForBump(count + 1) <= totalXp) {
    count += 1;
    // Safety rail: prevent runaway loops if tuning constants are misused.
    // 10,000 bumps is ~1.5 billion XP (150M clicks), far beyond any
    // realistic total.
    if (count > 10_000) break;
  }
  return count;
}

/**
 * Which stat gets bumped for the Nth bump (1-indexed)? Round-robin across
 * STAT_ROTATION so every player's training history is balanced.
 *
 * @param bumpNumber  1-indexed bump number (the 1st, 2nd, 3rd bump, …).
 * @returns           The stat touched by this bump, or null for invalid input.
 */
export function statForBump(bumpNumber: number): TrainingStat | null {
  if (bumpNumber <= 0 || !Number.isFinite(bumpNumber)) return null;
  const index = (Math.floor(bumpNumber) - 1) % STAT_ROTATION.length;
  return STAT_ROTATION[index] ?? null;
}

// ── Click application ──────────────────────────────────────────────────────

/**
 * Apply a single click to a player's lifetime XP and determine whether the
 * click crossed a threshold. This is THE function the UI/API layer calls —
 * everything else in this module is a helper for it.
 *
 * Edge cases:
 *   - A click that lands exactly on a threshold (newTotal === threshold)
 *     counts as crossing it. This is deliberate: it makes the "next bump
 *     in X clicks" UI hint feel accurate.
 *   - A click can cross AT MOST one threshold per call. Even if XP_PER_CLICK
 *     were raised high enough to skip multiple thresholds, we only award
 *     one bump per click — bumps must feel tied to clicks, not math.
 *   - If `previousTotalXp` is negative or NaN, it's clamped to 0 (defensive,
 *     shouldn't happen in practice since the DB CHECK enforces xp_added > 0).
 *
 * @param previousTotalXp  Cumulative XP before this click.
 * @param xpAdded          XP added by this click (usually XP_PER_CLICK).
 * @returns                ClickResult with new total, stat bumped (or null),
 *                         and updated total bump count.
 */
export function applyClick(
  previousTotalXp: number,
  xpAdded: number = XP_PER_CLICK,
): ClickResult {
  // Clamp against pathological inputs so downstream math is safe.
  const safePrev = Number.isFinite(previousTotalXp) && previousTotalXp > 0
    ? previousTotalXp
    : 0;
  const safeAdded = Number.isFinite(xpAdded) && xpAdded > 0 ? xpAdded : 0;

  const newTotalXp = safePrev + safeAdded;

  // How many bumps did we have before vs. after? The difference (at most 1,
  // clamped) is whether this click bumped a stat.
  const bumpsBefore = bumpsEarned(safePrev);
  const bumpsAfter = bumpsEarned(newTotalXp);

  // A click awards at most one bump even if xpAdded somehow crosses
  // multiple thresholds. See the edge-case note in the JSDoc above.
  const bumpAwarded = bumpsAfter > bumpsBefore;
  const nextBumpNumber = bumpsBefore + 1;

  return {
    newTotalXp,
    statBumped: bumpAwarded ? statForBump(nextBumpNumber) : null,
    totalBumps: bumpAwarded ? bumpsBefore + 1 : bumpsBefore,
  };
}

/**
 * Compute how much XP a player needs before their next stat bump. Used by
 * the UI to render progress bars ("45/100 XP to next bump").
 *
 * @param totalXp  The player's current lifetime XP.
 * @returns        XP remaining until the next bump, or 0 if a bump is
 *                 already pending (i.e. totalXp exactly equals a threshold).
 */
export function xpUntilNextBump(totalXp: number): number {
  const safe = Number.isFinite(totalXp) && totalXp > 0 ? totalXp : 0;
  const currentBumps = bumpsEarned(safe);
  const nextThreshold = xpRequiredForBump(currentBumps + 1);
  return Math.max(0, nextThreshold - safe);
}
