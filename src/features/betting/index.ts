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
  resultsForTeam,
  HOUSE_MARGIN,
  FORM_WINDOW,
} from './logic/odds';
export type { CompletedMatchRow } from './logic/odds';

export {
  determineOutcome,
  resolveWager,
  calculatePayout,
  netCreditChange,
  houseProfitFromWager,
} from './logic/settlement';

// ── Logic — bettor narratives (Phase 4) ────────────────────────────────────
// Pure pattern detection + voice assignment + template selection for the
// anonymized cosmic-voice narrative line that surfaces in Galaxy Dispatch
// after every settlement batch.  No I/O — fully unit-testable.
export {
  detectPattern,
  pickNarrativeVoice,
  buildSettlementNarrative,
  buildSettlementBatch,
} from './logic/bettorNarratives';
export type {
  NarrativeVoice,
  SettlementBatch,
  SettledWager,
} from './logic/bettorNarratives';

// ── API (Supabase queries) ─────────────────────────────────────────────────
export {
  placeWager,
  getUserWagers,
  getUserWagerForMatch,
} from './api/wagers';

export {
  getMatchOdds,
  saveMatchOdds,
} from './api/oddsRepo';

// Public read of the `wager_leaderboard` SQL view — top-N by net profit.
// Consumed by /leaderboards and any future "who's winning" widget.
export { getWagerLeaderboard } from './api/wagerLeaderboard';

// ── API — bettor narratives (Phase 4) ──────────────────────────────────────
// I/O boundary that takes a settled-match summary and writes one anonymized
// cosmic-voice narrative row to the `narratives` table.  Used by the
// WagerSettlementListener — exported here so any future surface (e.g. a
// season-recap dashboard or admin replay tool) can call it directly.
export { writeWagerNarrativeForMatch } from './api/narrativeWriter';

// ── UI (React components) ──────────────────────────────────────────────────
// WagerWidget lives at `src/components/WagerWidget.tsx` (rebuilt against
// the current design system after the 2026-05 nuke) and is consumed
// directly by `src/pages/MatchDetail.tsx`; we don't re-export it from this
// barrel because that page imports it via its concrete path.  BetHistory
// and WagerVolumeStrip are still pending rebuilds.
//
// Wager settlement runs server-side in the match-worker (service-role
// `settle_wager`); the old in-browser WagerSettlementListener was removed with
// migration 0074 / #557.

// ── Wager volume — pure data layer only ────────────────────────────────────
// WagerVolumeStrip (the visual bar) was removed in the 2026-05 nuke; the
// aggregation logic + API stay because they remain useful for the rebuilt
// MatchDetail and any future market-pulse surface.
export {
  summariseMatchWagers,
  MIN_WAGERS_FOR_SIGNAL,
} from './logic/wagerVolume';
export type { WagerVolumeSummary, SideBreakdown } from './logic/wagerVolume';
