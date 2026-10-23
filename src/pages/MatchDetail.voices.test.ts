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
import { eventVoice, eventHeading } from './MatchDetail';
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

  it('gives each voice a distinct accent colour', () => {
    const colours = ['vox', 'nexus', 'zara'].map((v) => eventVoice(row({ voice: v }))?.color);
    expect(new Set(colours).size).toBe(3);
    for (const c of colours) expect(c).toMatch(/^#[0-9A-Fa-f]{6}$/);
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
