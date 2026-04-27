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

export {
  MAJOR_FOCUS_TEMPLATES,
  MINOR_FOCUS_TEMPLATES,
  ALL_FOCUS_TEMPLATES,
} from './logic/focusTemplates';

// ── API (Supabase queries) ─────────────────────────────────────────────────
export {
  generateFocusOptions,
  getTeamFocusOptions,
  castVote,
  getUserVotesForSeason,
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

// ── UI (React components) ──────────────────────────────────────────────────
// VotingPage is the route-level component (mounted at /voting). FocusCard
// is the per-option subcomponent — exported separately so other surfaces
// (e.g. a season-recap dashboard) can render individual cards in isolation.
// SeasonEnactmentListener is a side-effect-only component; mount it once
// near the application root to wire the season.ended → enactment pipeline.
export { VotingPage } from './ui/VotingPage';
export type { VotingPageProps } from './ui/VotingPage';

export { FocusCard } from './ui/FocusCard';
export type { FocusCardProps } from './ui/FocusCard';

export { SeasonEnactmentListener } from './ui/SeasonEnactmentListener';
