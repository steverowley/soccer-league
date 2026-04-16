// ── feature: betting ────────────────────────────────────────────────────────
// WHY: Owns the wager lifecycle — odds generation, wager placement, and
// settlement on match completion. Consumes match outcomes via the shared
// event bus ('match.completed') so it never imports the match feature
// directly. The `bookie` entity (seeded in Phase 5) is the counterparty to
// every wager so the Architect can later manipulate "the House is nervous"
// storylines from the entity graph.
//
// RULES (from the Notion plan):
//   - Minimum bet: 10 Intergalactic Credits. No maximum.
//   - Odds: decimal, with ~5% house margin baked in.
//   - RLS: users may only SELECT/INSERT their own `wagers` rows. A public
//     `wager_leaderboard` SQL view exposes aggregates without leaking
//     individual bets.
//
// STATUS: Phase 2 complete — odds engine, settlement, wager API, odds repo.

// ── Types ──────────────────────────────────────────────────────────────────
export type {
  WagerStatus,
  TeamChoice,
  Wager,
  MatchOdds,
  TeamFinances,
  TeamOddsInput,
  MatchProbabilities,
  ComputedOdds,
  WagerLeaderboardEntry,
} from './types';

// ── Logic (pure TS) ────────────────────────────────────────────────────────
export {
  effectiveRating,
  computeProbabilities,
  probsToOdds,
  computeMatchOdds,
  computeAvgRating,
  computeForm,
  HOUSE_MARGIN,
  FORM_WINDOW,
} from './logic/odds';

export {
  determineOutcome,
  resolveWager,
  calculatePayout,
  netCreditChange,
  houseProfitFromWager,
} from './logic/settlement';

// ── API (Supabase queries) ─────────────────────────────────────────────────
export {
  placeWager,
  getUserWagers,
  getOpenWagersForMatch,
  settleMatchWagers,
} from './api/wagers';

export {
  getMatchOdds,
  getOddsForMatches,
  saveMatchOdds,
} from './api/oddsRepo';

// ── UI (React components) ──────────────────────────────────────────────────
// The widget is the user's primary on-ramp; the history list is the personal
// counterpart to the public `wager_leaderboard` view. Both are exported via
// the barrel so feature pages can import them with `@features/betting`
// instead of poking into the ui/ folder directly.
export { WagerWidget } from './ui/WagerWidget';
export type { WagerWidgetMatch, WagerWidgetProps } from './ui/WagerWidget';

export { BetHistory } from './ui/BetHistory';
export type { BetHistoryProps } from './ui/BetHistory';

// ── Side-effect listener ────────────────────────────────────────────────────
// WagerSettlementListener registers a `match.completed` bus subscription and
// renders null.  Mount it once inside <SupabaseProvider> at the app root so
// it has DB client access for every settlement write.
export { WagerSettlementListener } from './ui/WagerSettlementListener';
