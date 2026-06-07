// ── shared/ui/SectionPanel.test.tsx ───────────────────────────────────────
// Smoke tests for the SectionPanel primitive (#378). Locks down the API +
// the header-strip chrome so migrations consume a stable surface.

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SectionPanel } from './SectionPanel';

describe('SectionPanel', () => {
  it('renders the title, body, and a bordered flex-column container', () => {
    const { getByText, container } = render(
      <SectionPanel title="Upcoming Fixtures">body content</SectionPanel>,
    );
    expect(getByText('Upcoming Fixtures')).toBeTruthy();
    expect(getByText('body content')).toBeTruthy();
    const root = container.firstChild as HTMLElement;
    expect(root.style.border).toMatch(/1px solid/);
    expect(root.style.display).toBe('flex');
    expect(root.style.flexDirection).toBe('column');
    expect(root.style.padding).toBe('24px');
  });

  it('renders the meta when provided', () => {
    const { getByText } = render(<SectionPanel title="T" meta="Next 48h">b</SectionPanel>);
    expect(getByText('Next 48h')).toBeTruthy();
  });

  it('omits the meta span when no meta is given', () => {
    const { queryByText } = render(<SectionPanel title="T">b</SectionPanel>);
    expect(queryByText('Next 48h')).toBeNull();
  });

  it('puts the title + meta in an underlined header strip', () => {
    const { getByText } = render(
      <SectionPanel title="Title" meta="Meta">b</SectionPanel>,
    );
    // The <header> is the title span's parent; assert the hairline divider.
    const header = getByText('Title').parentElement as HTMLElement;
    expect(header.tagName).toBe('HEADER');
    expect(header.style.borderBottom).toMatch(/1px solid/);
    expect(header.style.textTransform).toBe('uppercase');
  });

  it('respects an explicit padding override and merges custom style', () => {
    const { container } = render(
      <SectionPanel title="T" padding={0} style={{ minHeight: 280 }}>b</SectionPanel>,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.style.padding).toBe('0px');
    expect(root.style.minHeight).toBe('280px');
    // The primitive's own layout survives alongside the override.
    expect(root.style.flexDirection).toBe('column');
  });
});
