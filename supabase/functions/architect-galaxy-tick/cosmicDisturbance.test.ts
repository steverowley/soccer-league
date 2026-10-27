// ── cosmicDisturbance.test.ts ──────────────────────────────────────────────
// The public Architect story must be in-world (no machine text, no date)
// and each intervention is announced once.  See cosmicDisturbance.ts.

import { describe, expect, it } from 'vitest';
import {
  cosmicDisturbanceText,
  pickUnannounced,
  type DisturbanceSource,
} from './cosmicDisturbance.ts';

const row = (id: string, at: string, over: Partial<DisturbanceSource> = {}): DisturbanceSource => ({
  id,
  target_id: `match-${id}`,
  created_at: at,
  new_value: { proclamation: 'The grass is growing towards one goal. Do not thank me.' },
  meta: { kind: 'in_match_interference' },
  ...over,
});

describe('pickUnannounced', () => {
  it('picks the newest in-match intervention not yet announced', () => {
    const rows = [row('a', '2026-10-27T10:00:00Z'), row('b', '2026-10-27T11:00:00Z')];
    expect(pickUnannounced(rows, new Set())?.id).toBe('b');
    expect(pickUnannounced(rows, new Set(['b']))?.id).toBe('a');
  });

  it('never announces the same intervention twice', () => {
    const rows = [row('a', '2026-10-27T10:00:00Z')];
    expect(pickUnannounced(rows, new Set(['a']))).toBeNull();
  });

  it('skips mid-week trait shifts, which publish their own story', () => {
    const rows = [row('m', '2026-10-27T12:00:00Z', { meta: { kind: 'mid_week_trait_shift' }, new_value: {} })];
    expect(pickUnannounced(rows, new Set())).toBeNull();
  });

  it('skips rows with no proclamation', () => {
    const rows = [row('x', '2026-10-27T12:00:00Z', { new_value: { proclamation: '  ' } })];
    expect(pickUnannounced(rows, new Set())).toBeNull();
  });
});

describe('cosmicDisturbanceText', () => {
  it('frames the proclamation with the fixture', () => {
    expect(cosmicDisturbanceText('Do not thank me.', { home: 'Earth United FC', away: 'Mars Athletic' }))
      .toBe('The Architect spoke during Earth United FC v Mars Athletic: "Do not thank me."');
  });

  it('falls back to "a match" when a club name is missing', () => {
    expect(cosmicDisturbanceText('Do not thank me.', { home: 'Earth United FC', away: null }))
      .toBe('The Architect spoke during a match: "Do not thank me."');
  });

  it('never contains a date, a minute stamp or an interference code', () => {
    const text = cosmicDisturbanceText('Something has been taken back.', { home: 'A', away: 'B' });
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(text).not.toMatch(/minute \d+/i);
    expect(text).not.toMatch(/[a-z]+_[a-z]+/);
  });
});
