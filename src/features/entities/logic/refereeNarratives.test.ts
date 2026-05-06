// ── refereeNarratives.test.ts ─────────────────────────────────────────────────
// Tests for officiating-pattern detection, voice assignment, and template
// assembly.  These pure-logic guarantees stop accidental drift between the
// pattern thresholds and the news-feed routing/colour expectations.

import { describe, it, expect } from 'vitest';
import {
  STRICT_THRESHOLD,
  LENIENT_THRESHOLD,
  HEAVY_CARD_THRESHOLD,
  detectRefereePattern,
  pickRefereeNarrativeVoice,
  buildRefereeNarrative,
  type RefereeMatchSnapshot,
} from './refereeNarratives';

// ── Snapshot factory ─────────────────────────────────────────────────────────
function snap(overrides: Partial<RefereeMatchSnapshot> = {}): RefereeMatchSnapshot {
  return {
    refereeName: 'Orion Blackwood',
    refereeStrictness: 5,
    yellowCards: 0,
    redCards: 0,
    ...overrides,
  };
}

describe('detectRefereePattern', () => {
  it('flags any red card as controversial regardless of strictness', () => {
    expect(detectRefereePattern(snap({ redCards: 1, refereeStrictness: 1 })))
      .toBe('controversial');
  });

  it('flags strict ref + heavy cards as controversial', () => {
    expect(detectRefereePattern(snap({
      refereeStrictness: STRICT_THRESHOLD,
      yellowCards: HEAVY_CARD_THRESHOLD,
    }))).toBe('controversial');
  });

  it('flags strict ref + at least one yellow as heavy_handed', () => {
    expect(detectRefereePattern(snap({
      refereeStrictness: STRICT_THRESHOLD,
      yellowCards: 1,
    }))).toBe('heavy_handed');
  });

  it('flags lenient ref + zero cards as permissive', () => {
    expect(detectRefereePattern(snap({
      refereeStrictness: LENIENT_THRESHOLD,
      yellowCards: 0,
      redCards: 0,
    }))).toBe('permissive');
  });

  it('falls back to unremarkable for medium-strictness clean matches', () => {
    expect(detectRefereePattern(snap({
      refereeStrictness: 5,
      yellowCards: 0,
    }))).toBe('unremarkable');
  });
});

describe('pickRefereeNarrativeVoice', () => {
  it('routes controversial through Chaos (voice 3)', () => {
    expect(pickRefereeNarrativeVoice('controversial')).toBe(3);
  });

  it('routes heavy_handed through Press (voice 4)', () => {
    expect(pickRefereeNarrativeVoice('heavy_handed')).toBe(4);
  });

  it('routes permissive through Press (voice 4)', () => {
    expect(pickRefereeNarrativeVoice('permissive')).toBe(4);
  });

  it('routes unremarkable through Press (voice 4)', () => {
    expect(pickRefereeNarrativeVoice('unremarkable')).toBe(4);
  });
});

describe('buildRefereeNarrative', () => {
  it('always produces non-empty output for valid snapshots', () => {
    const out = buildRefereeNarrative(snap({ redCards: 1 }), () => 0);
    expect(out.length).toBeGreaterThan(0);
  });

  it('includes the referee name in the line', () => {
    const out = buildRefereeNarrative(snap({ refereeName: 'Vega Castellano', redCards: 1 }), () => 0);
    expect(out).toContain('Vega Castellano');
  });

  it('is deterministic with a fixed RNG', () => {
    const a = buildRefereeNarrative(snap({ redCards: 2, yellowCards: 4 }), () => 0.5);
    const b = buildRefereeNarrative(snap({ redCards: 2, yellowCards: 4 }), () => 0.5);
    expect(a).toBe(b);
  });
});
