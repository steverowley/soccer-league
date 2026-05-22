// ── usePageTitle tests ────────────────────────────────────────────────────────
// WHY: document.title is global mutable state and forgetting to restore it on
// unmount produces nesting like "X | ISL — Y | ISL — Z | ISL". The tests pin
// the suffix contract, the null/empty fallback, and the cleanup behaviour.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePageTitle } from './usePageTitle';

describe('usePageTitle', () => {
  let originalTitle: string;

  beforeEach(() => {
    originalTitle = document.title;
    document.title = 'initial';
  });

  afterEach(() => {
    document.title = originalTitle;
  });

  it('sets document.title to "<title> | Intergalactic Soccer League"', () => {
    renderHook(() => usePageTitle('Pluto FC Wanderers'));
    expect(document.title).toBe('Pluto FC Wanderers | Intergalactic Soccer League');
  });

  it('falls back to brand title when given null', () => {
    renderHook(() => usePageTitle(null));
    expect(document.title).toBe('Intergalactic Soccer League');
  });

  it('falls back to brand title when given an empty string', () => {
    renderHook(() => usePageTitle(''));
    expect(document.title).toBe('Intergalactic Soccer League');
  });

  it('restores the previous title on unmount', () => {
    const { unmount } = renderHook(() => usePageTitle('Match Day'));
    expect(document.title).toBe('Match Day | Intergalactic Soccer League');
    unmount();
    expect(document.title).toBe('initial');
  });

  it('updates when the title prop changes', () => {
    const { rerender } = renderHook(({ t }: { t: string }) => usePageTitle(t), {
      initialProps: { t: 'First' },
    });
    expect(document.title).toBe('First | Intergalactic Soccer League');
    rerender({ t: 'Second' });
    expect(document.title).toBe('Second | Intergalactic Soccer League');
  });
});
