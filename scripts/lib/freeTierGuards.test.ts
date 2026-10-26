// ── scripts/lib/freeTierGuards.test.ts ───────────────────────────────────────
// Replay retention selection and the daily size guard (docs/mvp-free-tier.md
// decisions 1 and 7).

import { describe, it, expect } from 'vitest';
import {
  evaluateSizeGuard,
  planReplayRetention,
  DB_SIZE_LIMIT_BYTES,
  REPLAY_BUDGET_BYTES,
  STORAGE_SIZE_LIMIT_BYTES,
  type StoredReplay,
} from './freeTierGuards';

const MB = 1024 * 1024;

/** n replays of `sizeMb` each, one day apart, oldest first, listed shuffled. */
function replays(n: number, sizeMb: number): StoredReplay[] {
  const list = Array.from({ length: n }, (_, i) => ({
    name: `m${String(i).padStart(4, '0')}.json.gz`,
    bytes: Math.round(sizeMb * MB),
    createdAt: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString(),
  }));
  return [...list.slice(n / 2), ...list.slice(0, n / 2)]; // order must not matter
}

describe('planReplayRetention', () => {
  it('uses an 800 MB budget by default', () => {
    expect(REPLAY_BUDGET_BYTES).toBe(800 * MB);
  });

  it('deletes nothing while the bucket is within budget', () => {
    const plan = planReplayRetention(replays(10, 1), 10 * MB);
    expect(plan.remove).toEqual([]);
    expect(plan.keptBytes).toBe(10 * MB);
  });

  it('deletes the oldest first, just enough to get back under budget', () => {
    const plan = planReplayRetention(replays(10, 1), 7.5 * MB);
    expect(plan.remove).toEqual(['m0000.json.gz', 'm0001.json.gz', 'm0002.json.gz']);
    expect(plan.totalBytes).toBe(10 * MB);
    expect(plan.keptBytes).toBe(7 * MB);
  });

  it('breaks createdAt ties by name, so the plan is deterministic', () => {
    const same = '2026-01-01T00:00:00.000Z';
    const plan = planReplayRetention(
      [
        { name: 'b', bytes: MB, createdAt: same },
        { name: 'a', bytes: MB, createdAt: same },
      ],
      MB,
    );
    expect(plan.remove).toEqual(['a']);
  });

  it('keeps a real season inside the budget: 4 000 replays of 0.2 MB need no deletes', () => {
    // Measured: about 0.19 MB per match (scripts/measure-replay-size.ts).
    expect(planReplayRetention(replays(4000, 0.2)).remove).toHaveLength(0);
    // 5 000 of them (about 977 MB) must shed the oldest ~1 000.
    const plan = planReplayRetention(replays(5000, 0.2));
    expect(plan.keptBytes).toBeLessThanOrEqual(REPLAY_BUDGET_BYTES);
    expect(plan.remove[0]).toBe('m0000.json.gz');
    expect(plan.remove.length).toBe(1000);
  });
});

describe('evaluateSizeGuard', () => {
  it('guards at 350 MB of database and 800 MB of storage', () => {
    expect(DB_SIZE_LIMIT_BYTES).toBe(350 * MB);
    expect(STORAGE_SIZE_LIMIT_BYTES).toBe(800 * MB);
  });

  it('passes under both limits (and exactly at them)', () => {
    expect(evaluateSizeGuard(51 * MB, 0)).toEqual({ ok: true, problems: [] });
    expect(evaluateSizeGuard(350 * MB, 800 * MB).ok).toBe(true);
  });

  it('fails, naming each breached limit with both sizes', () => {
    const db = evaluateSizeGuard(351 * MB, 10 * MB);
    expect(db.ok).toBe(false);
    expect(db.problems).toEqual(['database 351.0 MB is over the 350.0 MB guard (free plan quota 500 MB)']);

    const both = evaluateSizeGuard(400 * MB, 900 * MB);
    expect(both.problems).toHaveLength(2);
    expect(both.problems[1]).toContain('storage 900.0 MB');
  });
});
