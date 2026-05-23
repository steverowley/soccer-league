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
// STATUS: Phase 4 complete — tally logic, focus templates, voting API.

// ── Types ──────────────────────────────────────────────────────────────────
export type {
  FocusTier,
  FocusOption,
  FocusVote,
  FocusTallyEntry,
  EnactedFocuses,
  FocusOptionTemplate,
} from './types';

// ── Logic (pure TS) ────────────────────────────────────────────────────────
export {
  pickWinner,
  determineTeamFocuses,
  computeVotePercentages,
} from './logic/tally';

export { ALL_FOCUS_TEMPLATES } from './logic/focusTemplates';

// ── Logic — election night (pure TS, Phase 3) ─────────────────────────────
export {
  selectIncinerationTargets,
  resolveFocusWinners,
  buildFocusMutations,
  sortDecreesForElectionNight,
} from './logic/electionLogic';
export type {
  IncinerationCandidate,
  IncinerationTarget,
  FocusMutation,
} from './logic/electionLogic';

// ── API (Supabase queries) ─────────────────────────────────────────────────
export {
  generateFocusOptions,
  getTeamFocusOptions,
  castVote,
  getTeamTally,
} from './api/focuses';

// ── Enactment API ──────────────────────────────────────────────────────────
// `enactSeasonFocuses` is the public entry point called by SeasonEnactmentListener.
// `getEnactedFocuses` is called by VotingPage to populate the post-season panel.
export {
  enactSeasonFocuses,
  getEnactedFocuses,
} from './api/enactment';
export type {
  SeasonEnactmentResult,
  EnactedFocusRow,
} from './api/enactment';

// ── Enactment logic (pure TS) ──────────────────────────────────────────────
// `enactFocus` and `seededRng` are exported so callers can reproduce
// mutations deterministically (e.g. debug tooling, season-replay scripts).
export { enactFocus, seededRng } from './logic/enactFocus';
export type {
  PlayerRow,
  NewPlayerData,
  EnactmentMutation,
  FocusEnactmentSpec,
} from './logic/enactFocus';

// ── API — election night (Phase 3) ────────────────────────────────────────
export {
  getActiveSeasonWithPhase,
  getSeasonDecrees,
  getAllIncinerations,
  getSeasonFocusTally,
  advanceSeasonPhase,
  insertSeasonDecrees,
  incinerate,
} from './api/election';
export type {
  SeasonWithPhase,
  SeasonDecree,
  IncinerationRecord,
} from './api/election';

// ── API — election night orchestrator (Phase 3) ───────────────────────────
// `runElectionNight` is the single entry point that closes a season: it
// resolves focus winners, runs incinerations via the atomic RPC, writes the
// full decree set, and emits `season.ended` so SeasonEnactmentListener
// applies focus mutations.  Pure-logic decree builders are also exported
// so future LLM enrichment can A/B against the template baseline.
export { runElectionNight } from './api/orchestrator';
export type { ElectionNightResult } from './api/orchestrator';
export {
  buildProclamationDecree,
  buildFocusEnactmentDecree,
  buildIncinerationDecree,
} from './logic/decreeTemplates';

// ── Logic — replacement player generation (Phase 3.1) ─────────────────────
// Pure name + stat generator used by runElectionNight to fill rosters after
// each incineration.  Exported so future LLM-bio generation can A/B against
// the template baseline (same pattern as decreeTemplates).
export {
  buildReplacementPlayer,
  generateReplacementName,
} from './logic/replacementPlayer';
export type {
  GeneratedReplacementPlayer,
  ReplacementContext,
  TeammateNameSeed,
} from './logic/replacementPlayer';

// ── Logic — arrival narratives (Phase 3.2) ────────────────────────────────
// Pure template builder for the "New Arrival" news post emitted whenever
// runElectionNight generates a replacement player.  Closes the lore loop
// on incinerations.
export {
  NEW_ARRIVAL_KIND,
  buildArrivalNarrative,
} from './logic/arrivalNarrative';
export type { ArrivalContext } from './logic/arrivalNarrative';

// ── UI (React components) ──────────────────────────────────────────────────
// VotingPage + FocusCard were removed in the 2026-05 nuke and will be
// rebuilt against the new design language.
//
// SeasonEnactmentListener removed in #372 — used to mount a `season.ended`
// bus listener in every browser tab, which produced a 100-way race for
// `enactSeasonFocuses` (player stat mutations are NOT idempotent).
// Enactment now runs only via the admin-triggered `triggerSeasonEnactment`
// + `triggerElectionNight` paths exposed by the admin feature.
