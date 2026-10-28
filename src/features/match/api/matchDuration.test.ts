// ── matchDuration.test.ts ──────────────────────────────────────────────────
// One match length everywhere.  The reveal window (real seconds for 90 game
// minutes) is defaulted in three places that cannot import each other: the
// browser (matchEvents.ts), the season rollover (seasonRollover.ts) and the
// Deno match worker, plus the season_config column default (migration 0098).
// If they disagree, a season created without a config row is revealed at one
// speed and published at another.  The owner chose 1200 s (4.5x) so passes,
// tackles and shots stay readable (docs/match-viewer.md section 5).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MATCH_DURATION_SECONDS } from './matchEvents';

const ROOT = join(__dirname, '..', '..', '..', '..');

/** The number assigned to DEFAULT_MATCH_DURATION_SECONDS in a source file. */
function declaredIn(rel: string): number {
  const text = readFileSync(join(ROOT, rel), 'utf8');
  const m = /DEFAULT_MATCH_DURATION_SECONDS\s*=\s*(\d+)/.exec(text);
  if (!m) throw new Error(`no DEFAULT_MATCH_DURATION_SECONDS in ${rel}`);
  return Number(m[1]);
}

describe('match length', () => {
  it('is 20 real minutes for 90 game minutes', () => {
    expect(DEFAULT_MATCH_DURATION_SECONDS).toBe(1200);
  });

  it('agrees across the browser, the rollover and the worker', () => {
    expect(declaredIn('src/features/match/api/seasonRollover.ts')).toBe(DEFAULT_MATCH_DURATION_SECONDS);
    expect(declaredIn('supabase/functions/match-worker/index.ts')).toBe(DEFAULT_MATCH_DURATION_SECONDS);
  });

  it('matches the season_config column default in the latest migration that sets it', () => {
    const sql = readFileSync(join(ROOT, 'supabase/migrations/0098_twenty_minute_matches.sql'), 'utf8');
    expect(sql).toMatch(new RegExp(`match_duration_seconds SET DEFAULT ${DEFAULT_MATCH_DURATION_SECONDS}\\b`));
  });
});
