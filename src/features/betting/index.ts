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
// STATUS: scaffold only — Phase 2 of the plan populates this with real code.

export {};
