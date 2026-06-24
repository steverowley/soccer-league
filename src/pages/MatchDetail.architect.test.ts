// ── MatchDetail.architect.test.ts ────────────────────────────────────────────
// #570: the Cosmic Architect's in-match interference must surface in the live
// match feed (and the replay timeline), not only later in /news. Architect
// interference reaches `match_events` as `type: 'architect_interference'` rows
// whose prose lives in `payload.proclamation` — these unit-test the pure
// classifiers behind the commentary feed + timeline so a cosmic beat is styled
// as cosmic and shows the Architect's actual words, never a bare type label.

import { describe, expect, it } from 'vitest';

import { isArchitectEvent, eventProse, classifyTimelineEvent } from './MatchDetail';
import type { MatchEventRow } from '../features/match';

// Minimal event-row factory — only the fields the classifiers read.
const ev = (over: Partial<MatchEventRow>): MatchEventRow =>
  ({ id: '1', match_id: 'm', minute: 45, subminute: 0, type: 'goal', payload: {}, ...over }) as MatchEventRow;

describe('Architect beats in the live match feed (#570)', () => {
  it('treats a first-class architect_interference event as cosmic', () => {
    const e = ev({ type: 'architect_interference', payload: { proclamation: 'The void stirs.' } });
    expect(isArchitectEvent(e)).toBe(true);
    expect(classifyTimelineEvent(e)).toBe('arch');
  });

  it('still recognises a mechanically-rewritten event via the legacy flags', () => {
    expect(isArchitectEvent(ev({ type: 'goal', payload: { architectConjured: true } }))).toBe(true);
  });

  it('surfaces the Architect proclamation prose, not just the type label', () => {
    expect(
      eventProse(ev({ type: 'architect_interference', payload: { proclamation: 'Gravity forgets itself.' } })),
    ).toBe('Gravity forgets itself.');
  });

  it('keeps booth commentary winning for ordinary events', () => {
    expect(eventProse(ev({ type: 'goal', payload: { commentary: 'What a strike!' } }))).toBe('What a strike!');
  });

  it('leaves an ordinary event neutral with no architect prose', () => {
    expect(isArchitectEvent(ev({ type: 'goal', payload: {} }))).toBe(false);
    expect(classifyTimelineEvent(ev({ type: 'goal', payload: { isGoal: true } }))).toBe('goal');
    expect(eventProse(ev({ type: 'save', payload: {} }))).toBeNull();
  });
});
