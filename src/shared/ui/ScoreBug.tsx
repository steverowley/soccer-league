// ── shared/ui/ScoreBug.tsx ────────────────────────────────────────────────
// The score as a broadcast puts it on screen (docs/design-language.md,
// sections 2 and 6): the two figures in the condensed `score` type on a
// raised block, separated by a quiet middot.
//
// WHY one component: Home's featured match and the match page each set the
// score inline. Broadcast gives the score its own graphic, the "score bug",
// and two copies of a graphic drift one pixel at a time. The block is the
// raised surface (the tone for things that sit on top), square, no outline.
//
// Accessibility: the visible figures are decorative digits; the block has
// an accessible name ("2 to 1") so a screen reader hears the score, not
// "2 dot 1".

import type { CSSProperties } from 'react';
import { color, glyph, space, tone, type } from '../design';

interface ScoreBugProps {
  /** Home goals, or a dash before kick-off. */
  home: number | string;
  /** Away goals, or a dash before kick-off. */
  away: number | string;
  /** One-off layout overrides (alignment, margins). Never colours or type. */
  style?: CSSProperties;
}

/**
 * Home and away goals in a broadcast score bug.
 *
 * @returns A raised inline block with the score in the score type.
 */
export function ScoreBug({ home, away, style }: ScoreBugProps) {
  return (
    <span
      role="img"
      aria-label={typeof home === 'number' && typeof away === 'number' ? `${home} to ${away}` : 'No score yet'}
      data-score-bug=""
      style={{
        ...type.score,
        display: 'inline-flex',
        alignItems: 'center',
        gap: space[12],
        background: color.surfaceRaised,
        paddingTop: space[8],
        paddingBottom: space[8],
        paddingLeft: space[16],
        paddingRight: space[16],
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      <span aria-hidden="true">{home}</span>
      <span aria-hidden="true" style={tone.tertiary}>{glyph.middot}</span>
      <span aria-hidden="true">{away}</span>
    </span>
  );
}
