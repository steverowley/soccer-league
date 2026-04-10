// ── voting/logic/tally.ts ────────────────────────────────────────────────────
// WHY: Pure vote tallying and winner determination. Given an array of tally
// entries (from the focus_tally SQL view), produces the winning major and
// minor focuses for each team. No React, no Supabase.
//
// TIE-BREAKING RULES:
//   1. Highest total_credits wins.
//   2. If tied on credits, highest vote_count wins (more individual fans).
//   3. If still tied, the option that appears first alphabetically by
//      option_key wins (deterministic, reproducible).

import type { FocusTallyEntry, FocusTier, EnactedFocuses } from '../types';

/**
 * Determine the winning focus for a single tier from a list of tally entries.
 * All entries must be the same tier; the caller is responsible for filtering.
 *
 * Returns null if the array is empty or all options have 0 credits.
 *
 * @param entries  Tally entries for a single tier, all for the same team.
 * @returns        The winning entry, or null if no votes were cast.
 */
export function pickWinner(entries: FocusTallyEntry[]): FocusTallyEntry | null {
  if (entries.length === 0) return null;

  // Filter out options with no votes — they can't win.
  const voted = entries.filter((e) => e.total_credits > 0);
  if (voted.length === 0) return null;

  // Sort by total_credits DESC, then vote_count DESC, then option_key ASC.
  const sorted = [...voted].sort((a, b) => {
    if (b.total_credits !== a.total_credits) return b.total_credits - a.total_credits;
    if (b.vote_count !== a.vote_count) return b.vote_count - a.vote_count;
    return a.option_key.localeCompare(b.option_key);
  });

  return sorted[0] ?? null;
}

/**
 * Determine the winning major and minor focuses for a single team from
 * their full set of tally entries.
 *
 * @param teamId    Team slug.
 * @param seasonId  Season UUID.
 * @param entries   All tally entries for this team+season (both tiers mixed).
 * @returns         EnactedFocuses with the winning major and minor options.
 */
export function determineTeamFocuses(
  teamId: string,
  seasonId: string,
  entries: FocusTallyEntry[],
): EnactedFocuses {
  const byTier = (tier: FocusTier) => entries.filter((e) => e.tier === tier);

  return {
    team_id: teamId,
    season_id: seasonId,
    major: pickWinner(byTier('major')),
    minor: pickWinner(byTier('minor')),
  };
}

/**
 * Compute vote percentages for display. Given a list of tally entries for
 * a single tier, returns each option's share of the total credits as a
 * percentage (0–100). Useful for progress bars on the voting UI.
 *
 * @param entries  Tally entries for a single tier.
 * @returns        Array of { optionId, percentage } in the same order as input.
 */
export function computeVotePercentages(
  entries: FocusTallyEntry[],
): Array<{ optionId: string; percentage: number }> {
  const total = entries.reduce((sum, e) => sum + e.total_credits, 0);
  if (total === 0) {
    return entries.map((e) => ({ optionId: e.option_id, percentage: 0 }));
  }
  return entries.map((e) => ({
    optionId: e.option_id,
    percentage: Math.round((e.total_credits / total) * 100),
  }));
}
