// ── oddsGenerator.test.ts ──────────────────────────────────────────────────
// Load guard for the match worker's pre-claim pricing pass.  It runs every
// two minutes on the free-tier database, so the steady state (every upcoming
// match already priced) must cost a fixed number of queries, not one per
// match.  The per-match version sent about 90 SELECTs a tick.

import { describe, expect, it } from 'vitest';
import { ensureOddsForUpcoming } from './oddsGenerator.ts';

/**
 * Minimal PostgREST-shaped fake.  Every `.from()` counts as one query; the
 * builder is thenable so `await` resolves it with the rows for that table.
 */
function fakeClient(tables: Record<string, unknown[]>) {
  const calls: string[] = [];
  const client = {
    from(table: string) {
      calls.push(table);
      const result = { data: tables[table] ?? [], error: null };
      const builder: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'gte', 'lte', 'order', 'in', 'or', 'limit']) {
        builder[m] = () => builder;
      }
      builder.maybeSingle = () => Promise.resolve({ data: (tables[table] ?? [])[0] ?? null, error: null });
      builder.upsert = () => Promise.resolve({ error: null });
      builder.then = (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok);
      return builder;
    },
  };
  return { client, calls };
}

describe('ensureOddsForUpcoming', () => {
  it('checks existing odds with one query, however many matches are upcoming', async () => {
    const soon = new Date(Date.now() + 3_600_000).toISOString();
    const upcoming = Array.from({ length: 20 }, (_, i) => ({
      id: `m${i}`, home_team_id: 'a', away_team_id: 'b', scheduled_at: soon, competition_id: 'c',
    }));
    const odds = upcoming.map((m) => ({ match_id: m.id }));
    const { client, calls } = fakeClient({ matches: upcoming, match_odds: odds });

    const summary = await ensureOddsForUpcoming(client);

    expect(summary).toEqual({ considered: 20, priced: 0, skipped: 20 });
    expect(calls).toEqual(['matches', 'match_odds']);
  });

  it('prices only the matches that have no odds yet', async () => {
    const soon = new Date(Date.now() + 3_600_000).toISOString();
    const upcoming = ['m1', 'm2', 'm3'].map((id) => ({
      id, home_team_id: 'a', away_team_id: 'b', scheduled_at: soon, competition_id: 'c',
    }));
    const { client, calls } = fakeClient({ matches: upcoming, match_odds: [{ match_id: 'm1' }], players: [] });

    const summary = await ensureOddsForUpcoming(client);

    expect(summary.skipped).toBe(1);
    expect(summary.priced).toBe(2);
    expect(calls.filter((t) => t === 'match_odds')).toHaveLength(3); // 1 lookup + 2 upserts
  });
});
