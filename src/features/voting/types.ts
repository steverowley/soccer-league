// ── voting/types.ts ──────────────────────────────────────────────────────────
// WHY: Typed shapes for the voting feature. These mirror the `focus_options`,
// `focus_votes`, and `focus_tally` objects from 0006_voting.sql.
//
// Manually defined because the migration hasn't been applied yet. When
// database.ts is regenerated, switch to:
//   import type { Tables } from '@/types/database';
//   export type FocusOption = Tables<'focus_options'>;

// ── Focus tier ──────────────────────────────────────────────────────────────

/**
 * Focus option tier. Each team enacts one of each per season:
 * - `major` — high-impact changes (sign a star player, stadium upgrade)
 * - `minor` — smaller tweaks (preseason training, youth promotion)
 */
export type FocusTier = 'major' | 'minor';

// ── DB row types ────────────────────────────────────────────────────────────

/**
 * A single focus option available for fan voting. Generated per team per
 * season (initially static, later LLM-generated based on team lore).
 */
export interface FocusOption {
  id: string;
  team_id: string;
  season_id: string;
  /** Machine-readable key (e.g. 'sign_striker', 'youth_academy'). */
  option_key: string;
  /** Human-readable label displayed on the voting UI. */
  label: string;
  /** Longer description of what this focus entails. */
  description: string | null;
  tier: FocusTier;
  created_at: string;
}

/**
 * A single fan's credit allocation to a focus option.
 */
export interface FocusVote {
  id: string;
  user_id: string;
  focus_option_id: string;
  /** Credits spent on this vote. Always > 0. */
  credits_spent: number;
  created_at: string;
}

// ── Tally types ─────────────────────────────────────────────────────────────

/**
 * Aggregated vote tally for a single focus option. Matches the `focus_tally`
 * SQL view shape.
 */
export interface FocusTallyEntry {
  option_id: string;
  team_id: string;
  season_id: string;
  option_key: string;
  label: string;
  description: string | null;
  tier: FocusTier;
  /** Number of individual votes cast for this option. */
  vote_count: number;
  /** Total credits allocated to this option across all fans. */
  total_credits: number;
}

/**
 * The winning focus options for a single team — one major and one minor.
 * Determined by the tally logic after voting closes.
 */
export interface EnactedFocuses {
  team_id: string;
  season_id: string;
  /** The major focus that won (highest total_credits among major options). */
  major: FocusTallyEntry | null;
  /** The minor focus that won (highest total_credits among minor options). */
  minor: FocusTallyEntry | null;
}

// ── Static focus option definitions ─────────────────────────────────────────

/**
 * Template for generating focus options. Used by the option generator to
 * create per-team per-season rows. Later phases will replace this with
 * LLM-generated options based on team lore.
 */
export interface FocusOptionTemplate {
  option_key: string;
  label: string;
  description: string;
  tier: FocusTier;
}
