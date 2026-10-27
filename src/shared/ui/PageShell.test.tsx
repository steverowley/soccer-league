// ── shared/ui/PageShell.test.tsx ──────────────────────────────────────────
// PageShell is the page frame: site header, a `main` landmark that grows so
// the footer sits at the bottom of short pages, then the footer. The site
// Header needs auth context, so it is replaced with a stub here: the test is
// about the frame, not the navigation.

import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../components/Header', () => ({
  default: () => <nav data-testid="site-header" />,
}));

import { PageShell } from './PageShell';

describe('PageShell', () => {
  it('frames the page: header, a growing main column with the section gap, footer', () => {
    const { container, getByTestId, getByText } = render(
      <MemoryRouter>
        <PageShell><p>page body</p></PageShell>
      </MemoryRouter>,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.style.minHeight).toBe('100vh');
    expect(root.style.flexDirection).toBe('column');
    expect(getByTestId('site-header')).toBeTruthy();

    const main = container.querySelector('main')!;
    expect(main.contains(getByText('page body'))).toBe(true);
    expect(main.style.flex).toMatch(/^1 0/);
    expect(main.style.gap).toBe('var(--isl-gap-section)');
    expect(main.style.paddingLeft).toBe('var(--isl-gutter)');
    expect(main.style.maxWidth).toBe('var(--isl-container)');

    // The footer follows main.
    expect(main.nextElementSibling?.tagName).toBe('FOOTER');
  });
});
