// ── shared/ui/PageHeader.test.tsx ─────────────────────────────────────────
// The club band (Broadcast): an `accent` colour draws a decorative band down
// the header's left edge; without one the header is unchanged.

import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { PageHeader } from './PageHeader';

describe('PageHeader club band', () => {
  it('draws the club colour as a decorative band when given an accent', () => {
    const { container } = render(
      <MemoryRouter><PageHeader eyebrow="Teams" title="Earth United" accent="#CD7F32" /></MemoryRouter>,
    );
    const band = container.querySelector<HTMLElement>('[data-club-band]');
    expect(band).not.toBeNull();
    expect(band!.getAttribute('aria-hidden')).toBe('true');
    expect(band!.style.background).toBe('rgb(205, 127, 50)');
  });

  it('has no band without an accent', () => {
    const { container } = render(<MemoryRouter><PageHeader eyebrow="Teams" title="Teams" /></MemoryRouter>);
    expect(container.querySelector('[data-club-band]')).toBeNull();
  });
});
