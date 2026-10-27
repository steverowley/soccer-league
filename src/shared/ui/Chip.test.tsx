// ── shared/ui/Chip.test.tsx ───────────────────────────────────────────────
// Smoke tests for the legacy Chip primitive, now on the tokens. Chip is
// superseded by Tag but must keep its API for unmigrated call sites.

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Chip } from './Chip';

describe('Chip', () => {
  it('renders children inside a bordered label-type span', () => {
    const { getByText, container } = render(<Chip>LIVE</Chip>);
    expect(getByText('LIVE')).toBeTruthy();
    const root = container.firstChild as HTMLElement;
    expect(root.tagName).toBe('SPAN');
    expect(root.style.borderWidth).toBe('1px');
    expect(root.style.textTransform).toBe('uppercase');
    expect(root.style.fontSize).toBe('var(--isl-size-label)');
  });

  it('uses the live token for border and text with tone="flare"', () => {
    const { container } = render(<Chip tone="flare">SOLD OUT</Chip>);
    const root = container.firstChild as HTMLElement;
    expect(root.style.borderColor).toBe('var(--isl-live)');
    expect(root.style.color).toBe('var(--isl-live)');
  });

  it('keeps text neutral with tone="quantum" (architect border only)', () => {
    const { container } = render(<Chip tone="quantum">FOCUS</Chip>);
    const root = container.firstChild as HTMLElement;
    expect(root.style.borderColor).toBe('var(--isl-architect)');
    expect(root.style.color).toBe('var(--isl-text)');
  });

  it('merges through a custom style prop', () => {
    const { container } = render(<Chip style={{ marginLeft: 8 }}>EXTRA</Chip>);
    const root = container.firstChild as HTMLElement;
    expect(root.style.marginLeft).toBe('8px');
    expect(root.style.fontSize).toBe('var(--isl-size-label)');
  });
});
