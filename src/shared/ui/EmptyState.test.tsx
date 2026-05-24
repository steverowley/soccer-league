// ── shared/ui/EmptyState.test.tsx ─────────────────────────────────────────
// Smoke tests for the EmptyState primitive (#378). Same shape as the
// other shared/ui tests — locks down the public surface, doesn't
// over-specify the visuals.

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders the body line in italic dust-faint colour', () => {
    const { getByText } = render(<EmptyState>No data.</EmptyState>);
    const body = getByText('No data.');
    expect(body.tagName).toBe('P');
    expect(body.style.fontStyle).toBe('italic');
  });

  it('omits the kicker by default', () => {
    const { container } = render(<EmptyState>Nothing.</EmptyState>);
    // Only one <p> when no kicker / hint is passed.
    expect(container.querySelectorAll('p')).toHaveLength(1);
  });

  it('renders the kicker above the body when provided', () => {
    const { getByText, container } = render(
      <EmptyState kicker="NO BETS">Place one to get started.</EmptyState>,
    );
    expect(getByText('NO BETS')).toBeTruthy();
    expect(getByText('Place one to get started.')).toBeTruthy();
    // The kicker is the first <p>, body is the second.
    const ps = container.querySelectorAll('p');
    expect(ps[0]?.textContent).toBe('NO BETS');
    expect(ps[1]?.textContent).toBe('Place one to get started.');
  });

  it('renders the hint line below the body when provided', () => {
    const { getByText, container } = render(
      <EmptyState hint={<span>browse</span>}>Empty.</EmptyState>,
    );
    expect(getByText('Empty.')).toBeTruthy();
    expect(getByText('browse')).toBeTruthy();
    const ps = container.querySelectorAll('p');
    expect(ps).toHaveLength(2);
    expect(ps[0]?.textContent).toBe('Empty.');
    expect(ps[1]?.textContent).toBe('browse');
  });

  it('left-aligns when centred=false', () => {
    const { container } = render(
      <EmptyState centred={false}>Left side.</EmptyState>,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.style.alignItems).toBe('flex-start');
    expect(root.style.textAlign).toBe('left');
  });
});
