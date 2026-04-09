// ── feature: training ───────────────────────────────────────────────────────
// WHY: The training minigame gives fans something to do *between* matches and
// creates a direct mechanical link between player engagement and player
// development. Every click is a vote cast for a specific player's growth —
// mirroring the collective-agency theme of the broader game.
//
// Mechanics (from the Notion plan):
//   - Clicker between matches: each click adds XP to the chosen player.
//   - XP converts to small stat bumps stored in `player_training_log`.
//   - Rate-limited via `logic/cooldown.ts` to prevent trivial farming.
//   - Stat bumps are small enough that no single fan can unilaterally boost a
//     player to godhood — the community effect matters.
//
// Tables (created in Phase 6 migration):
//   - `player_training_log` (player_id, user_id, xp_added, stat_bumped, created_at)
//
// Layer breakdown:
//   - `logic/xpCurve.ts`  — pure function mapping total XP → stat bump thresholds.
//     No React, no Supabase; fully unit-tested.
//   - `logic/cooldown.ts` — pure function: given last-click timestamp + user
//     tier, returns whether a new click is allowed. Fully unit-tested.
//   - `api/trainingLog.ts` — Supabase reads/writes wrapped in Zod schemas.
//   - `ui/TrainingPage.tsx` / `ui/ClickerWidget.tsx` — React components.
//
// STATUS: scaffold only — Phase 6 of the plan populates this with real code.

export {};
