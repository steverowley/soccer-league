// ── feature: entities ───────────────────────────────────────────────────────
// WHY: Phase 5 introduces the unified entity model that underpins the
// Mirofish-inspired simulation layer. Rather than hard-coding referees,
// journalists, owners, and pundits as constants or ad-hoc tables, everything
// is a first-class `entities` row with traits and relationships. This gives
// the Cosmic Architect new levers: it can now reference journalists quoting
// pundits reacting to a referee's decision, or track a feud between a team
// owner and a galactic political body.
//
// The model is deliberately additive: existing `players` and `managers`
// tables keep their typed columns (attacking/defending/mental/etc.) intact —
// the game engine reads them directly via `normalizeTeamForEngine()`. We
// add an `entity_id` FK to those tables so the narrative layer can treat
// players and managers as entities without the engine ever knowing.
//
// Entity kinds (from the Notion plan):
//   player, manager, coach, physio, doctor, scout, owner, analyst, referee,
//   pundit, commentator, journalist, media_company, association, planet,
//   colony, political_body
//
// Sub-systems seeded in Phase 5:
//   - IEOB referee pool (~32 referees)
//   - Media corps (~6 broadcasters), pundit roster (~12), journalist pool (~20)
//   - Association bodies (ISL, MWSA, ISSU)
//   - Planetary/colony entities for each team's home world
//   - Bookie entity ("Galactic Sportsbook") — counterparty to all wagers
//
// STATUS: scaffold only — Phase 5 of the plan populates this with real code.

export {};
