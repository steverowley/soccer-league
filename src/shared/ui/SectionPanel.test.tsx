// ── shared/ui/SectionPanel.test.tsx ───────────────────────────────────────
// Smoke tests for the SectionPanel primitive (#378): the hairline box, the
// header strip and the padding token.

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
    expect(root.style.borderWidth).toBe('1px');
    expect(root.style.display).toBe('flex');
    expect(root.style.flexDirection).toBe('column');
    expect(root.style.padding).toBe('var(--isl-pad-card)');
  });

  it('renders the meta when provided', () => {
    const { getByText } = render(<SectionPanel title="T" meta="Next 48h">b</SectionPanel>);
    expect(getByText('Next 48h').style.color).toBe('var(--isl-text-secondary)');
  });

  it('omits the meta span when no meta is given', () => {
    const { queryByText } = render(<SectionPanel title="T">b</SectionPanel>);
    expect(queryByText('Next 48h')).toBeNull();
  });

  it('puts the title and meta in an underlined label-type header strip', () => {
    const { getByText } = render(
      <SectionPanel title="Title" meta="Meta">b</SectionPanel>,
    );
    const header = getByText('Title').parentElement as HTMLElement;
    expect(header.tagName).toBe('HEADER');
    expect(header.style.borderBottom).toMatch(/1px solid/);
    expect(header.style.textTransform).toBe('uppercase');
    expect(header.style.fontSize).toBe('var(--isl-size-label)');
  });

  it('respects an explicit padding override and merges custom style', () => {
    const { container } = render(
      <SectionPanel title="T" padding={0} style={{ minHeight: 280 }}>b</SectionPanel>,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.style.padding).toBe('0px');
    expect(root.style.minHeight).toBe('280px');
    expect(root.style.flexDirection).toBe('column');
  });
});
