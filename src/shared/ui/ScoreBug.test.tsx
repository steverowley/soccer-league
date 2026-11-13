// ── shared/ui/ScoreBug.test.tsx ───────────────────────────────────────────
// The broadcast score bug: score type on the raised block, an accessible
// name a screen reader can say, and a dash state before kick-off.

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScoreBug } from './ScoreBug';

describe('ScoreBug', () => {
  it('names the score for screen readers and hides the decorative digits', () => {
    const { getByRole } = render(<ScoreBug home={2} away={1} />);
    const bug = getByRole('img', { name: '2 to 1' });
    expect(bug.textContent).toBe('2·1');
    for (const child of Array.from(bug.children)) {
      expect(child.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('sits on the raised surface in the score type, square', () => {
    const { getByRole } = render(<ScoreBug home={0} away={0} />);
    const bug = getByRole('img');
    expect(bug.style.background).toBe('var(--isl-surface-raised)');
    expect(bug.style.fontFamily).toBe('var(--isl-font-score)');
    expect(bug.style.borderRadius).toBe('');
  });

  it('says there is no score yet before kick-off', () => {
    const { getByRole } = render(<ScoreBug home="–" away="–" />);
    expect(getByRole('img', { name: 'No score yet' })).toBeTruthy();
  });
});
