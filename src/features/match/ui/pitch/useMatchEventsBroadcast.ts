// ── features/match/ui/pitch/useMatchEventsBroadcast.ts ──────────────────────
// Shared Realtime broadcast for match_events INSERTs (isl-a8i).
//
// WHY THIS EXISTS
//   The Matches list page can show 1..N concurrently-live matches.
//   Opening a separate Supabase Realtime channel per match would
//   multiply WebSocket cost linearly with concurrent live matches.
//   The acceptance criterion for isl-a8i is "no more than 1 Realtime
//   subscription regardless of how many live matches".  This hook
//   opens ONE table-wide subscription and demuxes by match_id
//   client-side, so consumers (one <MiniPitch> per row) read their
//   matches's latest event via a tiny `useMatchEventLatest(id)` hook.
//
// SUBSCRIPTION SHAPE
//   • Single supabase.channel('match_events:broadcast') with a
//     postgres_changes filter for INSERTs on `match_events` (no
//     match_id filter — table-wide).
//   • Latest-event map keyed by match_id lives in a module-level
//     store (Map<string, MatchEventRow>) plus a per-key version
//     counter so React useSyncExternalStore-style consumers re-
//     render when their match's latest event changes.
//   • Reference-counted: the first hook to mount opens the channel,
//     the last to unmount closes it.  Intermediate (un)mounts are
//     no-ops.
//
// WHY NOT useSyncExternalStore
//   The hook target audience is the existing useChoreographyQueue
//   pattern (per-render snapshot reads).  A simple useState +
//   subscribe + useEffect is the smallest surface that delivers
//   correctness without pulling in the SSR-only ceremony of
//   useSyncExternalStore.

import { useEffect, useState } from 'react';

import { useSupabase } from '../../../../shared/supabase/SupabaseProvider';
import type { IslSupabaseClient } from '@shared/supabase/client';
import type { MatchEventRow } from '../../api/matchEvents';

// ── Module-level shared store ───────────────────────────────────────────────

/**
 * Latest event per match_id.  Populated by the single shared
 * channel's onInsert handler; read by per-match consumers via the
 * `useMatchEventLatest` hook below.  Module-level rather than
 * React-context because the store is single-process / single-tab and
 * doesn't need to participate in any provider tree.
 */
const latestByMatch = new Map<string, MatchEventRow>();

/**
 * Per-match-id set of subscriber callbacks.  Each `useMatchEventLatest`
 * mount registers a setter here; the onInsert handler dispatches the
 * row to every matching subscriber.  Unmounts remove from the set.
 */
const subscribers = new Map<string, Set<(row: MatchEventRow) => void>>();

/**
 * Reference count of active hook instances.  We open the Realtime
 * channel when the count transitions 0 → 1 and close it when the
 * count transitions 1 → 0.  Intermediate (un)mounts are no-ops.
 */
let refCount = 0;

/**
 * Active Realtime channel.  Held at module scope so the open/close
 * lifecycle survives across the React tree's mount/unmount cycles.
 */
let activeChannel: ReturnType<IslSupabaseClient['channel']> | null = null;

/**
 * The Supabase client the active channel was opened against.  Stored
 * so the close path can call `db.removeChannel(activeChannel)` even
 * when the most recent mount is for a different React subtree.
 */
let activeClient: IslSupabaseClient | null = null;

/**
 * Open the shared Realtime channel.  Idempotent — re-opening when
 * a channel is already active is a no-op.
 *
 * The filter is table-wide: every match_events INSERT lands in this
 * channel, regardless of match_id.  Bandwidth is bounded (a few hundred
 * events per match × small concurrent live count).
 *
 * @param db  Injected Supabase client.
 */
function openChannel(db: IslSupabaseClient): void {
  if (activeChannel) return;
  activeClient = db;
  activeChannel = db
    .channel('match_events:broadcast')
    .on(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      'postgres_changes' as any,
      {
        event:  'INSERT',
        schema: 'public',
        table:  'match_events',
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (payload: any) => {
        const row = payload?.new as MatchEventRow | undefined;
        if (!row?.match_id) return;
        latestByMatch.set(row.match_id, row);
        const set = subscribers.get(row.match_id);
        if (set) {
          for (const cb of set) cb(row);
        }
      },
    )
    .subscribe();
}

/**
 * Close the shared Realtime channel.  Called when the last consumer
 * unmounts.  Resets all module-level state so a future mount opens a
 * fresh channel without inheriting stale latest-event entries.
 */
function closeChannel(): void {
  if (activeChannel && activeClient) {
    activeClient.removeChannel(activeChannel);
  }
  activeChannel = null;
  activeClient  = null;
  // Don't clear `latestByMatch` — the cache survives across
  // open/close cycles so a re-mount immediately paints the last
  // known position without waiting for the next event.
}

// ── Public hook ─────────────────────────────────────────────────────────────

/**
 * Subscribe to the latest match_events row for a single match.
 *
 * Lifecycle:
 *   • Bumps the module-level refCount on mount; opens the shared
 *     channel when refCount transitions 0 → 1.
 *   • Registers a setter that React calls when a new event for this
 *     match_id arrives.
 *   • Unmounts decrement refCount; the LAST unmount closes the
 *     shared channel.
 *
 * @param matchId  UUID of the match whose latest event to track.
 *                 Pass `null` or `undefined` to disable the
 *                 subscription (the hook still respects the
 *                 refCount transitions so dynamic enables work).
 * @returns        The most recent event for this match_id, or
 *                 `null` if none has arrived since the channel
 *                 opened (or since the page loaded with the row
 *                 not in cache yet).
 */
export function useMatchEventLatest(matchId: string | null | undefined): MatchEventRow | null {
  const db = useSupabase();
  const [latest, setLatest] = useState<MatchEventRow | null>(() =>
    matchId ? latestByMatch.get(matchId) ?? null : null,
  );

  useEffect(() => {
    if (!matchId) return;

    // ── Open / increment ───────────────────────────────────────────────
    refCount++;
    if (refCount === 1) openChannel(db);

    // ── Register per-match callback ────────────────────────────────────
    // Wrap the setter so the callback identity is stable across renders
    // (Set membership is reference-equality).
    const cb = (row: MatchEventRow) => setLatest(row);
    let set = subscribers.get(matchId);
    if (!set) {
      set = new Set();
      subscribers.set(matchId, set);
    }
    set.add(cb);

    // Seed from cache so a re-mount after page navigation immediately
    // paints the last known state instead of waiting for the next
    // event.
    const cached = latestByMatch.get(matchId);
    if (cached) setLatest(cached);

    return () => {
      // ── Deregister ──────────────────────────────────────────────────
      const inner = subscribers.get(matchId);
      if (inner) {
        inner.delete(cb);
        if (inner.size === 0) subscribers.delete(matchId);
      }
      // ── Decrement / close ───────────────────────────────────────────
      refCount--;
      if (refCount <= 0) {
        refCount = 0;
        closeChannel();
      }
    };
  }, [db, matchId]);

  return latest;
}
