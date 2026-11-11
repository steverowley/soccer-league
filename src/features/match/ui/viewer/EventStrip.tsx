// ── features/match/ui/viewer/EventStrip.tsx ─────────────────────────────────
// The event strip under the pitch (docs/match-viewer.md section 7): the last
// few notable moments as words, newest on top.  Words belong under the
// pitch, not on it.
//
// LAYOUT
//   A fixed three rows (EVENT_STRIP_ROWS), so the page never jumps when a
//   row arrives: empty rows hold their height.  One grid for all rows, so
//   the clocks, labels and names line up in columns:
//     22'34"  TACKLE        17 Talus wins it from 10 Cruz
//   The clock and the label never shrink; the who-text truncates with an
//   ellipsis instead of wrapping onto a second line (a 390 px phone).
//
// STYLE (design system only)
//   Clock in type.small with tabular figures, the label in type.label, the
//   who in type.body.  Newest row tone.primary, then secondary, tertiary:
//   emphasis by brightness.  A GOAL row's names are bold (weight only, no
//   new colour).  The one colour in the strip is a card row's swatch: the
//   card-yellow token, or the live red for a red card.
//
// MOTION
//   A new row fades in over FADE_MS (no slide); none under reduced motion.
//
// ACCESSIBILITY
//   The strip is aria-hidden: it changes every few seconds.  Goals and red
//   cards are announced once each by MatchViewer's polite live region.

import { useEffect, useRef, type CSSProperties, type ReactElement } from 'react';

import { color, numeric, space, tone, type } from '../../../../shared/design';
import { EVENT_LABEL, EVENT_STRIP_ROWS, eventRowText, replayClock, type EventRow } from '../../logic/viewer';

/** A new row fades in over this long (ms); the brand's calm motion, at most 150. */
export const FADE_MS = 150;

/** Text tone by row age: the newest row is the brightest. */
const TONES = [tone.primary, tone.secondary, tone.tertiary] as const;

interface EventStripProps {
  /** The rows on show, newest first (eventRowsAt). */
  rows: readonly EventRow[];
  /** A roster index as the strip names him: "17 Talus", or "Number 7". */
  nameOf: (player: number) => string;
  /** His club's name (a substitution names it). */
  clubOf: (player: number) => string | null | undefined;
  /** No fade for reduced-motion users. */
  reducedMotion: boolean;
}

/**
 * The event strip: three rows of clock, label and who under the pitch.
 *
 * @returns An aria-hidden grid of exactly EVENT_STRIP_ROWS rows.
 */
export function EventStrip({ rows, nameOf, clubOf, reducedMotion }: EventStripProps) {
  // A new newest row fades in (its cells carry data-newest).
  const gridRef = useRef<HTMLDivElement | null>(null);
  const newestKey = rows[0]?.key ?? null;
  const shownKeyRef = useRef<string | null>(newestKey);
  useEffect(() => {
    if (newestKey == null || newestKey === shownKeyRef.current) return;
    shownKeyRef.current = newestKey;
    if (reducedMotion || !gridRef.current) return;
    for (const el of Array.from(gridRef.current.querySelectorAll<HTMLElement>('[data-newest]'))) {
      if (typeof el.animate === 'function') el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: 'ease-out' });
    }
  }, [newestKey, reducedMotion]);

  const cells: ReactElement[] = [];
  for (let i = 0; i < EVENT_STRIP_ROWS; i++) {
    const row = rows[i];
    const rowTone = TONES[Math.min(i, TONES.length - 1)]!;
    const newest = i === 0 ? { 'data-newest': '' } : {};
    if (!row) {
      // An empty row keeps its height (the who column's line).
      cells.push(
        <span key={`empty-${i}-c`} style={clockStyle(rowTone)} />,
        <span key={`empty-${i}-l`} style={labelStyle(rowTone)} />,
        <span key={`empty-${i}-w`} style={whoStyle(rowTone, false)}>
          {'\u00a0'}
        </span>,
      );
      continue;
    }
    const card = row.kind === 'yellow' ? color.cardYellow : row.kind === 'red' ? color.live : null;
    const goal = row.kind === 'goal' || row.kind === 'ownGoal';
    cells.push(
      <span key={`${row.key}-c`} {...newest} style={clockStyle(rowTone)}>
        {replayClock(row.sec)}
      </span>,
      <span key={`${row.key}-l`} {...newest} style={labelStyle(rowTone)}>
        {card && <span style={swatchStyle(card)} />}
        {EVENT_LABEL[row.kind]}
      </span>,
      <span key={`${row.key}-w`} {...newest} style={whoStyle(rowTone, goal)}>
        {eventRowText(row, nameOf, clubOf)}
      </span>,
    );
  }

  return (
    <div
      ref={gridRef}
      aria-hidden="true"
      data-testid="event-strip"
      style={{
        marginTop: space[8],
        display: 'grid',
        gridTemplateColumns: 'max-content max-content minmax(0, 1fr)',
        columnGap: space[12],
        alignItems: 'baseline',
        minWidth: 0,
      }}
    >
      {cells}
    </div>
  );
}

// Styles are built per call: a preset spread into a module-level object is
// a side effect to Rollup and can pull this module into the entry chunk.

function clockStyle(t: CSSProperties): CSSProperties {
  return { ...type.small, ...numeric, ...t, whiteSpace: 'nowrap' };
}

function labelStyle(t: CSSProperties): CSSProperties {
  return { ...type.label, ...t, whiteSpace: 'nowrap' };
}

function whoStyle(t: CSSProperties, bold: boolean): CSSProperties {
  return {
    ...type.body,
    ...t,
    ...(bold ? { fontWeight: 700 } : {}),
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };
}

/** A small card in the card's colour, before its label. */
function swatchStyle(fill: string): CSSProperties {
  return { display: 'inline-block', width: space[8], height: space[12], marginRight: space[8], background: fill };
}
