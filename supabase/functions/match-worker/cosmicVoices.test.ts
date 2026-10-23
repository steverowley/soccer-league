// ── cosmicVoices.test.ts ─────────────────────────────────────────────────────
// Balance and Chaos, the two cosmic voices (#686).
//
// They had never spoken. The engine was complete, migration 0011 seeded their
// entities, the types modelled their output, and nothing constructed them:
// `CosmicVoiceEngine`'s only consumer was `AgentSystem`, which is never
// constructed, and the spatial engine the worker actually runs had no
// cosmic-voice code at all.
//
// Two things this suite is really guarding:
//
//  1. THEY SPEAK. A stateful engine behind an interest threshold, a speech-roll
//     probability, a minimum gap and a per-match cap can silently never fire.
//     "No output" is indistinguishable from "not wired up" unless asserted.
//  2. THEY ARE DETERMINISTIC. The browser engine used `Math.random` in six
//     places, so a replay would have differed from the original every time,
//     breaking the invariant that a fixture is a fixed record.

import { describe, expect, it } from 'vitest';
import {
  cosmicInterjections,
  cosmicVoiceVariety,
  CosmicVoiceEngine,
  BALANCE_ENTITY_ID,
  CHAOS_ENTITY_ID,
  type VoicedInterjection,
} from './cosmicVoices.ts';
import { rngFor } from './grammar.ts';

/** A plausible 90-minute stream of notable beats, post significance-filter. */
function matchStream(): VoicedInterjection[] {
  const out: VoicedInterjection[] = [];
  out.push({ minute: 0, subminute: 0, type: 'kickoff', payload: {} });
  for (let m = 3; m < 90; m += 3) {
    const kind = m % 21 === 0 ? 'goal' : m % 12 === 0 ? 'foul' : m % 9 === 0 ? 'save' : 'out_corner';
    out.push({
      minute: m,
      subminute: (m % 7) / 10,
      type: kind,
      payload: {
        ...(kind === 'goal' ? { isGoal: true, side: m % 42 === 0 ? 'away' : 'home' } : {}),
        ...(kind === 'foul' ? { cardType: 'yellow' } : {}),
        player: 'Rix Vanto',
      },
    });
  }
  return out;
}

describe('cosmicInterjections', () => {
  it('actually speaks during a normal match', () => {
    // The whole point of #686. If this returns an empty array the voices are
    // mute again, whatever the rest of the suite says.
    const lines = cosmicInterjections(matchStream(), 'match-alpha');
    expect(lines.length).toBeGreaterThan(0);
  });

  it('speaks across many matches without ever being silent in all of them', () => {
    let spoke = 0;
    for (let i = 0; i < 30; i++) {
      if (cosmicInterjections(matchStream(), `match-${i}`).length > 0) spoke++;
    }
    // The cadence is deliberately sparse and interest-gated, so a given match
    // can be silent. Most should not be.
    expect(spoke).toBeGreaterThan(15);
  });

  it('respects the per-match speech cap', () => {
    // MIN/MAX_SPEECHES_PER_MATCH bound each voice, so two voices can never
    // produce an unbounded flood no matter how eventful the match.
    for (let i = 0; i < 20; i++) {
      const lines = cosmicInterjections(matchStream(), `cap-${i}`);
      expect(lines.length).toBeLessThanOrEqual(12);
    }
  });

  it('is deterministic for a given match id', () => {
    const a = cosmicInterjections(matchStream(), 'match-fixed');
    const b = cosmicInterjections(matchStream(), 'match-fixed');
    expect(a).toEqual(b);
  });

  it('differs between matches', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      seen.add(JSON.stringify(cosmicInterjections(matchStream(), `vary-${i}`)));
    }
    expect(seen.size).toBeGreaterThan(4);
  });

  it('emits rows the feed and the frontend can consume', () => {
    const lines = cosmicInterjections(matchStream(), 'match-shape');
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      expect(l.type).toBe('cosmic_voice');
      expect(['balance', 'chaos']).toContain(l.payload['voice']);
      expect([2, 3]).toContain(l.payload['voiceIndex']);
      // Deliberately permissive on length: Chaos is laconic by design and its
      // bank includes single words ("More.", "Wrong."). Assert the line is real
      // prose rather than long.
      const text = String(l.payload['commentary']);
      expect(text.trim().length).toBeGreaterThan(3);
      expect(text).toMatch(/[A-Za-z]/);
      // entityId must be one of the two UUIDs migration 0011 seeded, so the
      // line can be attributed in entities_involved.
      expect([BALANCE_ENTITY_ID, CHAOS_ENTITY_ID]).toContain(l.payload['entityId']);
      expect(l.subminute).toBeGreaterThanOrEqual(0);
      expect(l.subminute).toBeLessThanOrEqual(0.999);
      expect(l.minute).toBeGreaterThanOrEqual(0);
    }
  });

  it('never leaves an unsubstituted template marker in a line', () => {
    for (let i = 0; i < 20; i++) {
      for (const l of cosmicInterjections(matchStream(), `clean-${i}`)) {
        const text = String(l.payload['commentary']);
        expect(text).not.toMatch(/\{[a-z0-9_|]+\}/);
        expect(text).not.toMatch(/<[a-z0-9_]+>/);
        expect(text).not.toMatch(/undefined|null/);
      }
    }
  });

  it('keeps interjections sortable inside the minute they react to', () => {
    const stream = matchStream();
    const lines = cosmicInterjections(stream, 'match-order');
    for (const l of lines) {
      const trigger = stream.find((e) => e.minute === l.minute);
      expect(trigger, `no event at minute ${l.minute}`).toBeDefined();
      // The line must land at or after its trigger so it reads as a reaction.
      expect(l.subminute).toBeGreaterThanOrEqual(trigger!.subminute);
    }
  });

  it('returns nothing for an empty match rather than throwing', () => {
    expect(cosmicInterjections([], 'match-empty')).toEqual([]);
  });
});

describe('CosmicVoiceEngine determinism', () => {
  it('produces identical output for the same seed', () => {
    const run = () => {
      const engine = new CosmicVoiceEngine(rngFor('seed:abc'));
      const out: string[] = [];
      for (let m = 1; m <= 90; m++) {
        for (const item of engine.maybeInterrupt({ type: 'foul' }, m, 1, 0)) out.push(item.text);
      }
      return out;
    };
    expect(run()).toEqual(run());
  });

  it('produces different output for different seeds', () => {
    const run = (seed: string) => {
      const engine = new CosmicVoiceEngine(rngFor(seed));
      const out: string[] = [];
      for (let m = 1; m <= 90; m++) {
        for (const item of engine.maybeInterrupt({ type: 'goal', isGoal: true }, m, 3, 0)) {
          out.push(item.text);
        }
      }
      return out;
    };
    const seeds = ['s1', 's2', 's3', 's4', 's5'].map(run).map((x) => JSON.stringify(x));
    expect(new Set(seeds).size).toBeGreaterThan(1);
  });
});

describe('variety floor', () => {
  const variety = cosmicVoiceVariety();

  it('has lines in every register', () => {
    for (const [register, n] of Object.entries(variety)) {
      expect(n, register).toBeGreaterThan(0);
    }
  });

  it('gives each register enough lines to not repeat within a season', () => {
    // These are fixed strings rather than grammar templates, so the floor is
    // lower than the commentary layer's — but a register with two entries would
    // be recognisable as canned within a handful of matches.
    for (const [register, n] of Object.entries(variety)) {
      expect(n, `${register} has only ${n}`).toBeGreaterThanOrEqual(5);
    }
  });
});
