// ── features/match/ui/viewer/EventStrip.test.tsx ────────────────────────────
// The event strip under the pitch (docs/match-viewer.md section 7): always
// three rows high, newest first and brightest, hidden from screen readers,
// the card swatch the only colour, names that truncate rather than wrap.

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { color, tone } from '../../../../shared/design';
import type { EventRow } from '../../logic/viewer';
import { EventStrip } from './EventStrip';

const nameOf = (p: number): string => `${p + 1} Player ${p}`;
const clubOf = (): string => 'Mars Athletic';
const row = (key: string, kind: EventRow['kind'], sec: number, who: number, other: number | null = null): EventRow => ({ key, kind, sec, who, other });

function strip(rows: EventRow[]) {
  const { container } = render(<EventStrip rows={rows} nameOf={nameOf} clubOf={clubOf} reducedMotion />);
  const el = container.querySelector('[data-testid="event-strip"]') as HTMLElement;
  return { el, cells: Array.from(el.children) as HTMLElement[] };
}

describe('EventStrip', () => {
  it('is three rows high whatever it holds, and hidden from screen readers', () => {
    const empty = strip([]);
    expect(empty.el.getAttribute('aria-hidden')).toBe('true');
    expect(empty.cells).toHaveLength(9);
    const one = strip([row('a', 'tackle', 1294, 16, 9)]);
    expect(one.cells).toHaveLength(9);
    expect(one.cells[0]!.textContent).toBe(`22'34"`);
    expect(one.cells[1]!.textContent).toBe('TACKLE');
    expect(one.cells[2]!.textContent).toBe('17 Player 16 wins it from 10 Player 9');
  });

  it('newest row brightest: primary, secondary, tertiary', () => {
    const { cells } = strip([row('c', 'corner', 30, 7), row('b', 'foul', 20, 3, 10), row('a', 'tackle', 10, 1, 12)]);
    expect(cells[2]!.style.color).toBe(tone.primary.color);
    expect(cells[5]!.style.color).toBe(tone.secondary.color);
    expect(cells[8]!.style.color).toBe(tone.tertiary.color);
  });

  it('a card row carries a swatch in the card colour; nothing else has a colour of its own', () => {
    const { el } = strip([row('r', 'red', 20, 3), row('y', 'yellow', 10, 4), row('g', 'goal', 5, 9)]);
    const swatches = Array.from(el.querySelectorAll('span span')) as HTMLElement[];
    expect(swatches.map((s) => s.style.background)).toEqual([color.live, color.cardYellow]);
  });

  it('a GOAL row is bold (weight only); the who truncates with an ellipsis, the clock and label never wrap', () => {
    const { cells } = strip([row('g', 'goal', 5, 9)]);
    expect(cells[2]!.style.fontWeight).toBe('700');
    expect(cells[2]!.style.textOverflow).toBe('ellipsis');
    expect(cells[2]!.style.whiteSpace).toBe('nowrap');
    expect(cells[0]!.style.whiteSpace).toBe('nowrap');
    expect(cells[1]!.style.whiteSpace).toBe('nowrap');
  });

  it('a substitution names both players and the club', () => {
    const { cells } = strip([row('s', 'sub', 3300, 23, 4)]);
    expect(cells[1]!.textContent).toBe('SUBSTITUTION');
    expect(cells[2]!.textContent).toBe('24 Player 23 on, 5 Player 4 off, Mars Athletic');
  });
});
