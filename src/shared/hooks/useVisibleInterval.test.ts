// ── shared/hooks/useVisibleInterval.test.ts ─────────────────────────────────
// The poller that replaced Realtime for public live views
// (docs/read-cache.md): it must poll on its interval while visible, send
// nothing while hidden, catch up immediately on return, and stop cleanly.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { startVisibleInterval, useVisibleInterval, type VisibilitySource } from './useVisibleInterval';

/** A controllable stand-in for `document`. */
function fakeDoc(initial: DocumentVisibilityState = 'visible') {
  let state = initial;
  const listeners = new Set<() => void>();
  const doc: VisibilitySource = {
    get visibilityState() { return state; },
    addEventListener: (_t, l) => { listeners.add(l); },
    removeEventListener: (_t, l) => { listeners.delete(l); },
  };
  return {
    doc,
    set(next: DocumentVisibilityState) {
      state = next;
      for (const l of [...listeners]) l();
    },
    listenerCount: () => listeners.size,
  };
}

describe('startVisibleInterval', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('ticks on the interval while visible', () => {
    const tick = vi.fn();
    const { doc } = fakeDoc();
    const stop = startVisibleInterval(tick, 15_000, { doc });
    expect(tick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(45_000);
    expect(tick).toHaveBeenCalledTimes(3);
    stop();
  });

  it('runs once at start with immediate', () => {
    const tick = vi.fn();
    const stop = startVisibleInterval(tick, 15_000, { doc: fakeDoc().doc, immediate: true });
    expect(tick).toHaveBeenCalledTimes(1);
    stop();
  });

  it('pauses while hidden and catches up at once when visible again', () => {
    const tick = vi.fn();
    const page = fakeDoc();
    const stop = startVisibleInterval(tick, 15_000, { doc: page.doc });
    vi.advanceTimersByTime(15_000);
    expect(tick).toHaveBeenCalledTimes(1);

    page.set('hidden');
    vi.advanceTimersByTime(120_000);
    expect(tick).toHaveBeenCalledTimes(1); // nothing while hidden

    page.set('visible');
    expect(tick).toHaveBeenCalledTimes(2); // immediate catch-up
    vi.advanceTimersByTime(15_000);
    expect(tick).toHaveBeenCalledTimes(3); // interval resumed
    stop();
  });

  it('does not start while the page loads hidden, and starts when shown', () => {
    const tick = vi.fn();
    const page = fakeDoc('hidden');
    const stop = startVisibleInterval(tick, 15_000, { doc: page.doc, immediate: true });
    vi.advanceTimersByTime(60_000);
    expect(tick).not.toHaveBeenCalled();
    page.set('visible');
    expect(tick).toHaveBeenCalledTimes(1);
    stop();
  });

  it('a second visible event while running does not double the interval', () => {
    const tick = vi.fn();
    const page = fakeDoc();
    const stop = startVisibleInterval(tick, 15_000, { doc: page.doc });
    page.set('visible');
    vi.advanceTimersByTime(15_000);
    expect(tick).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stop clears the interval and the listener', () => {
    const tick = vi.fn();
    const page = fakeDoc();
    const stop = startVisibleInterval(tick, 15_000, { doc: page.doc });
    expect(page.listenerCount()).toBe(1);
    stop();
    expect(page.listenerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    page.set('hidden');
    page.set('visible');
    expect(tick).not.toHaveBeenCalled();
  });
});

describe('useVisibleInterval', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('calls the latest callback, honours enabled, and stops on unmount', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ cb, enabled }: { cb: () => void; enabled: boolean }) => useVisibleInterval(cb, 10_000, enabled),
      { initialProps: { cb: first, enabled: true } },
    );
    vi.advanceTimersByTime(10_000);
    expect(first).toHaveBeenCalledTimes(1);

    rerender({ cb: second, enabled: true });
    vi.advanceTimersByTime(10_000);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);

    rerender({ cb: second, enabled: false });
    vi.advanceTimersByTime(30_000);
    expect(second).toHaveBeenCalledTimes(1);

    rerender({ cb: second, enabled: true });
    vi.advanceTimersByTime(10_000);
    expect(second).toHaveBeenCalledTimes(2);

    unmount();
    vi.advanceTimersByTime(30_000);
    expect(second).toHaveBeenCalledTimes(2);
  });
});
