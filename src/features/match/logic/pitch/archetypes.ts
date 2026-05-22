// ── features/match/logic/pitch/archetypes.ts ────────────────────────────────
// Maps a `match_events.type` value emitted by gameEngine.js (~70 kinds)
// onto one of 8 movement archetypes the pitch view animates.
//
// WHY ARCHETYPES (and not per-event animations)
//   The engine emits a wide narrative vocabulary — `freekick_setup`,
//   `confrontation_card`, `penalty_taker_change`, `var_review`, etc. —
//   but the pitch only needs to know the *kinematics*: are players
//   attacking, defending, celebrating, idle, or restarting?  Eight
//   buckets is the smallest set that distinguishes the visually
//   different motions (a counter-attack reads differently from a
//   stoppage; a goal celebration reads differently from a build-up).
//
// THE EIGHT ARCHETYPES
//   • ATTACK_BUILDUP    — possession-side advancing; defence drops back.
//   • SHOT_ATTEMPT      — a shot is being struck (or about to be).
//   • SET_PIECE_PREP    — players walking to free-kick / corner positions.
//   • PENALTY_TAKE      — the penalty sequence (run-up + shot).
//   • DEFENSIVE_ACTION  — tackles, blocks, GK claims, clearances.
//   • GOAL_CELEBRATION  — after a goal: chase, pile-on, then jog back.
//   • STOPPAGE          — ball out of play (foul/VAR/injury/argument).
//   • RESTART           — the moment play resumes after a stoppage.
//
// UNKNOWN INPUT FALLBACK
//   Any event type not in the explicit map returns `ATTACK_BUILDUP`.
//   It's the least misleading default — a generic forward-moving
//   animation works for unfamiliar events without claiming a specific
//   choreography that might mismatch.

/**
 * The 8 movement archetypes the pitch view choreographs.  These are
 * STRING ENUM values rather than numeric so logs / dev tooling can
 * print them readably, and so adding a new archetype is a backwards-
 * compatible change at the type level.
 */
export const ARCHETYPES = [
  'ATTACK_BUILDUP',
  'SHOT_ATTEMPT',
  'SET_PIECE_PREP',
  'PENALTY_TAKE',
  'DEFENSIVE_ACTION',
  'GOAL_CELEBRATION',
  'STOPPAGE',
  'RESTART',
] as const;

/** Union type of every archetype literal. */
export type Archetype = typeof ARCHETYPES[number];

// ── Mapping table ────────────────────────────────────────────────────────────
// Sourced by grepping `type: '<name>'` across src/gameEngine.js — keep
// in sync when a new event type is added by the engine.  Tests below
// it.each over the full inventory and fail if the mapping table grows
// out of date.

/**
 * Lookup table from engine event type → archetype.  Every entry is
 * commented with the (a) archetype rationale and (b) representative
 * commentary string from gameEngine.js so a future reader can quickly
 * confirm the mapping isn't surprising.
 */
const EVENT_TO_ARCHETYPE: Readonly<Record<string, Archetype>> = Object.freeze({
  // ── ATTACK_BUILDUP — possession advancing, no shot yet ─────────────
  attack:               'ATTACK_BUILDUP',
  pass:                 'ATTACK_BUILDUP',
  play:                 'ATTACK_BUILDUP', // generic play
  skill_moment:         'ATTACK_BUILDUP',
  counter_start:        'ATTACK_BUILDUP',
  counter_pass:         'ATTACK_BUILDUP',
  counter_sequence:     'ATTACK_BUILDUP', // pre-shot phase
  siege_start:          'ATTACK_BUILDUP',
  siege_pressure:       'ATTACK_BUILDUP',
  comeback_captain:     'ATTACK_BUILDUP',
  comeback_momentum:    'ATTACK_BUILDUP',
  near_miss_setup:      'ATTACK_BUILDUP',
  near_miss_end:        'ATTACK_BUILDUP', // unwinding into reset
  lazy_moment:          'ATTACK_BUILDUP', // jogging — still on-pitch

  // ── SHOT_ATTEMPT — shot is being struck ────────────────────────────
  shot:                 'SHOT_ATTEMPT',
  saved:                'SHOT_ATTEMPT',
  long_shot:            'SHOT_ATTEMPT',
  post_hit:             'SHOT_ATTEMPT',
  corner_goal:          'SHOT_ATTEMPT', // header-on-shot
  near_miss_scramble:   'SHOT_ATTEMPT',
  near_miss_sequence:   'SHOT_ATTEMPT',
  siege_chance:         'SHOT_ATTEMPT',
  freekick_sequence:    'SHOT_ATTEMPT',
  freekick_trick:       'SHOT_ATTEMPT',

  // ── SET_PIECE_PREP — walking into position ─────────────────────────
  corner:               'SET_PIECE_PREP',
  freekick:             'SET_PIECE_PREP',
  freekick_setup:       'SET_PIECE_PREP',
  freekick_wall:        'SET_PIECE_PREP',

  // ── PENALTY_TAKE — every step of the penalty drama ─────────────────
  penalty:              'PENALTY_TAKE',
  penalty_sequence:     'PENALTY_TAKE',
  penalty_taker_change: 'PENALTY_TAKE',
  penalty_runup:        'PENALTY_TAKE',
  penalty_shot:         'PENALTY_TAKE',
  penalty_tension:      'PENALTY_TAKE',

  // ── DEFENSIVE_ACTION — winning/keeping the ball back ───────────────
  defense:              'DEFENSIVE_ACTION',
  workhorse_tackle:     'DEFENSIVE_ACTION',
  clearance_line:       'DEFENSIVE_ACTION',
  gk_claim:             'DEFENSIVE_ACTION',

  // ── GOAL_CELEBRATION — after the ball goes in ──────────────────────
  goal:                 'GOAL_CELEBRATION',
  celebration:          'GOAL_CELEBRATION',
  celebration_manager:  'GOAL_CELEBRATION',
  celebration_pile:     'GOAL_CELEBRATION',
  comeback_eruption:    'GOAL_CELEBRATION',

  // ── STOPPAGE — ball out of play / argument / VAR / injury ──────────
  foul:                 'STOPPAGE',
  offside:              'STOPPAGE',
  injury:               'STOPPAGE',
  injury_scare:         'STOPPAGE',
  chaos_event:          'STOPPAGE',
  atmosphere_moment:    'STOPPAGE', // crowd shot — no movement
  confrontation:        'STOPPAGE',
  confrontation_card:   'STOPPAGE',
  confrontation_crowd:  'STOPPAGE',
  manager_protest:      'STOPPAGE',
  manager_warning:      'STOPPAGE',
  manager_sentoff:      'STOPPAGE',
  manager_sentoff_reaction: 'STOPPAGE',
  missed_penalty_call:  'STOPPAGE',
  penalty_awarded:      'STOPPAGE',
  penalty_incident:     'STOPPAGE',
  penalty_reaction:     'STOPPAGE',
  penalty_red_card:     'STOPPAGE',
  penalty_yellow_card:  'STOPPAGE',
  var_check:            'STOPPAGE',
  var_decision:         'STOPPAGE',
  var_reaction:         'STOPPAGE',
  var_review:           'STOPPAGE',

  // ── RESTART — play resumes after a stoppage ────────────────────────
  celebration_restart:  'RESTART',
  confrontation_resolved: 'RESTART',
  gk_distribution:      'RESTART',
  var_no_action:        'RESTART',
});

/**
 * Look up the movement archetype for an engine event type.
 *
 * @param eventType  The `type` field of a `match_events` row emitted by
 *                   gameEngine.js.  Free-text by design — unknown values
 *                   map to `ATTACK_BUILDUP` as a defensive default.
 * @returns          One of the 8 archetypes.
 */
export function eventToArchetype(eventType: string): Archetype {
  return EVENT_TO_ARCHETYPE[eventType] ?? 'ATTACK_BUILDUP';
}

/**
 * The full set of event types we explicitly map.  Exposed so the test
 * suite (and a future audit tool) can iterate them; also useful for
 * dev pages that want to display a legend.
 *
 * Returns a fresh array per call so callers can sort/map without
 * mutating the canonical key list.
 */
export function listMappedEventTypes(): string[] {
  return Object.keys(EVENT_TO_ARCHETYPE);
}
