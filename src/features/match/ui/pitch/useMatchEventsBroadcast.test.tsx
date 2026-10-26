// ── features/match/ui/pitch/useMatchEventsBroadcast.test.tsx ────────────────
// The mini pitches' shared live feed polls the read cache instead of holding
// a table-wide Realtime channel (docs/read-cache.md).  One poller serves all
// mounted chips, each tick asks for each live match's latest event through
// the PUBLIC client, it pauses while the tab is hidden, and the last unmount
// stops it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { SupabaseProvider } from '../../../../shared/supabase/SupabaseProvider';
import type { IslSupabaseClient } from '../../../../shared/supabase/client';
import type { PublicReadClient } from '../../../../shared/supabase/publicReadClient';
import { __resetMatchEventLatestForTests, useMatchEventLatest } from './useMatchEventsBroadcast';

/** A client whose match_events reads answer with a per-match latest row. */
function makeClient(label: string) {
  const latest = new Map<string, { id: string; minute: number }>();
  const reads: string[] = [];
  const channel = vi.fn();
  const from = vi.fn((table: string) => {
    let matchId = '';
    const builder = {
      select: () => builder,
      eq: (_c: string, v: string) => { matchId = v; return builder; },
      order: () => builder,
      limit: () => builder,
      then(resolve: (r: { data: unknown; error: null }) => unknown) {
        reads.push(`${label}:${table}:${matchId}`);
        const row = latest.get(matchId);
        const data = row ? [{ match_id: matchId, subminute: 0, type: 'shot', payload: {}, created_at: 'x', ...row }] : [];
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return builder;
  });
  return { client: { from, channel } as unknown as IslSupabaseClient & PublicReadClient, latest, reads, channel };
}

function Chip({ matchId, onRow }: { matchId: string; onRow: (id: string | null) => void }) {
  const row = useMatchEventLatest(matchId);
  onRow(row?.id ?? null);
  return null;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('useMatchEventLatest (polling the read cache)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetMatchEventLatestForTests();
  });
  afterEach(() => {
    cleanup();
    __resetMatchEventLatestForTests();
    setVisibility('visible');
    vi.useRealTimers();
  });

  it('reads through the public client, one shared poller for every chip, and never opens a channel', async () => {
    const direct = makeClient('direct');
    const pub = makeClient('public');
    pub.latest.set('m1', { id: 'e1', minute: 10 });
    pub.latest.set('m2', { id: 'e7', minute: 30 });
    const seen: Record<string, (string | null)[]> = { m1: [], m2: [] };

    render(
      <SupabaseProvider client={direct.client} publicClient={pub.client}>
        <Chip matchId="m1" onRow={(id) => seen.m1!.push(id)} />
        <Chip matchId="m2" onRow={(id) => seen.m2!.push(id)} />
      </SupabaseProvider>,
    );
    await flush();

    expect(direct.reads).toEqual([]);
    expect(pub.reads.sort()).toEqual(['public:match_events:m1', 'public:match_events:m2']);
    expect(seen.m1!.at(-1)).toBe('e1');
    expect(seen.m2!.at(-1)).toBe('e7');

    // One tick per interval for the whole page, one read per live match.
    pub.latest.set('m1', { id: 'e2', minute: 11 });
    await act(async () => { vi.advanceTimersByTime(15_000); });
    await flush();
    expect(pub.reads).toHaveLength(4);
    expect(seen.m1!.at(-1)).toBe('e2');

    expect(pub.channel).not.toHaveBeenCalled();
    expect(direct.channel).not.toHaveBeenCalled();
  });

  it('pauses while the tab is hidden and stops when the last chip unmounts', async () => {
    const pub = makeClient('public');
    pub.latest.set('m1', { id: 'e1', minute: 10 });
    const view = render(
      <SupabaseProvider client={pub.client} publicClient={pub.client}>
        <Chip matchId="m1" onRow={() => {}} />
      </SupabaseProvider>,
    );
    await flush();
    expect(pub.reads).toHaveLength(1);

    await act(async () => { setVisibility('hidden'); });
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(pub.reads).toHaveLength(1);

    await act(async () => { setVisibility('visible'); });
    expect(pub.reads).toHaveLength(2);

    view.unmount();
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(pub.reads).toHaveLength(2);
  });
});
