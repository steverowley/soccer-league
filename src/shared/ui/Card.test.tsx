// ── shared/ui/Card.test.tsx ───────────────────────────────────────────────
// Smoke tests for the Card primitive (#378). Locks down the surface so
// future migrations consume a stable API.

import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { Card } from './Card';

describe('Card', () => {
  it('renders children inside a bordered abyss-filled container', () => {
    const { getByText, container } = render(
      <Card>hello</Card>,
    );
    expect(getByText('hello')).toBeTruthy();
    const root = container.firstChild as HTMLElement;
    // Hairline default — derived from the COLORS token, asserted via style.
    expect(root.style.border).toMatch(/1px solid/);
    expect(root.style.background).toMatch(/#111111|rgb\(17, 17, 17\)/);
    // Default padding = 24 px (DEFAULT_PADDING).
    expect(root.style.padding).toBe('24px');
  });

  it('respects an explicit padding override', () => {
    const { container } = render(<Card padding={0}>flush</Card>);
    const root = container.firstChild as HTMLElement;
    expect(root.style.padding).toBe('0px');
  });

  it('swaps the border colour for tone="flare"', () => {
    const { container } = render(<Card tone="flare">danger</Card>);
    const root = container.firstChild as HTMLElement;
    // FLARE = #FF4F5E. We don't lock the exact rgb-vs-hex serialisation;
    // just check it's not the hairline default.
    expect(root.style.border).not.toMatch(/rgba\(227, 224, 213/);
    expect(root.style.border.toLowerCase()).toMatch(/#ff4f5e|rgb\(255, 79, 94\)/);
  });

  it('merges through a custom style prop', () => {
    const { container } = render(
      <Card style={{ minHeight: 280 }}>tall</Card>,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.style.minHeight).toBe('280px');
    // The primitive's own properties survive alongside the override.
    expect(root.style.padding).toBe('24px');
  });

  it('renders as a router link when `to` is set, with no underline', () => {
    const { getByRole } = render(
      <MemoryRouter>
        <Card to="/leagues/x">clickable</Card>
      </MemoryRouter>,
    );
    const link = getByRole('link', { name: 'clickable' });
    expect(link.getAttribute('href')).toBe('/leagues/x');
    // Surface, not hyperlink: dust text, no underline, but still bordered.
    expect(link.style.textDecoration).toBe('none');
    expect(link.style.border).toMatch(/1px solid/);
  });
});
