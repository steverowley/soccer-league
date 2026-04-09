// ── feature: voting ─────────────────────────────────────────────────────────
// WHY: End-of-season voting is the payoff mechanic that makes this a *social*
// experiment rather than a passive simulation. Fans pool their Intergalactic
// Credits across a team to collectively vote on what their club does next
// season — creating shared stakes and emergent community storylines.
//
// Design constraints (from the Notion plan):
//   - 2 focuses enacted per season: 1 major + 1 minor.
//   - Focus options: Sign new players, Promote youth, Player boosts, Preseason
//     training investments, Stadium upgrades (initially static; later
//     LLM-generated based on team lore via the Architect).
//   - Credits spent on voting are consumed — spending has real weight.
//   - The focus with the most credits pooled across all fans of a team wins.
//   - Enactment actually reshapes the team for next season (stat changes,
//     lineup adjustments, new players). No empty votes.
//
// Tables (created in Phase 4 migration):
//   - `focus_options` (team_id, season_id, option_key, label, tier 'major'|'minor')
//   - `focus_votes` (user_id, focus_option_id, credits_spent)
//
// Cross-feature wiring:
//   - Listens on `season.ended` event from the event bus to open voting.
//   - Debits `profiles.credits` via the auth feature's profilesApi (never
//     imports auth internals — only the public barrel).
//
// STATUS: scaffold only — Phase 4 of the plan populates this with real code.

export {};
