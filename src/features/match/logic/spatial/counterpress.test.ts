// ── features/match/logic/spatial/counterpress.test.ts ────────────────────────
// The manager's onLoss choice must show on the pitch (docs/phases-of-play.md
// section 4): 1.5 s after an open-play loss a counter-pressing side has more
// men within 10 m of the ball than a side that recovers into its block, and
// it wins the ball back within 6 s more often.  Same sides, same ratings, each
// pair of matches played once each way round, so only the plan differs.
//
// HOW MANY MATCHES, AND WHERE THE THRESHOLDS COME FROM
//   The measurement lives in calibration/counterpressMetric.ts and is shared
//   with scripts/counterpress-batch.ts.  Over 48 pairs (seeds 4100 + 2k) on
//   the engine of November 2026 (with the keeper high-ball fix) a
//   counter-pressing side regained the ball within 6 s on 0.514 of its
//   losses against 0.365 for a recovering side: a difference of 0.147,
//   per-pair SD 0.060 (0.145 and 0.059 before that fix).  This test used to play ONE
//   pair and require a difference above 0.16, which the engine clears in only
//   about a third of pairs: it passed by the luck of its seed.  It now plays
//   PAIRS pairs (the first PAIRS of that batch) and requires the difference
//   to exceed the measured mean less 2.5 standard errors of a PAIRS-pair
//   sample: 0.147 - 2.5 x 0.060 / sqrt(6) = 0.086.  Men within 10 m: 2.18
//   v 1.56 over the 48 pairs (difference 0.62, per-pair SD 0.097), far
//   clear of both of its thresholds.  Re-measure with
//   `bash scripts/run-counterpress.sh <prefix> 48` and
//   `REPORT=<prefix> npx tsx scripts/counterpress-batch.ts` after an engine
//   change that moves this test.

import { describe, it, expect, beforeAll } from 'vitest';
import { counterpressPair, type CounterpressPair } from '../calibration/counterpressMetric';

/** Match pairs played (2 full matches each, stoppage off). */
const PAIRS = 6;

const tally: CounterpressPair = { P: { losses: 0, near: 0, regained: 0 }, R: { losses: 0, near: 0, regained: 0 } };

describe('phases of play: the counter-press happens as the manager plans it', () => {
  beforeAll(() => {
    for (let k = 0; k < PAIRS; k++) {
      const pair = counterpressPair(4100 + 2 * k);
      for (const s of ['P', 'R'] as const) {
        tally[s].losses += pair[s].losses;
        tally[s].near += pair[s].near;
        tally[s].regained += pair[s].regained;
      }
    }
  }, 180_000);

  it('puts more men around the ball 1.5 s after a loss than recovering does', () => {
    const p = tally.P.near / tally.P.losses;
    const r = tally.R.near / tally.R.losses;
    expect(tally.P.losses).toBeGreaterThan(100 * PAIRS);
    // v1 (a press that only acted on a carried ball): 1.72 v 1.34.
    expect(p, `counter-press ${p.toFixed(2)} v recover ${r.toFixed(2)} within 10 m`).toBeGreaterThan(1.9);
    expect(p, `counter-press ${p.toFixed(2)} v recover ${r.toFixed(2)} within 10 m`).toBeGreaterThan(r + 0.3);
  });

  it('wins the ball back within six seconds clearly more often', () => {
    const p = tally.P.regained / tally.P.losses;
    const r = tally.R.regained / tally.R.losses;
    // v1: 0.453 v 0.356.  Threshold: measured over 48 pairs, see the header.
    expect(p, `counter-press ${p.toFixed(3)} v recover ${r.toFixed(3)} regained in 6 s`).toBeGreaterThan(r + 0.086);
  });
});
