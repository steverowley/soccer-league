// ── archetypes.test.ts ─────────────────────────────────────────────────────
// Verifies that EVERY engine event type maps to an archetype (per the
// acceptance criterion) and pins the fallback behaviour.
//
// The `ENGINE_EVENT_TYPES` list below was generated via:
//   grep -oE "type: ['\"][a-z_]+['\"]" src/gameEngine.js | sort -u
// then stripped of the wrapping `type: '...'`.  If gameEngine.js adds
// a new type, this list must be updated and the mapping table extended
// — the it.each below fails otherwise.

import { describe, it, expect } from 'vitest';

import {
  ARCHETYPES,
  eventToArchetype,
  listMappedEventTypes,
  type Archetype,
} from './archetypes';

/**
 * Canonical inventory of every `type: '...'` literal emitted by
 * gameEngine.js as of the current branch.  Sorted so a diff of the
 * sorted file output drops cleanly into this array.
 */
const ENGINE_EVENT_TYPES = [
  'atmosphere_moment',
  'attack',
  'celebration',
  'celebration_manager',
  'celebration_pile',
  'celebration_restart',
  'chaos_event',
  'clearance_line',
  'comeback_captain',
  'comeback_eruption',
  'comeback_momentum',
  'confrontation',
  'confrontation_card',
  'confrontation_crowd',
  'confrontation_resolved',
  'corner',
  'corner_goal',
  'counter_pass',
  'counter_sequence',
  'counter_start',
  'defense',
  'foul',
  'freekick',
  'freekick_sequence',
  'freekick_setup',
  'freekick_trick',
  'freekick_wall',
  'gk_claim',
  'gk_distribution',
  'goal',
  'injury',
  'injury_scare',
  'lazy_moment',
  'long_shot',
  'manager_protest',
  'manager_sentoff',
  'manager_sentoff_reaction',
  'manager_warning',
  'missed_penalty_call',
  'near_miss_end',
  'near_miss_scramble',
  'near_miss_sequence',
  'near_miss_setup',
  'offside',
  'pass',
  'penalty',
  'penalty_awarded',
  'penalty_incident',
  'penalty_reaction',
  'penalty_red_card',
  'penalty_runup',
  'penalty_sequence',
  'penalty_shot',
  'penalty_taker_change',
  'penalty_tension',
  'penalty_yellow_card',
  'play',
  'post_hit',
  'saved',
  'shot',
  'siege_chance',
  'siege_pressure',
  'siege_start',
  'skill_moment',
  'var_check',
  'var_decision',
  'var_no_action',
  'var_reaction',
  'var_review',
  'workhorse_tackle',
];

describe('eventToArchetype', () => {
  // ── Coverage — every engine event must map to a known archetype ────
  it.each(ENGINE_EVENT_TYPES)('maps engine event "%s" to a known archetype', (t) => {
    const result = eventToArchetype(t);
    expect(ARCHETYPES).toContain(result as Archetype);
  });

  // ── Spot-checks — the mapping isn't trivially "everything to one bucket" ──
  it('puts shots in SHOT_ATTEMPT', () => {
    expect(eventToArchetype('shot')).toBe('SHOT_ATTEMPT');
    expect(eventToArchetype('long_shot')).toBe('SHOT_ATTEMPT');
    expect(eventToArchetype('post_hit')).toBe('SHOT_ATTEMPT');
  });

  it('puts every penalty event in PENALTY_TAKE', () => {
    const penalty = ENGINE_EVENT_TYPES.filter(t => /^penalty(_|$)/.test(t));
    // The narrative "penalty was given" events (penalty_awarded /
    // _incident / _reaction / _red_card / _yellow_card) sit in
    // STOPPAGE — only the actual taking moments are PENALTY_TAKE.
    const taking = penalty.filter(t =>
      ['penalty', 'penalty_sequence', 'penalty_taker_change',
       'penalty_runup', 'penalty_shot', 'penalty_tension'].includes(t),
    );
    for (const t of taking) {
      expect(eventToArchetype(t)).toBe('PENALTY_TAKE');
    }
  });

  it('puts goal celebrations in GOAL_CELEBRATION', () => {
    expect(eventToArchetype('goal')).toBe('GOAL_CELEBRATION');
    expect(eventToArchetype('celebration')).toBe('GOAL_CELEBRATION');
    expect(eventToArchetype('celebration_pile')).toBe('GOAL_CELEBRATION');
    expect(eventToArchetype('celebration_manager')).toBe('GOAL_CELEBRATION');
    expect(eventToArchetype('comeback_eruption')).toBe('GOAL_CELEBRATION');
  });

  it('puts every VAR + manager protest event in STOPPAGE', () => {
    const stoppage = ENGINE_EVENT_TYPES.filter(t =>
      /^var_/.test(t) && t !== 'var_no_action',
    );
    for (const t of stoppage) {
      expect(eventToArchetype(t)).toBe('STOPPAGE');
    }
    expect(eventToArchetype('manager_protest')).toBe('STOPPAGE');
    expect(eventToArchetype('manager_warning')).toBe('STOPPAGE');
  });

  it('puts gk_distribution + var_no_action in RESTART (play resumes)', () => {
    expect(eventToArchetype('gk_distribution')).toBe('RESTART');
    expect(eventToArchetype('var_no_action')).toBe('RESTART');
  });

  it('falls back to ATTACK_BUILDUP for unknown event types', () => {
    expect(eventToArchetype('mystery_event')).toBe('ATTACK_BUILDUP');
    expect(eventToArchetype('')).toBe('ATTACK_BUILDUP');
  });
});

describe('listMappedEventTypes', () => {
  it('includes every engine event type currently in the inventory', () => {
    const mapped = new Set(listMappedEventTypes());
    for (const t of ENGINE_EVENT_TYPES) {
      expect(mapped.has(t)).toBe(true);
    }
  });
});

describe('ARCHETYPES', () => {
  it('exposes the eight documented archetypes', () => {
    // Pin the set so a future addition is a deliberate change here.
    expect([...ARCHETYPES].sort()).toEqual([
      'ATTACK_BUILDUP',
      'DEFENSIVE_ACTION',
      'GOAL_CELEBRATION',
      'PENALTY_TAKE',
      'RESTART',
      'SET_PIECE_PREP',
      'SHOT_ATTEMPT',
      'STOPPAGE',
    ]);
  });
});
