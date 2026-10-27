// ── shared/ui/groupThree.test.tsx ─────────────────────────────────────────
// Tests for the pieces the clubs-and-people migration (group 3) added to
// the design system: FormStrip / FormPip, DataTable, FactGrid / FactRows.
//
// They pin the colour meanings the review (#723) found broken: a win is the
// success colour, a draw and a loss are neutral, and nothing here is ever
// red (red means live or went wrong).

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DataTable, FactGrid, FactRows, FormPip, FormStrip, dataCell, dataHead } from './index';

describe('FormPip', () => {
  it('draws a win in the success colour', () => {
    render(<FormPip result="W" />);
    const pip = screen.getByText('W');
    expect(pip.style.color).toBe('var(--isl-success)');
    expect(pip.style.borderColor).toBe('var(--isl-success)');
  });

  it('draws a draw and a loss in neutral tones, never red', () => {
    render(<><FormPip result="D" /><FormPip result="L" /></>);
    expect(screen.getByText('D').style.color).toBe('var(--isl-text-secondary)');
    expect(screen.getByText('L').style.color).toBe('var(--isl-text-tertiary)');
    for (const r of ['D', 'L']) {
      expect(screen.getByText(r).style.color).not.toContain('live');
      expect(screen.getByText(r).style.borderColor).toBe('var(--isl-line)');
    }
  });

  it('draws an empty slot as a dash', () => {
    render(<FormPip result={null} />);
    expect(screen.getByText('\u2014').style.borderColor).toBe('var(--isl-line-faint)');
  });
});

describe('FormStrip', () => {
  it('pads to a fixed number of slots and names the results for screen readers', () => {
    render(<FormStrip form={['W', 'L']} slots={5} />);
    const strip = screen.getByRole('img');
    expect(strip.getAttribute('aria-label')).toBe('Form, most recent first: Won, Lost');
    expect(strip.children).toHaveLength(5);
  });

  it('keeps one empty slot when there are no results', () => {
    render(<FormStrip form={[]} />);
    const strip = screen.getByRole('img', { name: 'No results yet' });
    expect(strip.children).toHaveLength(1);
  });
});

describe('DataTable', () => {
  it('uses label headers, small cells and faint row rules', () => {
    render(
      <DataTable caption="Squad">
        <thead><tr><th style={dataHead('right', 48)}>#</th></tr></thead>
        <tbody><tr><td style={dataCell()}>Marco</td></tr></tbody>
      </DataTable>,
    );
    const table = screen.getByRole('table', { name: 'Squad' });
    expect(table.style.fontSize).toBe('var(--isl-size-small)');
    expect(table.style.fontVariantNumeric).toBe('tabular-nums');
    const th = screen.getByText('#');
    expect(th.style.fontSize).toBe('var(--isl-size-label)');
    expect(th.style.textAlign).toBe('right');
    expect(th.style.width).toBe('48px');
    expect(screen.getByText('Marco').style.borderBottom).toContain('var(--isl-line-faint)');
  });
});

describe('FactGrid and FactRows', () => {
  it('renders label-over-value pairs as a definition list', () => {
    const { container } = render(<FactGrid facts={[['Home kit', 'Blue'], ['Fans', 'The Marbles']]} />);
    expect(container.querySelectorAll('dt')).toHaveLength(2);
    expect(screen.getByText('Home kit').style.fontSize).toBe('var(--isl-size-label)');
    expect(screen.getByText('Blue').style.color).toBe('var(--isl-text)');
  });

  it('renders rows without bullets', () => {
    render(<FactRows label="Wants" items={[{ key: 'a', content: 'To be quoted.' }]} />);
    const list = screen.getByRole('list');
    expect(list.style.listStyle).toBe('none');
    expect(screen.getByText('Wants')).toBeTruthy();
    expect(screen.getByText('To be quoted.').style.borderTop).toContain('var(--isl-line-faint)');
  });
});
