// ── matchEvents.schema.subminute.test.ts ─────────────────────────────────────
// Regression guard for a bug that made matches look empty.
//
// `MatchEventRowSchema.subminute` was `z.number().int().min(0)`. The column is
// numeric with `CHECK (subminute >= 0 AND subminute < 1)` (migration 0013), and
// `adaptSpatialResult` writes `Math.min(0.999, (tSec % 60) / 60)` — so nearly
// every real event is fractional and was rejected.
//
// `parseMatchEventRows` drops a failed row with nothing louder than a
// `console.warn`, which is why this never surfaced as an error: the commentary
// feed and the match timeline just looked quiet. Only events landing exactly on
// a minute boundary survived.
//
// The lesson worth keeping: when an api-boundary parser drops rows silently,
// every schema field needs a test with a REAL value from the writer, not a
// hand-made one that happens to satisfy the schema.

import { describe, it, expect, vi } from 'vitest';
import { parseMatchEventRows } from './matchEvents.schema';

function row(subminute: number, type = 'goal') {
  return {
    id: 'e1',
    match_id: 'm1',
    minute: 42,
    subminute,
    type,
    payload: { commentary: 'Rix Vanto scores!' },
    created_at: '2026-01-01T00:00:00Z',
  };
}

describe('subminute accepts what the writer actually writes', () => {
  it('keeps fractional subminutes', () => {
    // These are the values (tSec % 60) / 60 actually produces.
    const fractions = [0.016, 0.1, 0.35, 0.5, 0.783, 0.983, 0.999];
    const out = parseMatchEventRows(
      fractions.map((f) => row(f)),
      'test',
    );
    expect(out).toHaveLength(fractions.length);
  });

  it('keeps an exact minute boundary', () => {
    expect(parseMatchEventRows([row(0)], 'test')).toHaveLength(1);
  });

  it('rejects values the CHECK constraint forbids', () => {
    // subminute >= 1 cannot exist in the column, so a row carrying one is
    // genuinely malformed and should be dropped.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseMatchEventRows([row(1)], 'test')).toHaveLength(0);
    expect(parseMatchEventRows([row(1.5)], 'test')).toHaveLength(0);
    expect(parseMatchEventRows([row(-0.1)], 'test')).toHaveLength(0);
    warn.mockRestore();
  });

  it('does not drop a realistic whole-match stream', () => {
    // The shape of a real post-filter stream: ~30 notable events, each with a
    // fractional subminute. Before the fix this returned 1 row.
    const stream = Array.from({ length: 30 }, (_, i) => ({
      ...row(((i * 7) % 60) / 60),
      id: `e${i}`,
      minute: i * 3,
    }));
    expect(parseMatchEventRows(stream, 'test')).toHaveLength(30);
  });

  it('accepts a cosmic_voice row, which sits at trigger + 0.001', () => {
    expect(parseMatchEventRows([row(0.351, 'cosmic_voice')], 'test')).toHaveLength(1);
  });
});
