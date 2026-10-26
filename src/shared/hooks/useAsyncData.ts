// ── useAsyncData.ts ─────────────────────────────────────────────────────────
// One honest data-loading contract for every page.
//
// WHY: before this hook each page hand-rolled `useEffect` + `useState` with no
// timeout. When the database stopped answering (2026-10-26), a request simply
// never settled, so pages showed "Loading fixtures..." forever, or worse,
// rendered their empty branch and pretended there was nothing to show. This
// hook gives every read four explicit states:
//
//   loading → the request is in flight and still inside its time budget
//   success → data arrived (possibly late: a slow answer still wins)
//   error   → the request failed
//   timeout → no answer inside `timeoutMs` (default 10 s); rendered as an
//             error with a retry, never as an endless spinner
//
// `retry()` re-runs the fetcher. Stale responses from an earlier run (deps
// changed, retry pressed, component unmounted) are ignored.

import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

/** How long a read may stay pending before the page says so. */
export const DEFAULT_TIMEOUT_MS = 10_000;

/** Thrown by {@link withTimeout} when the wrapped promise is too slow. */
export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`No answer after ${Math.round(ms / 1000)} s`);
    this.name = 'TimeoutError';
  }
}

/** True when `err` is the timeout signal rather than a real failure. */
export function isTimeoutError(err: unknown): err is TimeoutError {
  return err instanceof TimeoutError;
}

/**
 * Reject with {@link TimeoutError} if `promise` has not settled within `ms`.
 * For pages that keep their own effect but still must not hang forever.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number = DEFAULT_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err: unknown) => { clearTimeout(timer); reject(err); },
    );
  });
}

export type AsyncStatus = 'loading' | 'success' | 'error' | 'timeout';

export interface AsyncData<T> {
  status: AsyncStatus;
  /** Present only when status is 'success'. */
  data: T | undefined;
  /** The rejection reason when status is 'error' (or the TimeoutError). */
  error: unknown;
  /** Re-run the fetcher from scratch. */
  retry: () => void;
}

export interface UseAsyncDataOptions {
  /** Time budget before the state flips to 'timeout'. */
  timeoutMs?: number;
  /** When false the fetcher is not run and the state stays 'loading'. */
  enabled?: boolean;
}

interface InternalState<T> {
  run: number;
  status: AsyncStatus;
  data: T | undefined;
  error: unknown;
}

/**
 * Run `fetcher` whenever `deps` change (or `retry()` is called) and expose an
 * explicit loading / success / error / timeout state.
 *
 * @param fetcher  Returns the data. Read through a ref, so an inline closure
 *                 is fine; list what it depends on in `deps`.
 * @param deps     Re-fetch when any of these change.
 * @param options  `timeoutMs` (default 10 s) and `enabled`.
 */
export function useAsyncData<T>(
  fetcher: () => Promise<T>,
  deps: DependencyList,
  options: UseAsyncDataOptions = {},
): AsyncData<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, enabled = true } = options;
  const fetcherRef = useRef(fetcher);
  // Effects run in declaration order, so the data effect below always sees
  // the fetcher from the render that triggered it.
  useEffect(() => { fetcherRef.current = fetcher; });

  const [attempt, setAttempt] = useState(0);
  const runRef = useRef(0);
  const [state, setState] = useState<InternalState<T>>({
    run: 0, status: 'loading', data: undefined, error: null,
  });

  useEffect(() => {
    if (!enabled) return undefined;
    const run = ++runRef.current;
    const isCurrent = () => runRef.current === run;
    setState({ run, status: 'loading', data: undefined, error: null });

    const timer = setTimeout(() => {
      if (!isCurrent()) return;
      setState((prev) => (prev.run === run && prev.status === 'loading'
        ? { run, status: 'timeout', data: undefined, error: new TimeoutError(timeoutMs) }
        : prev));
    }, timeoutMs);

    let promise: Promise<T>;
    try {
      promise = fetcherRef.current();
    } catch (err) {
      promise = Promise.reject(err);
    }
    promise.then(
      (data) => {
        clearTimeout(timer);
        if (isCurrent()) setState({ run, status: 'success', data, error: null });
      },
      (err: unknown) => {
        clearTimeout(timer);
        if (isCurrent()) setState({ run, status: 'error', data: undefined, error: err });
      },
    );
    return () => {
      clearTimeout(timer);
      // Invalidate this run so a late settle cannot overwrite a newer one.
      if (runRef.current === run) runRef.current++;
    };
  // Caller-supplied deps plus the retry counter (deps is spread on purpose).
  }, [...deps, attempt, enabled, timeoutMs]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { status: state.status, data: state.data, error: state.error, retry };
}
