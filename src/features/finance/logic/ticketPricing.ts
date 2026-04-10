// ── finance/logic/ticketPricing.ts ───────────────────────────────────────────
// WHY: Pure ticket revenue calculation. Given a fan count and ticket price,
// produces the revenue generated from match attendance. No React, no Supabase.
//
// The price model is deliberately simple: flat price per fan. Future phases
// may add dynamic pricing (demand-based, stadium capacity modifiers, etc.)
// but the current design avoids premature complexity.

/**
 * Default ticket price in Intergalactic Credits per fan per match.
 *
 * This is the baseline cost for a fan to "attend" a match (by being logged
 * in with their favourite team set). Revenue flows into the team's finances
 * and ultimately affects end-of-season voting power and the Architect's
 * narrative about team wealth.
 *
 * NOTE: Credits are not actually deducted from fans — attendance is free
 * for the user. This is an economic simulation: the team *earns* revenue
 * as if fans bought tickets. The Architect can reference this in storylines.
 */
export const DEFAULT_TICKET_PRICE = 5;

/**
 * Calculate ticket revenue for a single team from match attendance.
 *
 * @param fanCount     Number of fans present (logged in, favourite team set,
 *                     last_seen_at within 5 minutes of kickoff).
 * @param ticketPrice  Credits per fan. Defaults to DEFAULT_TICKET_PRICE.
 *                     Can be overridden per-stadium via teams.meta in the future.
 * @returns            Total ticket revenue in Intergalactic Credits.
 *
 * @example
 *   calculateTicketRevenue(42)       // → 210 (42 × 5)
 *   calculateTicketRevenue(42, 10)   // → 420 (42 × 10)
 *   calculateTicketRevenue(0)        // → 0
 */
export function calculateTicketRevenue(
  fanCount: number,
  ticketPrice: number = DEFAULT_TICKET_PRICE,
): number {
  return Math.max(0, fanCount) * ticketPrice;
}
