// ── features/match/ui/pitch/useMatchEventsBroadcast.ts ──────────────────────
// Shared live feed of the latest match_events row per match, for the mini
// pitches on the matches list (isl-a8i).
//
// WHY POLLING, NOT REALTIME (docs/read-cache.md, "As built")
//   This used to open one table-wide Supabase Realtime `postgres_changes`
//   channel for every visitor of the matches list.  postgres_changes makes
//   the database do work per subscriber, and on the free Nano instance that
//   load grows with the number of fans.  The hook now runs ONE shared poll
//   (whatever the number of mounted chips) that asks the cached read proxy
//   for each live match's latest event every 15 s.  Identical requests from
//   every fan inside the match_events TTL (10 s) are answered by Vercel's
//   CDN, so the database sees about one query per live match per TTL in
//   total.  The poll pauses while the tab is hidden.
//
// SHAPE
//   • Latest-event map keyed by match_id in a module-level store, plus a
//     per-match set of subscriber callbacks.
//   • Reference-counted: the first hook to mount starts the poller, the last
//     to unmount stops it.  The cache survives so a re-mount paints the last
//     known state at once.
//   • The file name is kept from the Realtime version so imports and the
//     barrel did not move.

import { useEffect, useState } from 'react';

import { usePublicReadClient } from '../../../../shared/supabase/SupabaseProvider';
import type { PublicReadClient } from '@shared/supabase/publicReadClient';
import { LIVE_POLL_MS, startVisibleInterval } from '@shared/hooks/useVisibleInterval';
import { getLatestMatchEvent, type MatchEventRow } from '../../api/matchEvents';

// ── Module-level shared store ───────────────────────────────────────────────

/** Latest event per match_id, filled by the shared poller. */
const latestByMatch = new Map<string, MatchEventRow>();

/** Per-match subscriber callbacks registered by mounted hooks. */
const subscribers = new Map<string, Set<(row: MatchEventRow) => void>>();

/** Active hook instances: the poller runs while this is above zero. */
let refCount = 0;

/** Stops the active poller (null when none runs). */
let stopPoller: (() => void) | null = null;

/** The client the active poller reads through. */
let activeClient: PublicReadClient | null = null;

/** Fetch the latest event of every subscribed match and notify on change. */
function pollOnce(): void {
  const db = activeClient;
  if (!db) return;
  for (const matchId of subscribers.keys()) {
    void getLatestMatchEvent(db, matchId).then((row) => {
      if (!row) return;
      const prev = latestByMatch.get(matchId);
      if (prev && prev.id === row.id) return;
      latestByMatch.set(matchId, row);
      const set = subscribers.get(matchId);
      if (set) for (const cb of set) cb(row);
    });
  }
}

/** Start the shared poller (idempotent). */
function startPolling(db: PublicReadClient): void {
  if (stopPoller) return;
  activeClient = db;
  stopPoller = startVisibleInterval(pollOnce, LIVE_POLL_MS, { immediate: true });
}

/** Stop the shared poller; the latest-event cache is kept. */
function stopPolling(): void {
  stopPoller?.();
  stopPoller = null;
  activeClient = null;
}

/** Test hook: reset the module state between tests. */
export function __resetMatchEventLatestForTests(): void {
  stopPolling();
  refCount = 0;
  latestByMatch.clear();
  subscribers.clear();
}

// ── Public hook ─────────────────────────────────────────────────────────────

/**
 * The latest match_events row for one match, refreshed by the shared poll.
 *
 * @param matchId  UUID of the match, or null/undefined to disable.
 * @returns        The most recent event, or null before the first answer.
 */
export function useMatchEventLatest(matchId: string | null | undefined): MatchEventRow | null {
  const db = usePublicReadClient();
  const [latest, setLatest] = useState<MatchEventRow | null>(() =>
    matchId ? latestByMatch.get(matchId) ?? null : null,
  );

  useEffect(() => {
    if (!matchId) return;

    // Register first so the immediate first poll includes this match.
    const cb = (row: MatchEventRow) => setLatest(row);
    let set = subscribers.get(matchId);
    if (!set) {
      set = new Set();
      subscribers.set(matchId, set);
    }
    set.add(cb);

    refCount++;
    if (refCount === 1) startPolling(db);
    else pollOneSoon(matchId);

    return () => {
      const inner = subscribers.get(matchId);
      if (inner) {
        inner.delete(cb);
        if (inner.size === 0) subscribers.delete(matchId);
      }
      refCount--;
      if (refCount <= 0) {
        refCount = 0;
        stopPolling();
      }
    };
  }, [db, matchId]);

  return latest;
}

/**
 * A chip that mounts while the poller already runs gets its own first read
 * straight away instead of waiting up to a full interval.
 */
function pollOneSoon(matchId: string): void {
  const db = activeClient;
  if (!db || latestByMatch.has(matchId)) return;
  void getLatestMatchEvent(db, matchId).then((row) => {
    if (!row) return;
    latestByMatch.set(matchId, row);
    const set = subscribers.get(matchId);
    if (set) for (const cb of set) cb(row);
  });
}
