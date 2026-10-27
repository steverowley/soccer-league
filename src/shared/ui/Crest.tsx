// ── shared/ui/Crest.tsx ───────────────────────────────────────────────────
// The club crest (docs/design-language.md, section 6): the shield
// silhouette in the club colour, at one of four sizes.
//
// WHY: the review (#723) found three crest treatments (a clip-path shield
// on the match card, a monogram circle on the club page, nothing in tables).
// This is the one: the same five-point shield the old TeamCrest drew
// (flat top, straight sides to 65%, a point at the bottom), now an SVG so
// it scales cleanly from a 16 px table glyph to a 64 px header mark.
//
// The club colour is data (teams.color / leagueData), so it arrives as a
// prop; a missing colour paints a neutral line-coloured shield rather than
// an invisible one.

import type { CSSProperties } from 'react';
import { color as tokenColor } from '../design';

/** The four crest sizes, by width in px. */
export type CrestSize = 16 | 24 | 40 | 64;

// The shield is 7 wide by 8 tall (the old TeamCrest's 56 x 64 box).
const VIEW_W = 28;
const VIEW_H = 32;
const SHIELD = '0,0 28,0 28,20.8 14,32 0,20.8';

interface CrestProps {
  /** The club colour (hex from data). Null paints a neutral shield. */
  color: string | null | undefined;
  /** Width in px. Defaults to 24. */
  size?: CrestSize;
  /**
   * Accessible name (e.g. the club). Omit when the club is named in text
   * beside the crest, which is almost always: the crest is then decorative.
   */
  title?: string;
  /** One-off layout overrides. */
  style?: CSSProperties;
}

/**
 * Club shield silhouette.
 *
 * @param color  Club colour, or null for the neutral fallback.
 * @param size   Width in px: 16 (tables), 24 (lists), 40 (cards), 64 (headers).
 * @returns      An inline SVG.
 */
export function Crest({ color, size = 24, title, style }: CrestProps) {
  const height = Math.round((size * VIEW_H) / VIEW_W);
  const labelled = title != null && title !== '';
  return (
    <svg
      width={size}
      height={height}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      role={labelled ? 'img' : undefined}
      aria-label={labelled ? title : undefined}
      aria-hidden={labelled ? undefined : true}
      data-crest-size={size}
      style={{ flex: 'none', display: 'inline-block', verticalAlign: 'middle', ...style }}
    >
      <polygon
        points={SHIELD}
        fill={color ?? tokenColor.line}
        stroke={tokenColor.line}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
