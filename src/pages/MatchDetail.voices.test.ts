// ── MatchDetail.voices.test.ts ───────────────────────────────────────────────
// The commentary feed's attribution layer.
//
// The match worker generates each commentary line in one of three deterministic
// commentator voices and stamps `payload.voice`. Before this, the feed rendered
// every line identically and bylined it with the event type, so a Captain Vox
// goal call was labelled "Goal" — which tells a fan nothing the scoreboard has
// not already told them, and threw away the attribution the worker produced.
//
// These are pure functions over a jsonb payload, so they are testable without a
// browser — which matters, because the backend is unreachable and the visual
// result cannot be checked by clicking.

import { describe, expect, it } from 'vitest';
import { eventVoice, eventHeading, cosmicVoice } from './MatchDetail';
import type { MatchEventRow } from '../features/match';

function row(payload: Record<string, unknown>, type = 'goal'): MatchEventRow {
  return {
    id: 'e1',
    match_id: 'm1',
    minute: 42,
    subminute: 0.1,
    type,
    payload,
    created_at: '2026-01-01T00:00:00Z',
  } as unknown as MatchEventRow;
}

describe('eventVoice', () => {
  it('resolves each of the three commentators', () => {
    expect(eventVoice(row({ voice: 'vox' }))?.name).toBe('Captain Vox');
    expect(eventVoice(row({ voice: 'nexus' }))?.name).toBe('Nexus-7');
    expect(eventVoice(row({ voice: 'zara' }))?.name).toBe('Zara Bloom');
  });

  it('tells the voices apart by name and role, not colour (design language)', () => {
    const voices = ['vox', 'nexus', 'zara'].map((v) => eventVoice(row({ voice: v })));
    expect(new Set(voices.map((v) => v?.name)).size).toBe(3);
    expect(voices.map((v) => v?.role)).toEqual(['Play-by-play', 'AI analyst', 'Colour analyst']);
    // The retired accent colours (#FFD700 gold, #4FC3F7 cyan) are gone.
    for (const v of voices) expect(v).not.toHaveProperty('color');
  });

  it('returns null for an unvoiced event', () => {
    // Low-signal event types (passes, throw-ins) are deliberately left unvoiced
    // by the worker and must keep the plain event-type byline.
    expect(eventVoice(row({}, 'pass'))).toBeNull();
    expect(eventVoice(row({ commentary: 'Goal kick.' }, 'out_goalkick'))).toBeNull();
  });

  it('returns null rather than throwing on a malformed payload', () => {
    // payload is jsonb — anything can be in there, including rows written by an
    // older worker build that predates attribution.
    expect(eventVoice(row({ voice: 42 }))).toBeNull();
    expect(eventVoice(row({ voice: null }))).toBeNull();
    expect(eventVoice(row({ voice: 'who_is_this' }))).toBeNull();
    expect(eventVoice({ ...row({}), payload: null } as unknown as MatchEventRow)).toBeNull();
  });
});

describe('eventHeading', () => {
  it('bylines a voiced line with the commentator, not the event type', () => {
    expect(eventHeading(row({ voice: 'vox' }, 'goal'))).toBe('Captain Vox');
    expect(eventHeading(row({ voice: 'zara' }, 'foul'))).toBe('Zara Bloom');
  });

  it('keeps the Architect byline, which outranks any voice', () => {
    // An architect-interference row must never be attributed to a commentator:
    // nobody in-world knows the Architect exists, and the purple treatment is
    // the cue that something is off.
    expect(eventHeading(row({ voice: 'vox' }, 'architect_interference'))).toBe('The Architect');
  });

  it('falls back to the prettified event type when unvoiced', () => {
    expect(eventHeading(row({}, 'out_corner'))).not.toBe('');
    expect(eventHeading(row({}, 'out_corner'))).not.toMatch(/_/);
  });
});

describe('cosmicVoice', () => {
  // Balance and Chaos share the Architect tone (spec section 4), so their
  // bylines are what tell them apart, as in the spec's specimen
  // ("Chaos · Cosmic voice").
  it('bylines Balance and Chaos by name, as cosmic voices', () => {
    expect(cosmicVoice(row({ voice: 'balance' }, 'cosmic_voice'))).toEqual({ name: 'Balance', role: 'Cosmic voice' });
    expect(cosmicVoice(row({ voice: 'chaos' }, 'cosmic_voice'))).toEqual({ name: 'Chaos', role: 'Cosmic voice' });
    expect(eventHeading(row({ voice: 'balance' }, 'cosmic_voice'))).toBe('Balance');
    expect(eventHeading(row({ voice: 'chaos' }, 'cosmic_voice'))).toBe('Chaos');
  });

  it('only applies to cosmic_voice rows', () => {
    // A commentator voice must not be mistaken for a cosmic one.
    expect(cosmicVoice(row({ voice: 'vox' }, 'goal'))).toBeNull();
    expect(cosmicVoice(row({ voice: 'balance' }, 'goal'))).toBeNull();
    expect(cosmicVoice(row({ voice: 'vox' }, 'cosmic_voice'))).toBeNull();
    expect(cosmicVoice({ ...row({}, 'cosmic_voice'), payload: null } as unknown as MatchEventRow)).toBeNull();
  });

  it('does not let a cosmic row borrow a commentator name', () => {
    expect(eventVoice(row({ voice: 'vox' }, 'cosmic_voice'))?.name).toBe('Captain Vox');
    // ...but the cosmic byline wins in the heading:
    expect(eventHeading(row({ voice: 'balance' }, 'cosmic_voice'))).toBe('Balance');
  });
});

