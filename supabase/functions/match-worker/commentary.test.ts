// ── commentary.test.ts ───────────────────────────────────────────────────────
// Guards the deterministic three-voice commentary layer.
//
// WHY THIS SUITE EXISTS
// `spatialEventAdapter.eventCommentary` held one hardcoded sentence per event
// type as a placeholder for model-generated commentary. With the narrative mode
// deterministic by default, that placeholder IS the broadcast, so a match read
// the same sixteen strings on loop. The replacement is generative, which means
// it can silently decay the same way: a template pool that loses its slots, or
// a bucket added without templates, degrades to repetition without failing any
// behavioural test.
//
// So the variety floor below is the real assertion. It is deliberately per
// `voice:bucket`, not per voice, because a healthy total hides a two-template
// bucket — and the frequent buckets are the ones a fan notices.

import { describe, it, expect } from 'vitest';
import {
  commentaryFor,
  commentaryVariety,
  bucketFor,
  decorateCommentary,
} from './commentary.ts';

const VARS = { player: 'Rix Vanto', other: 'Del Oru', team: 'Mars United', card: 'yellow' };

/** Buckets a fan sees many times per match — these must not repeat. */
const FREQUENT = ['goal', 'shot_saved', 'shot_missed', 'foul', 'foul_card', 'tackle', 'corner', 'offside'];

/** Buckets that occur at most once or twice a match, where a small pool is fine. */
const RARE = ['penalty', 'woodwork', 'save', 'substitution', 'kickoff'];

const ALL = [...FREQUENT, ...RARE];

describe('commentaryFor', () => {
  it('generates a line for every bucket, in one of the three voices', () => {
    for (const bucket of ALL) {
      const line = commentaryFor(bucket, 'match-1', 0, VARS);
      expect(line, bucket).not.toBeNull();
      expect(['vox', 'nexus', 'zara']).toContain(line!.voice);
      expect([1, 2, 3]).toContain(line!.voiceIndex);
      expect(line!.text.length).toBeGreaterThan(8);
    }
  });

  it('is deterministic on (matchId, eventIndex, bucket)', () => {
    for (const bucket of ALL) {
      const a = commentaryFor(bucket, 'match-7', 12, VARS);
      const b = commentaryFor(bucket, 'match-7', 12, VARS);
      expect(a).toEqual(b);
    }
  });

  it('differs across event indices, so a match does not repeat one line', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const line = commentaryFor('foul', 'match-9', i, VARS);
      if (line) seen.add(line.text);
    }
    // 40 fouls in one match is realistic; they must not collapse to a handful.
    expect(seen.size).toBeGreaterThan(12);
  });

  it('substitutes every variable, leaving no raw placeholders', () => {
    for (const bucket of ALL) {
      for (let i = 0; i < 30; i++) {
        const line = commentaryFor(bucket, `m${i}`, i, VARS);
        if (!line) continue;
        expect(line.text, `${bucket}/${i}`).not.toMatch(/<[a-z_]+>/);
        expect(line.text, `${bucket}/${i}`).not.toMatch(/\{[a-z0-9_|]+\}/);
      }
    }
  });

  it('never emits malformed prose', () => {
    // The specific failures this caught while being written: a `verdict` pool
    // whose entries began with "and" sitting behind a template that already
    // supplied the conjunction, producing "and and this match has a new shape",
    // and the same thing again via the `restart` pool.
    for (const bucket of ALL) {
      for (let i = 0; i < 60; i++) {
        const line = commentaryFor(bucket, `seed-${i}`, i, VARS);
        if (!line) continue;
        expect(line.text, line.text).not.toMatch(/\band and\b/i);
        expect(line.text, line.text).not.toMatch(/\bthe the\b/i);
        expect(line.text, line.text).not.toMatch(/\s[,.;:!?]/);
        expect(line.text, line.text).not.toMatch(/\.\./);
        expect(line.text, line.text).not.toMatch(/ {2}/);
      }
    }
  });

  it('starts every sentence with a capital', () => {
    for (const bucket of ALL) {
      for (let i = 0; i < 25; i++) {
        const line = commentaryFor(bucket, `cap-${i}`, i, VARS);
        if (!line) continue;
        expect(line.text[0], line.text).toBe(line.text[0]!.toUpperCase());
      }
    }
  });

  it('returns null for a bucket with no templates', () => {
    expect(commentaryFor('no_such_bucket', 'm', 0, VARS)).toBeNull();
  });
});

describe('variety floor (#565 — the deterministic layer is the product)', () => {
  const variety = commentaryVariety();

  it('covers all three voices across every bucket', () => {
    for (const voice of ['vox', 'nexus', 'zara']) {
      for (const bucket of ALL) {
        expect(variety[`${voice}:${bucket}`], `${voice}:${bucket}`).toBeGreaterThan(0);
      }
    }
  });

  it('gives every frequent bucket at least 40 distinct lines per voice', () => {
    for (const voice of ['vox', 'nexus', 'zara']) {
      for (const bucket of FREQUENT) {
        const n = variety[`${voice}:${bucket}`] ?? 0;
        expect(n, `${voice}:${bucket} has only ${n}`).toBeGreaterThanOrEqual(40);
      }
    }
  });

  it('gives rare buckets at least 4, so even a one-off is not fixed text', () => {
    for (const voice of ['vox', 'nexus', 'zara']) {
      for (const bucket of RARE) {
        const n = variety[`${voice}:${bucket}`] ?? 0;
        expect(n, `${voice}:${bucket} has only ${n}`).toBeGreaterThanOrEqual(4);
      }
    }
  });
});

describe('bucketFor', () => {
  it('splits a shot by whether a keeper reached it', () => {
    expect(bucketFor('shot', { keeper: 'K' })).toBe('shot_saved');
    expect(bucketFor('shot', {})).toBe('shot_missed');
  });

  it('splits a foul by whether a card followed', () => {
    expect(bucketFor('foul', { cardType: 'red' })).toBe('foul_card');
    expect(bucketFor('foul', {})).toBe('foul');
  });

  it('leaves low-signal events unvoiced so the feed stays readable', () => {
    for (const t of ['pass', 'interception', 'out_throw', 'out_goalkick']) {
      expect(bucketFor(t, {}), t).toBeNull();
    }
  });
});

describe('decorateCommentary', () => {
  it('replaces placeholder commentary and attributes the voice', () => {
    const events = [
      { type: 'goal', payload: { commentary: 'Rix Vanto scores for Mars United!', player: 'Rix Vanto', team: 'Mars United' } },
    ];
    decorateCommentary(events, 'match-abc');
    expect(events[0]!.payload['commentary']).not.toBe('Rix Vanto scores for Mars United!');
    expect(events[0]!.payload['voice']).toBeDefined();
    expect(events[0]!.payload['voiceIndex']).toBeDefined();
    expect(String(events[0]!.payload['commentary'])).toContain('Rix Vanto');
  });

  it('leaves unvoiced event types exactly as the adapter wrote them', () => {
    // A sim event type with no bucket must keep its terse sentence rather than
    // losing its commentary entirely — otherwise adding an event type to the
    // engine silently blanks it in the feed.
    const events = [{ type: 'pass', payload: { commentary: 'A player plays the ball forward.' } }];
    decorateCommentary(events, 'match-abc');
    expect(events[0]!.payload['commentary']).toBe('A player plays the ball forward.');
    expect(events[0]!.payload['voice']).toBeUndefined();
  });

  it('falls back to readable names when the scorer could not be resolved', () => {
    // Observed in production: `{"isGoal":true,"commentary":"A player scores for
    // Away!"}` — the player never resolved, so only `side` was present.
    const events = [{ type: 'goal', payload: { commentary: 'x', side: 'away' } }];
    decorateCommentary(events, 'match-abc');
    const text = String(events[0]!.payload['commentary']);
    expect(text).not.toMatch(/undefined|null|<[a-z_]+>/);
    expect(text).toContain('the away side');
  });

  it('is stable across runs for the same match', () => {
    const build = () => [
      { type: 'goal', payload: { commentary: 'x', player: 'A', team: 'T' } },
      { type: 'foul', payload: { commentary: 'y', player: 'B' } },
      { type: 'tackle', payload: { commentary: 'z', player: 'C' } },
    ];
    const a = decorateCommentary(build(), 'match-same');
    const b = decorateCommentary(build(), 'match-same');
    expect(a.map((e) => e.payload['commentary'])).toEqual(b.map((e) => e.payload['commentary']));
  });

  it('gives different matches different broadcasts', () => {
    const build = () => [{ type: 'goal', payload: { commentary: 'x', player: 'A', team: 'T' } }];
    const a = decorateCommentary(build(), 'match-one');
    const b = decorateCommentary(build(), 'match-two');
    // Not a strict inequality assertion on one event — with three voices and a
    // shared pool a collision is possible — but across ten matches they must
    // not all be identical.
    const texts = new Set<string>();
    for (let i = 0; i < 10; i++) {
      texts.add(String(decorateCommentary(build(), `match-${i}`)[0]!.payload['commentary']));
    }
    expect(texts.size).toBeGreaterThan(3);
    expect([a, b]).toHaveLength(2);
  });
});
