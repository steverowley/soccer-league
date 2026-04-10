// ── betting/types.ts ─────────────────────────────────────────────────────────
// WHY: Typed shapes for the betting feature. These mirror the `wagers`,
// `match_odds`, and `team_finances` tables created by 0004_betting.sql.
//
// Manually defined because the migration hasn't been applied yet. When
// database.ts is regenerated, switch to:
//   import type { Tables } from '@/types/database';
//   export type Wager = Tables<'wagers'>;

// ── Wager status lifecycle ──────────────────────────────────────────────────

/**
 * Wager status values matching the CHECK constraint in the `wagers` table.
 *
 * - `open`  — match hasn't completed; wager is live
 * - `won`   — user's choice matched the result; payout credited
 * - `lost`  — user's choice didn't match; stake forfeited
 * - `void`  — match cancelled or exceptional; stake refunded
 */
export type WagerStatus = 'open' | 'won' | 'lost' | 'void';

/**
 * Match outcome choices the user can bet on. Maps directly to the
 * `team_choice` CHECK constraint in the `wagers` table.
 */
export type TeamChoice = 'home' | 'draw' | 'away';

// ── DB row types ────────────────────────────────────────────────────────────

/**
 * A single wager row from the `wagers` table.
 */
export interface Wager {
  id: string;
  user_id: string;
  match_id: string;
  team_choice: TeamChoice;
  /** Number of Intergalactic Credits staked. Always >= 10 (MIN_BET). */
  stake: number;
  /** Decimal odds snapshot at time of bet placement. Always > 1.0. */
  odds_snapshot: number;
  status: WagerStatus;
  /** Credits paid out on a win. NULL while open or on loss. */
  payout: number | null;
  created_at: string;
}

/**
 * Computed decimal odds for a single match. One row per match (PK = match_id).
 */
export interface MatchOdds {
  match_id: string;
  /** Decimal odds for a home win. e.g. 2.10 means bet 100 → win 210. */
  home_odds: number;
  /** Decimal odds for a draw. */
  draw_odds: number;
  /** Decimal odds for an away win. */
  away_odds: number;
  computed_at: string;
}

/**
 * Per-team per-season financial ledger row from `team_finances`.
 * Used by both betting (settlement) and Phase 3 (ticket revenue).
 */
export interface TeamFinances {
  team_id: string;
  season_id: string;
  /** Cumulative ticket revenue from match attendance. */
  ticket_revenue: number;
  /** Total player wage bill for the season. */
  wage_bill: number;
  /** Running balance = ticket_revenue - wage_bill + other income. */
  balance: number;
  updated_at: string;
}

// ── Pure logic input types ──────────────────────────────────────────────────

/**
 * Aggregated team stats used as input to the odds calculation.
 * Computed from player stat averages and recent match form.
 */
export interface TeamOddsInput {
  /** Average rating across attacking/defending/mental/athletic/technical for starters (1–99). */
  avgRating: number;
  /**
   * Form from the team's last N matches (typically 5).
   * Each value represents the number of wins, draws, and losses.
   */
  form: {
    wins: number;
    draws: number;
    losses: number;
  };
}

/**
 * Raw match probabilities before house margin is applied.
 * All three values sum to 1.0.
 */
export interface MatchProbabilities {
  home: number;
  draw: number;
  away: number;
}

/**
 * Computed decimal odds for a match, ready for storage or display.
 * With house margin baked in, `1/home + 1/draw + 1/away > 1.0`.
 */
export interface ComputedOdds {
  homeOdds: number;
  drawOdds: number;
  awayOdds: number;
}

/**
 * Leaderboard row from the `wager_leaderboard` SQL view.
 * Aggregated per-user wagering stats without individual bet details.
 */
export interface WagerLeaderboardEntry {
  user_id: string;
  username: string;
  favourite_team_id: string | null;
  total_bets: number;
  wins: number;
  losses: number;
  total_staked: number;
  total_won: number;
  /** total_won - total_staked. Can be negative. */
  net_profit: number;
}
