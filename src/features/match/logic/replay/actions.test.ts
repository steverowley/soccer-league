// ── actions.test.ts ────────────────────────────────────────────────────────
// The action-track lookup the viewer uses every frame.

import { describe, expect, it } from 'vitest';
import { actionsBetween, firstActionAtOrAfter, type ActionTrack } from './actions';

const track: ActionTrack = {
  dtSec: 0.1,
  actions: [
    { kind: 'kick', tick: 10, by: 3, kick: 'pass' },
    { kind: 'kick', tick: 25, by: 5, kick: 'cross' },
    { kind: 'foul', tick: 25, by: 14, on: 5, card: 'yellow' },
    { kind: 'restart', tick: 26, restart: 'freekick', by: 5, x: 70, y: 20, readyTick: 326 },
    { kind: 'kick', tick: 326, by: 5, kick: 'freekick' },
  ],
};

describe('firstActionAtOrAfter', () => {
  it('finds the first action at or after a tick', () => {
    expect(firstActionAtOrAfter(track, 0)).toBe(0);
    expect(firstActionAtOrAfter(track, 11)).toBe(1);
    expect(firstActionAtOrAfter(track, 25)).toBe(1);
    expect(firstActionAtOrAfter(track, 400)).toBe(5);
  });
});

describe('actionsBetween', () => {
  it('returns the actions inside a window of game seconds, inclusive', () => {
    expect(actionsBetween(track, 2.5, 2.6).map((a) => a.kind)).toEqual(['kick', 'foul', 'restart']);
  });

  it('is empty for a window with no actions or a reversed window', () => {
    expect(actionsBetween(track, 3, 30)).toEqual([]);
    expect(actionsBetween(track, 5, 1)).toEqual([]);
  });

  it('includes both ends exactly despite float seconds', () => {
    expect(actionsBetween(track, 1.0, 1.0)).toHaveLength(1);
    expect(actionsBetween(track, 32.6, 32.6)).toHaveLength(1);
  });
});
