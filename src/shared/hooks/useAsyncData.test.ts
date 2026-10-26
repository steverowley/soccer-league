// ── useAsyncData.test.ts ────────────────────────────────────────────────────
// The shared loading contract: a read is loading, then success, error or
// timeout. The timeout case is the one that matters most: on 2026-10-26 the
// database stopped answering and pages spun forever.

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TIMEOUT_MS,
  TimeoutError,
  isTimeoutError,
  useAsyncData,
  withTimeout,
} from './useAsyncData';

/** A promise plus its settle functions, so tests decide when a read lands. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('useAsyncData', () => {
  it('starts loading and settles into success with the data', async () => {
    const d = deferred<number[]>();
    const { result } = renderHook(() => useAsyncData(() => d.promise, []));
    expect(result.current.status).toBe('loading');
    expect(result.current.data).toBeUndefined();
    await act(async () => { d.resolve([1, 2]); });
    expect(result.current.status).toBe('success');
    expect(result.current.data).toEqual([1, 2]);
  });

  it('settles into error with the rejection reason', async () => {
    const d = deferred<number>();
    const { result } = renderHook(() => useAsyncData(() => d.promise, []));
    const boom = new Error('boom');
    await act(async () => { d.reject(boom); });
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe(boom);
  });

  it('turns a read that never answers into a timeout after 10 s', async () => {
    const never = new Promise<number>(() => {});
    const { result } = renderHook(() => useAsyncData(() => never, []));
    await act(async () => { vi.advanceTimersByTime(DEFAULT_TIMEOUT_MS - 1); });
    expect(result.current.status).toBe('loading');
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(result.current.status).toBe('timeout');
    expect(isTimeoutError(result.current.error)).toBe(true);
  });

  it('honours a custom timeout', async () => {
    const never = new Promise<number>(() => {});
    const { result } = renderHook(() => useAsyncData(() => never, [], { timeoutMs: 500 }));
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(result.current.status).toBe('timeout');
  });

  it('still shows data that arrives after the timeout', async () => {
    const d = deferred<string>();
    const { result } = renderHook(() => useAsyncData(() => d.promise, []));
    await act(async () => { vi.advanceTimersByTime(DEFAULT_TIMEOUT_MS); });
    expect(result.current.status).toBe('timeout');
    await act(async () => { d.resolve('late'); });
    expect(result.current.status).toBe('success');
    expect(result.current.data).toBe('late');
  });

  it('retry() runs the fetcher again and can recover', async () => {
    let calls = 0;
    const fetcher = vi.fn(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('down')) : Promise.resolve('up');
    });
    const { result } = renderHook(() => useAsyncData(fetcher, []));
    await act(async () => {});
    expect(result.current.status).toBe('error');
    await act(async () => { result.current.retry(); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('success');
    expect(result.current.data).toBe('up');
  });

  it('ignores a stale answer once the deps have changed', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const { result, rerender } = renderHook(
      ({ id }) => useAsyncData(() => (id === 1 ? first.promise : second.promise), [id]),
      { initialProps: { id: 1 } },
    );
    rerender({ id: 2 });
    await act(async () => { second.resolve('two'); });
    await act(async () => { first.resolve('one'); });
    expect(result.current.data).toBe('two');
  });

  it('does not run while disabled', async () => {
    const fetcher = vi.fn(() => Promise.resolve(1));
    const { result } = renderHook(() => useAsyncData(fetcher, [], { enabled: false }));
    await act(async () => { vi.advanceTimersByTime(DEFAULT_TIMEOUT_MS * 2); });
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.status).toBe('loading');
  });

  it('treats a fetcher that throws synchronously as an error', async () => {
    const { result } = renderHook(() => useAsyncData(() => { throw new Error('sync'); }, []));
    await act(async () => {});
    expect(result.current.status).toBe('error');
  });
});

describe('withTimeout', () => {
  it('passes a prompt value through', async () => {
    await expect(withTimeout(Promise.resolve(7), 100)).resolves.toBe(7);
  });

  it('passes a prompt rejection through', async () => {
    await expect(withTimeout(Promise.reject(new Error('x')), 100)).rejects.toThrow('x');
  });

  it('rejects with TimeoutError when the promise is too slow', async () => {
    const p = withTimeout(new Promise(() => {}), 100);
    vi.advanceTimersByTime(100);
    await expect(p).rejects.toBeInstanceOf(TimeoutError);
  });
});

describe('useAsyncData refreshMs (quiet background refresh)', () => {
  it('swaps in fresh data without ever going back to loading', async () => {
    let n = 0;
    const { result } = renderHook(() => useAsyncData(() => Promise.resolve(++n), [], { refreshMs: 30_000 }));
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toMatchObject({ status: 'success', data: 1 });
    await act(async () => { vi.advanceTimersByTime(30_000); await Promise.resolve(); await Promise.resolve(); });
    expect(result.current).toMatchObject({ status: 'success', data: 2 });
  });

  it('keeps the last good data when a refresh fails', async () => {
    let n = 0;
    const fetcher = () => (++n === 2 ? Promise.reject(new Error('blip')) : Promise.resolve(n));
    const { result } = renderHook(() => useAsyncData(fetcher, [], { refreshMs: 30_000 }));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(30_000); await Promise.resolve(); await Promise.resolve(); });
    expect(result.current).toMatchObject({ status: 'success', data: 1 });
    await act(async () => { vi.advanceTimersByTime(30_000); await Promise.resolve(); await Promise.resolve(); });
    expect(result.current).toMatchObject({ status: 'success', data: 3 });
  });

  it('does not refresh without the option', async () => {
    const fetcher = vi.fn(() => Promise.resolve(1));
    renderHook(() => useAsyncData(fetcher, []));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(120_000); });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
