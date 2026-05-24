// ── shared/ui/Chip.test.tsx ───────────────────────────────────────────────
// Smoke tests for the Chip primitive (#378). Locks down the public
// surface so future migrations consume a stable API.

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Chip } from './Chip';

describe('Chip', () => {
  it('renders children inside a bordered small-caps span', () => {
    const { getByText, container } = render(<Chip>LIVE</Chip>);
    expect(getByText('LIVE')).toBeTruthy();

    const root = container.firstChild as HTMLElement;
    expect(root.tagName).toBe('SPAN');
    expect(root.style.border).toMatch(/1px solid/);
    expect(root.style.textTransform).toBe('uppercase');
    expect(root.style.fontSize).toBe('11px');
  });

  it('swaps border + text colour for tone="flare"', () => {
    const { container } = render(<Chip tone="flare">SOLD OUT</Chip>);
    const root = container.firstChild as HTMLElement;
    // FLARE = #FF4F5E — applies to both border and text under the
    // single-colour-error convention.
    expect(root.style.border.toLowerCase()).toMatch(/#ff4f5e|rgb\(255, 79, 94\)/);
    expect(root.style.color.toLowerCase()).toMatch(/#ff4f5e|rgb\(255, 79, 94\)/);
  });

  it('uses DUST text for tone="quantum" (focus, not error)', () => {
    const { container } = render(<Chip tone="quantum">FOCUS</Chip>);
    const root = container.firstChild as HTMLElement;
    // Border is QUANTUM (#9A5CF4), text stays DUST (#E3E0D5) so the
    // chip reads as "highlighted neutral" rather than coloured.
    expect(root.style.border.toLowerCase()).toMatch(/#9a5cf4|rgb\(154, 92, 244\)/);
    expect(root.style.color.toLowerCase()).toMatch(/#e3e0d5|rgb\(227, 224, 213\)/);
  });

  it('merges through a custom style prop', () => {
    const { container } = render(
      <Chip style={{ marginLeft: 8 }}>EXTRA</Chip>,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.style.marginLeft).toBe('8px');
    // Primitive's own props survive alongside the override.
    expect(root.style.fontSize).toBe('11px');
  });
});
