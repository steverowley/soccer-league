// ── useLiveScores.test.tsx ──────────────────────────────────────────────────
// The home page card and the fixtures list showed 0-0 for every live match on
// Season 1's first matchday: they read `home_score`, which stays empty until
// full time.  This hook gives them the same live score the match page shows.

import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SupabaseProvider } from '@shared/supabase/SupabaseProvider';
import type { IslSupabaseClient } from '@shared/supabase/client';
import { useLiveScores, type LiveScoreMatch } from './useLiveScores';

const KO = '2026-10-26T19:30:00.000Z';

/** A fake client: answers per table and records match_events reads. */
function fakeDb(goals: unknown[]) {
  const eventReads: Array<{ ids: unknown }> = [];
  const answers: Record<string, unknown> = {
    matches:       { competition_id: 'c1' },
    competitions:  { season_id: 's1' },
    season_config: { match_duration_seconds: 600 },
  };
  const from = vi.fn((table: string) => {
    const b = {
      select: () => b,
      eq:     () => b,
      in:     (_col: string, ids: unknown) => { if (table === 'match_events') eventReads.push({ ids }); return b; },
      order:  () => b,
      single: () => Promise.resolve({ data: answers[table] ?? null, error: null }),
      then:   (ok: (r: unknown) => unknown) => Promise.resolve({ data: table === 'match_events' ? goals : [], error: null }).then(ok),
    };
    return b;
  });
  const db = { from, channel: vi.fn(), removeChannel: vi.fn() } as unknown as IslSupabaseClient;
  return { db, eventReads };
}

function wrapperFor(db: IslSupabaseClient) {
  return ({ children }: { children: ReactNode }) => <SupabaseProvider client={db}>{children}</SupabaseProvider>;
}

/** Let the fetch promises settle inside act. */
async function settle() {
  for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); });
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('useLiveScores', () => {
  const goals = [
    { match_id: 'm1', minute: 12, type: 'goal', payload: { side: 'away' } },
    { match_id: 'm1', minute: 40, type: 'goal', payload: { side: 'home' } },
    { match_id: 'm2', minute: 5,  type: 'goal', payload: { side: 'home' } },
  ];
  const matches: LiveScoreMatch[] = [
    { id: 'm1', status: 'live', scheduled_at: KO },
    { id: 'm2', status: 'live', scheduled_at: KO },
    { id: 'm3', status: 'scheduled', scheduled_at: '2026-10-26T21:00:00.000Z' },
  ];

  it('shows the goals revealed so far, ticking with the clock, for every live match', async () => {
    vi.setSystemTime(new Date(Date.parse(KO) + 60_000)); // minute 9
    const { db } = fakeDb(goals);
    const { result } = renderHook(() => useLiveScores(matches), { wrapper: wrapperFor(db) });
    await settle();
    expect(result.current.get('m1')).toEqual({ score: [0, 0], minute: 9, fullTime: false, goals: [] });
    expect(result.current.get('m2')?.score).toEqual([1, 0]);
    expect(result.current.has('m3')).toBe(false); // not kicked off: not tracked

    await act(async () => { vi.advanceTimersByTime(240_000); }); // minute 45
    expect(result.current.get('m1')).toMatchObject({ score: [1, 1], minute: 45, fullTime: false });
    expect(result.current.get('m1')?.goals).toEqual([
      { minute: 12, side: 'away', player: null },
      { minute: 40, side: 'home', player: null },
    ]);
  });

  it('reads every live match in ONE request, ids sorted so the read cache shares it', async () => {
    vi.setSystemTime(new Date(Date.parse(KO) + 60_000));
    const { db, eventReads } = fakeDb(goals);
    renderHook(() => useLiveScores([matches[1]!, matches[0]!]), { wrapper: wrapperFor(db) });
    await settle();
    expect(eventReads).toEqual([{ ids: ['m1', 'm2'] }]);
  });

  it('shows an unknown score (null), never a made-up 0-0, while a match is still being simulated', async () => {
    vi.setSystemTime(new Date(Date.parse(KO) + 60_000));
    const { db } = fakeDb([]);
    const { result } = renderHook(
      () => useLiveScores([{ id: 'm9', status: 'in_progress', scheduled_at: KO }]),
      { wrapper: wrapperFor(db) },
    );
    await settle();
    expect(result.current.get('m9')?.score).toBeNull();
  });
});
