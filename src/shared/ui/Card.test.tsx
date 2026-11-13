// ── shared/ui/Card.test.tsx ───────────────────────────────────────────────
// Smoke tests for the Card primitive: the hairline box with no fill, the
// three meaningful tones, the padding token and the link form.

import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { Card } from './Card';

describe('Card', () => {
  it('renders children in a 1 px box on the card-surface tokens and the card padding token', () => {
    const { getByText, container } = render(<Card>hello</Card>);
    expect(getByText('hello')).toBeTruthy();
    const root = container.firstChild as HTMLElement;
    expect(root.style.borderWidth).toBe('1px');
    expect(root.style.borderStyle).toBe('solid');
    // Today these resolve to the structural line and no fill (tokens.test.ts
    // holds the defaults); a design-direction preview may swap them.
    expect(root.style.borderColor).toBe('var(--isl-card-edge)');
    expect(root.style.background).toBe('var(--isl-card-fill)');
    expect(root.style.padding).toBe('var(--isl-pad-card)');
  });

  it('respects an explicit padding override', () => {
    const { container } = render(<Card padding={0}>flush</Card>);
    expect((container.firstChild as HTMLElement).style.padding).toBe('0px');
  });

  it('paints a red border for tone="live"', () => {
    const { container } = render(<Card tone="live">now</Card>);
    expect((container.firstChild as HTMLElement).style.borderColor).toBe('var(--isl-live)');
  });

  it('paints a purple border and resting glow for tone="architect"', () => {
    const { container } = render(<Card tone="architect">decree</Card>);
    const root = container.firstChild as HTMLElement;
    expect(root.style.borderColor).toBe('var(--isl-architect)');
    expect(root.style.boxShadow).toBe('var(--isl-glow-architect)');
  });

  it('merges through a custom style prop', () => {
    const { container } = render(<Card style={{ minHeight: 280 }}>tall</Card>);
    const root = container.firstChild as HTMLElement;
    expect(root.style.minHeight).toBe('280px');
    expect(root.style.padding).toBe('var(--isl-pad-card)');
  });

  it('renders as a router link when `to` is set, with no underline', () => {
    const { getByRole } = render(
      <MemoryRouter>
        <Card to="/leagues/x">clickable</Card>
      </MemoryRouter>,
    );
    const link = getByRole('link', { name: 'clickable' });
    expect(link.getAttribute('href')).toBe('/leagues/x');
    expect(link.style.textDecoration).toBe('none');
    expect(link.style.borderWidth).toBe('1px');
  });
});
