// ── betting/logic/odds.ts ────────────────────────────────────────────────────
// WHY: Pure odds calculation — no React, no Supabase. Takes pre-fetched team
// stats and produces decimal odds with house margin. The API layer calls
// normalizeTeamForEngine() to gather stats, then feeds them here.
//
// MODEL OVERVIEW:
//   1. Each team's "power" is its average rating across 5 stat categories
//      (attacking, defending, mental, athletic, technical) for starters.
//   2. A logistic sigmoid converts the power difference into a raw home-win
//      probability, with a small home-advantage boost.
//   3. Draw probability is highest when teams are evenly matched, and decays
//      as the power gap widens — mimicking real football statistics.
//   4. Recent form (last 5 matches) shifts probabilities ±2% per result.
//   5. A 5% house margin (overround) is applied to all odds so the Bookie
//      entity ("Galactic Sportsbook") accrues balance over time.
//
// All constants are annotated with their mechanical effect so future tuning
// is easy. The entire module is 100% unit-testable with no side effects.

import type {
  TeamOddsInput,
  MatchProbabilities,
  ComputedOdds,
} from '../types';

// ── Tuning constants ────────────────────────────────────────────────────────

/**
 * Home advantage expressed as equivalent rating points. A team playing at
 * home is treated as if their average rating is this many points higher.
 *
 * 4 points on a 1–99 scale is subtle — roughly the difference between
 * "slightly better at home" without making away wins rare.
 */
const HOME_ADVANTAGE = 4;

/**
 * Logistic scale factor. Controls how sensitive the win probability is to
 * rating differences. Higher values flatten the curve (less extreme odds);
 * lower values steepen it.
 *
 * At scale=30, a 10-point rating gap produces roughly 60/40 odds. At 20
 * points, roughly 73/27. This prevents extreme blowout odds while still
 * rewarding clearly superior teams.
 */
const LOGISTIC_SCALE = 30;

/**
 * Base draw probability when teams are exactly equal. Real-world football
 * has ~25% draws across top leagues. This value is the peak — actual draw
 * probability decays as the rating gap increases.
 */
const BASE_DRAW_PROB = 0.25;

/**
 * Gaussian decay rate for draw probability as the rating gap increases.
 * Higher values make draw probability drop faster with unequal teams.
 *
 * At 0.003, a 10-point gap reduces draw probability by ~26% (from 0.25 to
 * ~0.185). A 20-point gap drops it to ~0.075.
 */
const DRAW_DECAY = 0.003;

/**
 * Minimum draw probability floor. Even wildly mismatched teams can still
 * draw occasionally. 5% matches roughly the lowest real-world frequencies.
 */
const MIN_DRAW_PROB = 0.05;

/**
 * Form modifier per net result point. Each win adds +1, each loss adds -1
 * to the form score. The total is multiplied by this value to shift the
 * team's effective rating.
 *
 * At 1.5 points/result, a team on a 5-win streak gets +7.5 effective
 * rating — roughly half a tier's worth of advantage. This makes form
 * meaningful without overwhelming base quality.
 */
const FORM_RATING_SHIFT = 1.5;

/**
 * House margin (overround) applied to all odds. 0.05 = 5%.
 *
 * The sum of implied probabilities (1/odds) across all three outcomes will
 * be 1.05 instead of 1.00. This means the Bookie entity profits ~5% on
 * average regardless of outcomes — matching typical real-world bookmaker
 * margins for football.
 */
export const HOUSE_MARGIN = 0.05;

/**
 * Number of recent matches used for form calculation. 5 is standard across
 * most football analytics — enough to detect trends without being noisy.
 */
export const FORM_WINDOW = 5;

// ── Core calculation functions ──────────────────────────────────────────────

/**
 * Compute the form-adjusted effective rating for a team. The raw average
 * rating is shifted by recent form: each net win adds FORM_RATING_SHIFT
 * to the effective rating.
 *
 * @param input  Team stats with avgRating and form record.
 * @returns      Form-adjusted effective rating.
 *
 * @example
 *   effectiveRating({ avgRating: 78, form: { wins: 3, draws: 1, losses: 1 } })
 *   // → 78 + (3 - 1) × 1.5 = 81
 */
export function effectiveRating(input: TeamOddsInput): number {
  const formScore = input.form.wins - input.form.losses;
  return input.avgRating + formScore * FORM_RATING_SHIFT;
}

/**
 * Compute raw match probabilities from two teams' odds inputs. Uses a
 * logistic sigmoid for win probability and a Gaussian decay for draw
 * probability.
 *
 * The three probabilities always sum to 1.0 (within floating-point
 * precision). This is the "true" probability before house margin.
 *
 * @param home  Home team stats.
 * @param away  Away team stats.
 * @returns     { home, draw, away } probabilities summing to 1.0.
 */
export function computeProbabilities(
  home: TeamOddsInput,
  away: TeamOddsInput,
): MatchProbabilities {
  const homeRating = effectiveRating(home);
  const awayRating = effectiveRating(away);
  const diff = homeRating - awayRating;

  // ── Logistic sigmoid for raw home-win probability ─────────────────────
  // The HOME_ADVANTAGE term shifts the curve in favour of the home team.
  const rawHomeProb = 1 / (1 + Math.exp(-(diff + HOME_ADVANTAGE) / LOGISTIC_SCALE));

  // ── Draw probability: Gaussian decay from base ────────────────────────
  // Peaks at BASE_DRAW_PROB when diff=0, decays as teams diverge.
  const drawProb = Math.max(
    MIN_DRAW_PROB,
    BASE_DRAW_PROB * Math.exp(-DRAW_DECAY * diff * diff),
  );

  // ── Distribute remaining probability between home and away ────────────
  const remaining = 1 - drawProb;
  const homeProb = remaining * rawHomeProb;
  const awayProb = remaining * (1 - rawHomeProb);

  return { home: homeProb, draw: drawProb, away: awayProb };
}

/**
 * Convert true probabilities to decimal odds with house margin applied.
 *
 * Decimal odds represent total return per unit staked. For example, odds of
 * 2.50 mean a 100-credit bet returns 250 credits (150 profit + 100 stake).
 *
 * The house margin inflates implied probabilities so they sum to > 1.0
 * (the "overround"). This guarantees the Bookie profits on average.
 *
 * @param probs  True match probabilities (summing to 1.0).
 * @returns      Decimal odds for home, draw, away (all > 1.0).
 *
 * @example
 *   probsToOdds({ home: 0.5, draw: 0.25, away: 0.25 })
 *   // With 5% margin: homeOdds ≈ 1.905, drawOdds ≈ 3.810, awayOdds ≈ 3.810
 */
export function probsToOdds(probs: MatchProbabilities): ComputedOdds {
  const overround = 1 + HOUSE_MARGIN;
  return {
    homeOdds: roundOdds(1 / (probs.home * overround)),
    drawOdds: roundOdds(1 / (probs.draw * overround)),
    awayOdds: roundOdds(1 / (probs.away * overround)),
  };
}

/**
 * Full pipeline: compute odds for a match from team stats. Combines
 * probability calculation and odds conversion in one call.
 *
 * @param home  Home team stats (avgRating + form).
 * @param away  Away team stats (avgRating + form).
 * @returns     Decimal odds with house margin applied.
 */
export function computeMatchOdds(
  home: TeamOddsInput,
  away: TeamOddsInput,
): ComputedOdds {
  const probs = computeProbabilities(home, away);
  return probsToOdds(probs);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Round odds to 2 decimal places. Odds are displayed and stored with this
 * precision. Using Math.round avoids floating-point artefacts like 2.0999999.
 *
 * @param odds  Raw decimal odds value.
 * @returns     Odds rounded to 2 decimal places.
 */
function roundOdds(odds: number): number {
  return Math.round(odds * 100) / 100;
}

/**
 * Compute a team's average starter rating from individual player stats.
 * Averages the 5 stat categories (attacking, defending, mental, athletic,
 * technical) across all starting players.
 *
 * This is the primary input to the odds model and should be called with
 * data from `normalizeTeamForEngine()`.
 *
 * @param players  Array of player stat objects. Only starters are included.
 * @returns        Average rating across all 5 categories (1–99 range).
 */
export function computeAvgRating(
  players: Array<{
    attacking: number;
    defending: number;
    mental: number;
    athletic: number;
    technical: number;
  }>,
): number {
  if (players.length === 0) return 70; // Fallback: functional average.

  let total = 0;
  for (const p of players) {
    total += (p.attacking + p.defending + p.mental + p.athletic + p.technical) / 5;
  }
  return total / players.length;
}

/**
 * Compute form record from an array of recent match results. Each result
 * is 'W' (win), 'D' (draw), or 'L' (loss). Returns counts for odds input.
 *
 * @param results  Array of result characters, most recent first. Only the
 *                 first FORM_WINDOW entries are considered.
 * @returns        { wins, draws, losses } counts.
 */
export function computeForm(
  results: Array<'W' | 'D' | 'L'>,
): { wins: number; draws: number; losses: number } {
  const window = results.slice(0, FORM_WINDOW);
  let wins = 0;
  let draws = 0;
  let losses = 0;
  for (const r of window) {
    if (r === 'W') wins++;
    else if (r === 'D') draws++;
    else losses++;
  }
  return { wins, draws, losses };
}
