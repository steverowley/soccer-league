// ── useReducedMotion.test.ts ───────────────────────────────────────────────
// Unit tests for the reduced-motion media query hook.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useReducedMotion } from './useReducedMotion';

// ── matchMedia mock ──────────────────────────────────────────────────────────
// jsdom doesn't ship `matchMedia`; we stub it with a tiny event-emitter
// so the hook can subscribe to "change" events and the tests can flip
// the value at will.

type Listener = (ev: { matches: boolean }) => void;

function makeMatchMediaMock() {
  const listeners = new Set<Listener>();
  let current = false;

  const mql = {
    get matches() { return current; },
    media: '(prefers-reduced-motion: reduce)',
    addEventListener: (_: string, l: Listener) => { listeners.add(l); },
    removeEventListener: (_: string, l: Listener) => { listeners.delete(l); },
  };

  return {
    mql,
    set(value: boolean) {
      current = value;
      for (const l of listeners) l({ matches: value });
    },
    listenerCount() { return listeners.size; },
  };
}

describe('useReducedMotion', () => {
  let mock: ReturnType<typeof makeMatchMediaMock>;

  beforeEach(() => {
    mock = makeMatchMediaMock();
    (window as any).matchMedia = vi.fn(() => mock.mql);
  });

  afterEach(() => {
    delete (window as any).matchMedia;
  });

  it('returns false by default when the user has not opted in', () => {
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it('returns true when matchMedia reports the preference at mount time', () => {
    mock.set(true);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it('reacts to a change event after mount', () => {
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
    act(() => { mock.set(true); });
    expect(result.current).toBe(true);
    act(() => { mock.set(false); });
    expect(result.current).toBe(false);
  });

  it('unregisters its listener on unmount', () => {
    const { unmount } = renderHook(() => useReducedMotion());
    expect(mock.listenerCount()).toBe(1);
    unmount();
    expect(mock.listenerCount()).toBe(0);
  });

  it('returns false in environments without matchMedia (e.g. older jsdom / SSR)', () => {
    delete (window as any).matchMedia;
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });
});
