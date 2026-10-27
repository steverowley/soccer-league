// ── StandingsTable.test.tsx ─────────────────────────────────────────────────
// WHY: #400 made standings columns sortable. The sort logic is pure (sortRows)
// but lives inside a component file so it isn't exported — we exercise it via
// the rendered table to also catch the click-handler + aria-sort wiring in
// one pass.
//
// Coverage:
//   • initial render preserves canonical position order
//   • clicking a numeric header sorts ascending (default for that key)
//   • clicking again flips direction
//   • a header with no `sortable` flag stays inert
//   • aria-sort reflects the active column

import { describe, it, expect } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import StandingsTable from './StandingsTable';

/** Build a row with sensible defaults so test bodies only specify the fields they care about. */
function row(overrides: Record<string, unknown>) {
  return {
    id:       String(overrides.id ?? Math.random()),
    position: 0,
    team:     'Team',
    played:   10,
    wins:     0,
    draws:    0,
    loses:    0,
    gd:       0,
    points:   0,
    ...overrides,
  };
}

function renderTable(rows: ReturnType<typeof row>[]) {
  return render(
    <MemoryRouter>
      <StandingsTable rows={rows as never} />
    </MemoryRouter>,
  );
}

const SAMPLE = [
  row({ id: 'a', position: 1, team: 'Alpha',   wins: 5, gd:  6, points: 17 }),
  row({ id: 'b', position: 2, team: 'Beta',    wins: 4, gd:  2, points: 13 }),
  row({ id: 'c', position: 3, team: 'Gamma',   wins: 2, gd: -4, points:  7 }),
];

/** Returns the body row order as an array of team names. */
function bodyOrder(container: HTMLElement): string[] {
  const rows = container.querySelectorAll('tbody tr');
  return Array.from(rows).map((r) => {
    const link = r.querySelector('td:nth-child(2) a, td:nth-child(2) span');
    return link?.textContent?.trim() ?? '';
  });
}

describe('StandingsTable sort (#400)', () => {
  it('renders rows in canonical position order by default', () => {
    const { container } = renderTable(SAMPLE);
    expect(bodyOrder(container)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('flips to descending wins when the W header is clicked twice', () => {
    const { container, getByText } = renderTable(SAMPLE);
    const wHeader = getByText('W').closest('th')!;

    // First click on W defaults to 'desc' (W is bigger=better) — but since
    // SAMPLE already has Alpha (5) > Beta (4) > Gamma (2) the order doesn't
    // change. Confirm aria-sort flipped.
    fireEvent.click(wHeader);
    expect(wHeader.getAttribute('aria-sort')).toBe('descending');
    expect(bodyOrder(container)).toEqual(['Alpha', 'Beta', 'Gamma']);

    // Second click flips to ascending — now Gamma should lead.
    fireEvent.click(wHeader);
    expect(wHeader.getAttribute('aria-sort')).toBe('ascending');
    expect(bodyOrder(container)).toEqual(['Gamma', 'Beta', 'Alpha']);
  });

  it('GD sort reorders correctly including negatives', () => {
    const { container, getByText } = renderTable(SAMPLE);
    const gdHeader = getByText('GD').closest('th')!;
    fireEvent.click(gdHeader);
    // Default for gd is 'desc' — Alpha (+6), Beta (+2), Gamma (-4).
    expect(bodyOrder(container)).toEqual(['Alpha', 'Beta', 'Gamma']);
    fireEvent.click(gdHeader);
    expect(bodyOrder(container)).toEqual(['Gamma', 'Beta', 'Alpha']);
  });

  it('Club header is inert (non-sortable)', () => {
    const { getByText } = renderTable(SAMPLE);
    const clubHeader = getByText('Club').closest('th')!;
    expect(clubHeader.getAttribute('aria-sort')).toBeNull();
    expect(clubHeader.style.cursor).toBe('default');
  });

  it('aria-sort on non-active sortable headers is "none"', () => {
    const { getByText } = renderTable(SAMPLE);
    const ptsHeader = getByText('Pts').closest('th')!;
    // Active default is #/pos, so Pts should be 'none' until clicked.
    expect(ptsHeader.getAttribute('aria-sort')).toBe('none');
  });
});

describe('StandingsTable design language', () => {
  it('shows tied ranks as "=N" and keeps them when sorted by another column', () => {
    const rows = [
      row({ id: 'a', position: 1, team: 'Alpha', points: 3, gd: 2, gf: 3, wins: 1 }),
      row({ id: 'b', position: 2, team: 'Beta',  points: 3, gd: 2, gf: 3, wins: 1 }),
      row({ id: 'c', position: 3, team: 'Gamma', points: 1, gd: 0, gf: 1, wins: 0 }),
    ];
    const { container, getByText } = renderTable(rows);
    const ranks = () => Array.from(container.querySelectorAll('tbody tr td:first-child')).map((td) => td.textContent);
    expect(ranks()).toEqual(['=1', '=1', '3']);
    fireEvent.click(getByText('W').closest('th')!);
    fireEvent.click(getByText('W').closest('th')!);
    expect(bodyOrder(container)[0]).toBe('Gamma');
    expect(ranks()[0]).toBe('3');
  });

  it('draws a 16 px crest in the club colour beside each club', () => {
    const { container } = renderTable([row({ id: 'earth-united', position: 1, team: 'Earth United' })]);
    const crest = container.querySelector('tbody svg[data-crest-size="16"]');
    expect(crest).toBeTruthy();
    expect(crest!.querySelector('polygon')!.getAttribute('fill')).not.toBe('var(--isl-line)');
  });

  it('never paints a rank or a loss red (red means live or error)', () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      row({ id: `t${i}`, position: i + 1, team: `Team ${i}`, points: 10 - i, loses: 5, form: ['L', 'L'] }),
    );
    const { container } = renderTable(rows);
    const reds = Array.from(container.querySelectorAll<HTMLElement>('tbody *'))
      .filter((el) => el.style.color === 'var(--isl-live)' || el.style.borderColor === 'var(--isl-live)');
    expect(reds).toEqual([]);
  });
});
