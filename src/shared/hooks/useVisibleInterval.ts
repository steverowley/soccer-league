// ── shared/hooks/useVisibleInterval.ts ──────────────────────────────────────
// Polling that stops while the tab is hidden.
//
// WHY
//   Public live views (the match live feed, the mini pitches on the matches
//   list) used to hold a Supabase Realtime `postgres_changes` subscription,
//   which costs the database work per subscriber.  They now poll the cached
//   read proxy (docs/read-cache.md): identical polls from every fan inside the
//   cache TTL cost the database one query.  A hidden tab has nobody looking at
//   it, so it should not poll at all; when it becomes visible again it
//   catches up at once and resumes the interval.

import { useEffect, useRef } from 'react';

/** Default poll interval for public live views (ms). */
export const LIVE_POLL_MS = 15_000;

/** The slice of `document` the poller needs (injectable for tests). */
export interface VisibilitySource {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

/**
 * Call `tick` every `intervalMs` while the page is visible.
 *
 * - Hidden -> the interval is cleared (no requests at all).
 * - Visible again -> `tick` runs immediately, then the interval resumes.
 * - `immediate` -> also run `tick` once at start (when visible).
 *
 * @returns A stop function that clears the interval and the listener.
 */
export function startVisibleInterval(
  tick: () => void,
  intervalMs: number,
  opts: { immediate?: boolean; doc?: VisibilitySource } = {},
): () => void {
  const doc: VisibilitySource | undefined =
    opts.doc ?? (typeof document !== 'undefined' ? document : undefined);
  let timer: ReturnType<typeof setInterval> | null = null;

  const start = () => {
    if (timer === null) timer = setInterval(tick, intervalMs);
  };
  const pause = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
  const onVisibility = () => {
    if (!doc) return;
    if (doc.visibilityState === 'hidden') {
      pause();
    } else if (timer === null) {
      tick();
      start();
    }
  };

  if (!doc || doc.visibilityState !== 'hidden') {
    if (opts.immediate) tick();
    start();
  }
  doc?.addEventListener('visibilitychange', onVisibility);

  return () => {
    pause();
    doc?.removeEventListener('visibilitychange', onVisibility);
  };
}

/**
 * React wrapper for {@link startVisibleInterval}.  The latest `tick` is
 * always called (no stale closure), and the poller restarts only when
 * `intervalMs` or `enabled` change.
 *
 * @param tick        What to do on each poll.
 * @param intervalMs  Poll interval (default LIVE_POLL_MS).
 * @param enabled     False stops polling.
 * @param immediate   Also poll once as soon as polling starts.
 */
export function useVisibleInterval(
  tick: () => void,
  intervalMs: number = LIVE_POLL_MS,
  enabled = true,
  immediate = false,
): void {
  const latest = useRef(tick);
  useEffect(() => {
    latest.current = tick;
  });
  useEffect(() => {
    if (!enabled) return undefined;
    return startVisibleInterval(() => latest.current(), intervalMs, { immediate });
  }, [intervalMs, enabled, immediate]);
}
