// ── interferenceResolver.test.ts ─────────────────────────────────────────
// Tests for the pure curse/bless post-pass (#428 slice 1).
//
// All tests inject a deterministic RNG so probability rolls are
// reproducible — the resolver itself stays pure and the test reads
// like a state-machine spec.

import { describe, expect, it } from 'vitest';
import {
  applyAnnulGoals,
  applyForceRedCards,
  resolveInterference,
  resolveInterferenceStream,
  type AnnulGoalIntent,
  type ForceRedCardIntent,
  type InterferenceContext,
  type InterferenceEffect,
} from './interferenceResolver';
import type { SimulatedEvent } from './simulateFullMatch';

/**
 * Factory for a baseline goal event by `player` at `minute`. Keeps
 * the test bodies focused on the curse/bless behaviour rather than
 * payload boilerplate.
 */
function goalBy(player: string, minute = 30): SimulatedEvent {
  return {
    minute,
    subminute: 0,
    type:      'goal',
    payload:   { player, isGoal: true, team: 'HOME' },
  };
}

/**
 * Factory for a missed-shot event. `isGoal:false` mirrors what
 * gameEngine emits when a shot is off-target / saved / blocked.
 */
function shotBy(player: string, minute = 30): SimulatedEvent {
  return {
    minute,
    subminute: 0,
    type:      'shot',
    payload:   { player, isGoal: false, team: 'HOME' },
  };
}

const noEffects: InterferenceContext = { curses: [], blesses: [] };

/**
 * RNG that always returns `value`. Useful for forcing the firing
 * branch (value < magnitude * 0.1) or the no-fire branch (value
 * above the threshold).
 */
const constantRng = (value: number) => () => value;

describe('resolveInterference — passthrough', () => {
  it('returns the event unchanged when no effects are active', () => {
    const ev = goalBy('Kael Vorn');
    const out = resolveInterference(ev, noEffects, constantRng(0));
    expect(out).toBe(ev);
  });

  it('returns the event unchanged when the event has no player', () => {
    const ev: SimulatedEvent = {
      minute: 30, subminute: 0, type: 'kickoff', payload: {},
    };
    const ctx: InterferenceContext = {
      curses:  [{ playerName: 'Anyone', magnitude: 10, startMin: 1 }],
      blesses: [],
    };
    expect(resolveInterference(ev, ctx, constantRng(0))).toBe(ev);
  });

  it('returns the event unchanged when the cursed name does not match', () => {
    const ev = goalBy('Kael Vorn');
    const ctx: InterferenceContext = {
      curses:  [{ playerName: 'Different Player', magnitude: 10, startMin: 1 }],
      blesses: [],
    };
    // RNG=0 would force-fire if names matched.
    expect(resolveInterference(ev, ctx, constantRng(0))).toBe(ev);
  });
});

describe('resolveInterference — curse_player', () => {
  const curse: InterferenceEffect = {
    playerName: 'Kael Vorn',
    magnitude:  5,            // 50% firing chance
    startMin:   10,
  };
  const ctx: InterferenceContext = { curses: [curse], blesses: [] };

  it('annuls a goal when the RNG roll lands under magnitude * 0.1', () => {
    const ev = goalBy('Kael Vorn', 30);
    // 0.4 < 0.5 → fires
    const out = resolveInterference(ev, ctx, constantRng(0.4));
    expect(out.type).toBe('shot');
    expect(out.payload['isGoal']).toBe(false);
    expect(out.payload['interferenceApplied']).toBe('curse');
    expect(out.payload['interferenceMagnitude']).toBe(5);
  });

  it('leaves the goal intact when the roll lands over the threshold', () => {
    const ev = goalBy('Kael Vorn', 30);
    // 0.6 > 0.5 → does not fire
    const out = resolveInterference(ev, ctx, constantRng(0.6));
    expect(out).toBe(ev);
  });

  it('matches names case-insensitively', () => {
    const ev = goalBy('kael vorn', 30);
    const out = resolveInterference(ev, ctx, constantRng(0));
    expect(out.payload['interferenceApplied']).toBe('curse');
  });

  it('does not fire on events earlier than startMin', () => {
    const ev = goalBy('Kael Vorn', 5);       // before startMin=10
    const out = resolveInterference(ev, ctx, constantRng(0));
    expect(out).toBe(ev);
  });

  it('does not fire on non-goal events (e.g. saved shots)', () => {
    const ev = shotBy('Kael Vorn', 30);
    const out = resolveInterference(ev, ctx, constantRng(0));
    expect(out).toBe(ev);
  });

  it('uses the strongest matching effect when multiple curses target one player', () => {
    const stacked: InterferenceContext = {
      curses: [
        { playerName: 'Kael Vorn', magnitude: 2, startMin: 1 },  // weak
        { playerName: 'Kael Vorn', magnitude: 9, startMin: 5 },  // strongest
      ],
      blesses: [],
    };
    const ev = goalBy('Kael Vorn', 30);
    // 0.85 < 0.9 → fires only if magnitude=9 is the one selected.
    const out = resolveInterference(ev, stacked, constantRng(0.85));
    expect(out.payload['interferenceApplied']).toBe('curse');
    expect(out.payload['interferenceMagnitude']).toBe(9);
  });
});

describe('resolveInterference — bless_player', () => {
  const bless: InterferenceEffect = {
    playerName: 'Aiya Tek',
    magnitude:  7,            // 70% firing chance
    startMin:   1,
  };
  const ctx: InterferenceContext = { curses: [], blesses: [bless] };

  it('upgrades a missed shot to a goal when the roll fires', () => {
    const ev = shotBy('Aiya Tek', 30);
    // 0.5 < 0.7 → fires
    const out = resolveInterference(ev, ctx, constantRng(0.5));
    expect(out.type).toBe('goal');
    expect(out.payload['isGoal']).toBe(true);
    expect(out.payload['interferenceApplied']).toBe('bless');
    expect(out.payload['interferenceMagnitude']).toBe(7);
  });

  it('does not upgrade when the roll misses the threshold', () => {
    const ev = shotBy('Aiya Tek', 30);
    // 0.8 > 0.7 → no fire
    const out = resolveInterference(ev, ctx, constantRng(0.8));
    expect(out).toBe(ev);
  });

  it('does not target events that are already goals', () => {
    const ev = goalBy('Aiya Tek', 30);  // already isGoal=true
    const out = resolveInterference(ev, ctx, constantRng(0));
    expect(out).toBe(ev);
  });
});

describe('resolveInterference — curse precedence', () => {
  it('a player who is both cursed and blessed gets cursed (the harder outcome)', () => {
    const ctx: InterferenceContext = {
      curses:  [{ playerName: 'Twice Touched', magnitude: 8, startMin: 1 }],
      blesses: [{ playerName: 'Twice Touched', magnitude: 8, startMin: 1 }],
    };
    const ev = goalBy('Twice Touched', 30);
    // RNG=0 fires both branches if checked — but curse is evaluated
    // first and short-circuits.
    const out = resolveInterference(ev, ctx, constantRng(0));
    expect(out.payload['interferenceApplied']).toBe('curse');
  });
});

// ── #428 slice 3: annul_goal one-shot stream pass ────────────────────────

describe('applyAnnulGoals', () => {
  /**
   * Build a goal event with the team/minute/player baked in. Tests
   * stay focused on the annul mechanic rather than payload setup.
   */
  function goalAt(team: string, minute: number, player = 'Scorer'): SimulatedEvent {
    return {
      minute,
      subminute: 0,
      type:      'goal',
      payload:   { team, player, isGoal: true },
    };
  }

  it('no-op when intents array is empty (returns input by reference)', () => {
    const events = [goalAt('HOME', 30)];
    const out = applyAnnulGoals(events, [], constantRng(0));
    expect(out).toBe(events);
  });

  it('annuls the first matching goal at or after intent.minute', () => {
    const events: SimulatedEvent[] = [
      goalAt('HOME', 10),    // earlier than intent — skipped
      goalAt('AWAY', 40),    // wrong team — skipped
      goalAt('HOME', 50),    // matches → annulled
      goalAt('HOME', 70),    // matches but intent already consumed
    ];
    const intents: AnnulGoalIntent[] = [
      { team: 'HOME', minute: 40, magnitude: 10 },
    ];

    const out = applyAnnulGoals(events, intents, constantRng(0));
    expect(out).toHaveLength(4);
    expect(out[0]).toBe(events[0]);                        // unchanged
    expect(out[1]).toBe(events[1]);                        // unchanged
    expect(out[2]?.payload['interferenceApplied']).toBe('annul_goal');
    expect(out[2]?.payload['isGoal']).toBe(false);
    expect(out[2]?.type).toBe('shot');
    expect(out[3]).toBe(events[3]);                        // not consumed
  });

  it('does not fire when the probability roll lands over the threshold', () => {
    const events = [goalAt('HOME', 30)];
    const intents: AnnulGoalIntent[] = [
      { team: 'HOME', minute: 25, magnitude: 5 },         // 50% threshold
    ];
    // 0.6 > 0.5 → no fire
    const out = applyAnnulGoals(events, intents, constantRng(0.6));
    expect(out[0]).toBe(events[0]);
  });

  it('two intents consume two distinct goals, in input order', () => {
    const events: SimulatedEvent[] = [
      goalAt('HOME', 20),
      goalAt('HOME', 40),
      goalAt('HOME', 60),
    ];
    const intents: AnnulGoalIntent[] = [
      { team: 'HOME', minute: 0,  magnitude: 10 },        // takes 20'
      { team: 'HOME', minute: 30, magnitude: 10 },        // takes 40'
    ];
    const out = applyAnnulGoals(events, intents, constantRng(0));
    expect(out[0]?.payload['interferenceApplied']).toBe('annul_goal');
    expect(out[1]?.payload['interferenceApplied']).toBe('annul_goal');
    expect(out[2]?.payload['isGoal']).toBe(true);          // untouched
  });

  it('a magnitude-0 intent never fires', () => {
    const events = [goalAt('HOME', 30)];
    const intents: AnnulGoalIntent[] = [
      { team: 'HOME', minute: 0, magnitude: 0 },
    ];
    // RNG=0 would force-fire if magnitude were > 0; with mag=0 the
    // threshold is 0, and `random() >= 0` is true → no fire.
    const out = applyAnnulGoals(events, intents, constantRng(0));
    expect(out[0]).toBe(events[0]);
  });

  it('skips non-goal events even when team/minute would match', () => {
    const events: SimulatedEvent[] = [
      { minute: 30, subminute: 0, type: 'shot',
        payload: { team: 'HOME', player: 'Scorer', isGoal: false } },
    ];
    const intents: AnnulGoalIntent[] = [
      { team: 'HOME', minute: 0, magnitude: 10 },
    ];
    const out = applyAnnulGoals(events, intents, constantRng(0));
    expect(out[0]).toBe(events[0]);
  });
});

// ── #428 slice 5: force_red_card one-shot stream pass ────────────────────

describe('applyForceRedCards', () => {
  /**
   * Build a card-able event (default 'foul') by `player` at `minute`.
   */
  function foulBy(
    player: string,
    minute = 30,
    type: string = 'foul',
  ): SimulatedEvent {
    return {
      minute,
      subminute: 0,
      type,
      payload:   { player, team: 'HOME' },
    };
  }

  it('no-op when intents array is empty (returns input by reference)', () => {
    const events = [foulBy('Twin Vex')];
    expect(applyForceRedCards(events, [], constantRng(0))).toBe(events);
  });

  it('promotes the first card-able event by the target player at/after minute', () => {
    const events: SimulatedEvent[] = [
      foulBy('Twin Vex',    10),                  // before intent — skipped
      foulBy('Other Player',40),                  // wrong player — skipped
      foulBy('Twin Vex',    50),                  // matches → promoted
      foulBy('Twin Vex',    70),                  // intent already consumed
    ];
    const intents: ForceRedCardIntent[] = [
      { playerName: 'Twin Vex', minute: 40, magnitude: 10 },
    ];
    const out = applyForceRedCards(events, intents, constantRng(0));
    expect(out[2]?.payload['cardType']).toBe('red');
    expect(out[2]?.payload['interferenceApplied']).toBe('force_red_card');
    expect(out[2]?.payload['interferenceMagnitude']).toBe(10);
    expect(out[3]).toBe(events[3]);              // unchanged
  });

  it('matches the target player case-insensitively', () => {
    const events = [foulBy('Twin Vex', 30)];
    const intents: ForceRedCardIntent[] = [
      { playerName: 'TWIN VEX', minute: 0, magnitude: 10 },
    ];
    const out = applyForceRedCards(events, intents, constantRng(0));
    expect(out[0]?.payload['cardType']).toBe('red');
  });

  it('only fires on the whitelisted card-able event types (foul / tackle / dive)', () => {
    const events: SimulatedEvent[] = [
      foulBy('Twin Vex', 30, 'shot'),             // shot not card-able
      foulBy('Twin Vex', 31, 'tackle'),           // tackle IS card-able
    ];
    const intents: ForceRedCardIntent[] = [
      { playerName: 'Twin Vex', minute: 0, magnitude: 10 },
    ];
    const out = applyForceRedCards(events, intents, constantRng(0));
    expect(out[0]).toBe(events[0]);              // shot untouched
    expect(out[1]?.payload['cardType']).toBe('red');
  });

  it('fizzles silently when the target never has a card-able event', () => {
    const events = [foulBy('Different Player', 30)];
    const intents: ForceRedCardIntent[] = [
      { playerName: 'Twin Vex', minute: 0, magnitude: 10 },
    ];
    // No mutation, no thrown error — intent simply doesn't land.
    expect(applyForceRedCards(events, intents, constantRng(0))).toEqual(events);
  });

  it('skips events that already carry a red card', () => {
    const alreadyRed: SimulatedEvent = {
      minute: 30, subminute: 0, type: 'foul',
      payload: { player: 'Twin Vex', cardType: 'red' },
    };
    const followUpFoul = foulBy('Twin Vex', 35);
    const events = [alreadyRed, followUpFoul];
    const intents: ForceRedCardIntent[] = [
      { playerName: 'Twin Vex', minute: 0, magnitude: 10 },
    ];
    const out = applyForceRedCards(events, intents, constantRng(0));
    // alreadyRed event passes through unchanged; the follow-up foul
    // is what gets promoted.
    expect(out[0]).toBe(events[0]);
    expect(out[1]?.payload['cardType']).toBe('red');
    expect(out[1]?.payload['interferenceApplied']).toBe('force_red_card');
  });

  it('does not fire when the probability roll misses the threshold', () => {
    const events = [foulBy('Twin Vex', 30)];
    const intents: ForceRedCardIntent[] = [
      { playerName: 'Twin Vex', minute: 0, magnitude: 5 },  // 50%
    ];
    // 0.7 > 0.5 → no fire
    const out = applyForceRedCards(events, intents, constantRng(0.7));
    expect(out[0]).toBe(events[0]);
  });

  it('two intents consume two distinct card-able events, in input order', () => {
    const events: SimulatedEvent[] = [
      foulBy('Twin Vex', 20),
      foulBy('Twin Vex', 40, 'tackle'),
      foulBy('Twin Vex', 60),
    ];
    const intents: ForceRedCardIntent[] = [
      { playerName: 'Twin Vex', minute: 0,  magnitude: 10 },  // takes 20'
      { playerName: 'Twin Vex', minute: 30, magnitude: 10 },  // takes 40'
    ];
    const out = applyForceRedCards(events, intents, constantRng(0));
    expect(out[0]?.payload['cardType']).toBe('red');
    expect(out[1]?.payload['cardType']).toBe('red');
    expect(out[2]?.payload['cardType']).toBeUndefined();      // untouched
  });
});

describe('resolveInterferenceStream', () => {
  it('preserves order and only mutates the matching events', () => {
    const ctx: InterferenceContext = {
      curses:  [{ playerName: 'Cursed One', magnitude: 10, startMin: 1 }],
      blesses: [],
    };
    const events: SimulatedEvent[] = [
      goalBy('Other Player', 10),
      goalBy('Cursed One',  20),
      shotBy('Cursed One',  30),
      goalBy('Cursed One',  40),
    ];
    // RNG always returns 0 so every curse roll fires.
    const out = resolveInterferenceStream(events, ctx, constantRng(0));
    expect(out).toHaveLength(4);
    expect(out[0]).toBe(events[0]);                      // unaffected
    expect(out[1]?.payload['interferenceApplied']).toBe('curse');
    expect(out[2]).toBe(events[2]);                      // not a goal, unaffected
    expect(out[3]?.payload['interferenceApplied']).toBe('curse');
  });
});
