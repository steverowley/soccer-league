// ── shared/ui/designComponents.test.tsx ───────────────────────────────────
// Tests for the design-language components (docs/design-language.md,
// section 6): Tag, LiveBadge, Crest, StatBlock, BackLink, Breadcrumbs,
// PageHeader, SectionHeader (+ toRoman). PageShell has its own file because
// it mocks the site Header.
//
// They pin the contract the pages rely on, not pixels: which element each
// renders, which tokens it uses, and the copy conventions (red dot with
// neutral text for live, "/" between crumbs, I/II/III numerals, one h1).

import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import {
  BackLink,
  Breadcrumbs,
  Crest,
  LiveBadge,
  PageHeader,
  SectionHeader,
  StatBlock,
  Tag,
  toRoman,
} from './index';

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('Tag', () => {
  it('is a label-type span in the secondary tone by default', () => {
    const { container } = render(<Tag>Dispatch</Tag>);
    const root = container.firstChild as HTMLElement;
    expect(root.tagName).toBe('SPAN');
    expect(root.style.fontSize).toBe('var(--isl-size-label)');
    expect(root.style.color).toBe('var(--isl-text-secondary)');
    expect(root.style.borderColor).toBe('var(--isl-line)');
  });

  it('carries tone colours for architect and success', () => {
    const { getByText } = render(<><Tag tone="architect">A</Tag><Tag tone="success">Won</Tag></>);
    expect(getByText('A').style.color).toBe('var(--isl-architect)');
    expect(getByText('Won').style.borderColor).toBe('var(--isl-success)');
  });

  it('becomes a toggle button with aria-pressed when clickable, dust-filled when selected', () => {
    const onClick = vi.fn();
    render(<Tag selected onClick={onClick}>All</Tag>);
    const btn = screen.getByRole('button', { name: 'All' });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.style.background).toBe('var(--isl-text)');
    expect(btn.style.color).toBe('var(--isl-bg)');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('LiveBadge', () => {
  it('shows a red dot and neutral "Live · 37\'" text', () => {
    const { container } = render(<LiveBadge minute={37} />);
    const root = container.firstChild as HTMLElement;
    expect(root.textContent).toBe("Live \u00B7 37'");
    expect(root.style.color).toBe('var(--isl-text)');
    const dot = root.querySelector('[data-live-dot]') as HTMLElement;
    expect(dot.style.background).toBe('var(--isl-live)');
    expect(dot.style.borderRadius).toBe('50%');
  });

  it('says just "Live" before the minute is known', () => {
    const { container } = render(<LiveBadge minute={null} />);
    expect(container.textContent).toBe('Live');
  });

  it('says "Full time" with no dot once the match is over', () => {
    const { container } = render(<LiveBadge minute={90} fullTime />);
    const root = container.firstChild as HTMLElement;
    expect(root.textContent).toBe('Full time');
    expect(root.querySelector('[data-live-dot]')).toBeNull();
    expect(root.style.color).toBe('var(--isl-text-secondary)');
  });
});

describe('Crest', () => {
  it('draws the shield in the club colour at the requested width', () => {
    const { container } = render(<Crest color="#4169E1" size={40} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('40');
    expect(svg.getAttribute('height')).toBe('46');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('polygon')!.getAttribute('fill')).toBe('#4169E1');
  });

  it('falls back to a neutral shield and can be labelled', () => {
    const { container } = render(<Crest color={null} title="Earth United" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Earth United');
    expect(container.querySelector('polygon')!.getAttribute('fill')).toBe('var(--isl-line)');
  });

  it('supports the four sizes', () => {
    for (const size of [16, 24, 40, 64] as const) {
      const { container } = render(<Crest color="#123456" size={size} />);
      expect(container.querySelector('svg')!.getAttribute('data-crest-size')).toBe(String(size));
    }
  });
});

describe('StatBlock', () => {
  it('puts a secondary label over a bold tabular value', () => {
    const { getByText } = render(<StatBlock label="Points" value={3} />);
    expect(getByText('Points').style.color).toBe('var(--isl-text-secondary)');
    const value = getByText('3');
    expect(value.style.fontWeight).toBe('700');
    expect(value.style.fontVariantNumeric).toBe('tabular-nums');
  });

  it('colours the value by meaning', () => {
    const { getByText } = render(<StatBlock label="Form" value="W" valueTone="success" />);
    expect(getByText('W').style.color).toBe('var(--isl-success)');
  });
});

describe('BackLink', () => {
  it('is one ◂ glyph and the destination', () => {
    wrap(<BackLink to="/leagues">All leagues</BackLink>);
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/leagues');
    expect(link.textContent).toBe('\u25C2All leagues');
    expect(link.style.color).toBe('var(--isl-text-secondary)');
  });
});

describe('Breadcrumbs', () => {
  it('separates crumbs with a slash and leaves the last unlinked', () => {
    wrap(<Breadcrumbs items={[{ label: 'Leagues', to: '/leagues' }, { label: 'Rocky Inner' }]} />);
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(nav.textContent).toBe('Leagues/Rocky Inner');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByText('Rocky Inner').getAttribute('aria-current')).toBe('page');
  });
});

describe('PageHeader', () => {
  it('renders exactly one h1 in the title type, under the eyebrow', () => {
    const { container } = wrap(<PageHeader eyebrow="Leagues" title="The four leagues" subtitle="Thirty-two clubs." />);
    const h1s = container.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    expect(h1s[0]!.textContent).toBe('The four leagues');
    expect(h1s[0]!.style.fontSize).toBe('var(--isl-size-title)');
    expect(screen.getByText('Leagues').style.color).toBe('var(--isl-text-secondary)');
    expect(screen.getByText('Thirty-two clubs.').style.fontSize).toBe('var(--isl-size-body)');
  });

  it('adds back link, crumbs, crest, meta and actions on a detail page', () => {
    const { container } = wrap(
      <PageHeader
        eyebrow="Leagues"
        title="Rocky Inner League"
        back={{ to: '/leagues', label: 'All leagues' }}
        crumbs={[{ label: 'Leagues', to: '/leagues' }, { label: 'Rocky Inner' }]}
        crest={<Crest color="#4169E1" size={64} />}
        meta={<StatBlock label="Clubs" value={8} />}
        actions={<span>act</span>}
      />,
    );
    expect(screen.getByText('All leagues')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeTruthy();
    expect(container.querySelector('svg[data-crest-size="64"]')).toBeTruthy();
    expect(screen.getByText('Clubs')).toBeTruthy();
    expect(screen.getByText('act')).toBeTruthy();
    expect((container.firstChild as HTMLElement).style.borderBottom).toMatch(/1px solid/);
  });
});

describe('SectionHeader', () => {
  it('renders "I · Label" over an h2 title, with an optional action', () => {
    const { container } = render(
      <SectionHeader index="I" label="Now" title="Live match" action={<a href="#x">All</a>} />,
    );
    expect(screen.getByText('I \u00B7 Now')).toBeTruthy();
    const h2 = container.querySelector('h2')!;
    expect(h2.textContent).toBe('Live match');
    expect(h2.style.fontSize).toBe('var(--isl-size-heading)');
    expect(screen.getByText('All')).toBeTruthy();
  });

  it('makes the label line the h2 when there is no title', () => {
    const { container } = render(<SectionHeader index="II" label="Standings" />);
    expect(container.querySelector('h2')!.textContent).toBe('II \u00B7 Standings');
  });
});

describe('toRoman', () => {
  it('numbers sections I, II, III ... in page order', () => {
    expect([1, 2, 3, 4, 5, 9, 10, 14].map(toRoman)).toEqual(['I', 'II', 'III', 'IV', 'V', 'IX', 'X', 'XIV']);
  });
});
