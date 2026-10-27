// ── constants.ts ──────────────────────────────────────────────────────────────
// Static game data: the model id and player personality keys.
//
// Nothing here is calculated at runtime — it is purely look-up data.
// Every object is frozen (`as const`) so TypeScript infers narrow literal
// types, enabling exhaustive switch checking on personality values
// elsewhere in the codebase.
//
// No colours: the old `C` palette that lived here had no remaining users
// and was deleted with the design system's last group. Interface colours
// are the tokens in src/shared/design (docs/design-language.md).

// ── AI model identifier ───────────────────────────────────────────────────────
// Single source of truth for the Claude model used by all AI commentary and
// Architect systems.  Update here to roll the entire app to a new model version
// without hunting for individual call sites in gameEngine and MatchComponents.
export const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

// ── Player personality keys ───────────────────────────────────────────────────
// Each player is assigned exactly one personality at agent-creation time
// (see createAgent in gameEngine.ts).  Personality gates which special events
// can fire for that player each minute.
//
//  BAL  (balanced)    – no special triggers; reliable all-rounder
//  SEL  (selfish)     – forwards shoot from anywhere; miss often
//  TEAM (team_player) – creates assists; boosts teammates after goals
//  AGG  (aggressive)  – prone to fouls, yellow/red cards
//  CAU  (cautious)    – snuffs out danger quietly; rarely goes forward
//  CRE  (creative)    – audacious skill moves; 30% chance of a wonder-goal
//  LAZ  (lazy)        – randomly drops work rate, loses possession
//  WRK  (workhorse)   – sprints even at full fatigue; accumulates more tired
export const PERS = {
  BAL:  'balanced',
  SEL:  'selfish',
  TEAM: 'team_player',
  AGG:  'aggressive',
  CAU:  'cautious',
  CRE:  'creative',
  LAZ:  'lazy',
  WRK:  'workhorse',
} as const;

/** Union of all valid personality string values. */
export type Personality = (typeof PERS)[keyof typeof PERS];

/** Emoji shown next to a player's name in the UI for quick personality identification. */
export const PERS_ICON: Record<Personality, string> = {
  [PERS.SEL]:  '🎯',
  [PERS.TEAM]: '🤝',
  [PERS.AGG]:  '⚔️',
  [PERS.CAU]:  '🛡️',
  [PERS.CRE]:  '✨',
  [PERS.LAZ]:  '😴',
  [PERS.WRK]:  '💪',
  [PERS.BAL]:  '⚖️',
};
