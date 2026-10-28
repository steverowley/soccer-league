// ── features/match/ui/viewer/ThrottledAnnouncer.test.tsx ────────────────────

import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThrottledAnnouncer } from './ThrottledAnnouncer';

const region = (c: HTMLElement) => c.querySelector('[aria-live="polite"]')!;

describe('ThrottledAnnouncer', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('announces the first value at once, then at most once per window, always the latest', () => {
    const { container, rerender } = render(<ThrottledAnnouncer text="A" everyMs={8000} />);
    act(() => vi.advanceTimersByTime(1));
    expect(region(container).textContent).toBe('A');
    // A burst of changes inside the window: nothing new is spoken yet.
    for (const [i, t] of ['B', '', 'C', '', 'D'].entries()) {
      rerender(<ThrottledAnnouncer text={t} everyMs={8000} />);
      act(() => vi.advanceTimersByTime(1000));
      expect(region(container).textContent, `step ${i}`).toBe('A');
    }
    // The window ends: the latest value is spoken.
    act(() => vi.advanceTimersByTime(3500));
    expect(region(container).textContent).toBe('D');
  });

  it('a value that arrives after a quiet spell (loose ball at the deadline) is spoken at once', () => {
    const { container, rerender } = render(<ThrottledAnnouncer text="A" everyMs={8000} />);
    act(() => vi.advanceTimersByTime(1));
    rerender(<ThrottledAnnouncer text="" everyMs={8000} />);
    act(() => vi.advanceTimersByTime(9000));
    expect(region(container).textContent).toBe('A');
    rerender(<ThrottledAnnouncer text="E" everyMs={8000} />);
    act(() => vi.advanceTimersByTime(1));
    expect(region(container).textContent).toBe('E');
  });

  it('never announces an empty value', () => {
    const { container } = render(<ThrottledAnnouncer text="" everyMs={8000} />);
    act(() => vi.advanceTimersByTime(20000));
    expect(region(container).textContent).toBe('');
  });
});
