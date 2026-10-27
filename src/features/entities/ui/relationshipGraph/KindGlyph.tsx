// ── features/entities/ui/relationshipGraph/KindGlyph.tsx ────────────────────
// The glyph an entity tier is drawn with (see kindColor.ts for the table):
// circle, club shield, square, diamond, triangle, inverted triangle or ring.
//
//   <GlyphShape>  the bare SVG shape centred on (0, 0), for use INSIDE an
//                 <svg> (the relationship graph's nodes).
//   <KindGlyph>   a standalone inline <svg> of one glyph, for legends, lists
//                 and filter tags (the graph legend, the World atlas).
//
// Colours are tokens (kindColor) except the club shield, which takes the
// club's own colour as the Crest does everywhere else. Paint is set through
// `style` rather than presentation attributes so the `var(--isl-...)`
// tokens resolve in every renderer.

import type { CSSProperties } from 'react';
import { color as tokenColor } from '../../../../shared/design';
import { kindTier, tierColor, tierShape, type KindShape, type KindTier } from './kindColor';

/** The Crest's shield outline, on its 28 x 32 grid (see shared/ui/Crest). */
const SHIELD: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [28, 0], [28, 20.8], [14, 32], [0, 20.8],
];

/**
 * Points for a polygon, as an SVG `points` string.
 *
 * @param pts  [x, y] pairs.
 * @returns    "x,y x,y ...".
 */
function points(pts: ReadonlyArray<readonly [number, number]>): string {
  return pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
}

interface GlyphShapeProps {
  /** Which glyph. */
  shape: KindShape;
  /** Half the glyph's width in px (a circle's radius). */
  r: number;
  /** Fill (a token, or a club colour for the shield). */
  fill: string;
}

/**
 * One glyph centred on the origin, sized so every shape covers about the
 * same area as a circle of radius `r`.
 *
 * @returns An SVG shape element.
 */
export function GlyphShape({ shape, r, fill }: GlyphShapeProps) {
  const paint: CSSProperties = { fill, stroke: 'none' };
  switch (shape) {
    case 'square': {
      const s = r * 0.9;
      return <rect x={-s} y={-s} width={s * 2} height={s * 2} style={paint} />;
    }
    case 'diamond': {
      const d = r * 1.2;
      return <polygon points={points([[0, -d], [d, 0], [0, d], [-d, 0]])} style={paint} />;
    }
    case 'triangle': {
      const t = r * 1.25;
      return <polygon points={points([[0, -t], [t, t * 0.75], [-t, t * 0.75]])} style={paint} />;
    }
    case 'triangleDown': {
      const t = r * 1.25;
      return <polygon points={points([[0, t], [t, -t * 0.75], [-t, -t * 0.75]])} style={paint} />;
    }
    case 'ring':
      return (
        <circle
          r={Math.max(1, r - 1)}
          style={{ fill: 'none', stroke: fill, strokeWidth: Math.max(1.5, r / 3) }}
        />
      );
    case 'shield': {
      const w = r * 2;
      const scale = w / 28;
      const h = 32 * scale;
      const pts = SHIELD.map(([x, y]) => [x * scale - r, y * scale - h / 2] as const);
      return <polygon points={points(pts)} style={{ fill, stroke: tokenColor.line, strokeWidth: 1 }} />;
    }
    case 'circle':
    default:
      return <circle r={r} style={paint} />;
  }
}

interface KindGlyphProps {
  /** An entity kind (`entities.kind`). Ignored when `tier` is set. */
  kind?: string;
  /** A tier, for legends that list tiers rather than kinds. */
  tier?: KindTier;
  /** Glyph width in px. Defaults to 10. */
  size?: number;
  /** The club colour, for a club's shield (club colour is data). */
  clubColor?: string | null | undefined;
  /** Override the token colour (e.g. the Abyss colour on a selected Tag). */
  fill?: string;
}

/**
 * A standalone inline glyph for an entity kind or tier. Decorative: the
 * kind is always named in text beside it.
 *
 * @returns An aria-hidden inline <svg>.
 */
export function KindGlyph({ kind = '', tier, size = 10, clubColor, fill }: KindGlyphProps) {
  const t = tier ?? kindTier(kind);
  const shape = tierShape(t);
  const r = size / 2;
  const paint = fill ?? (t === 'club' ? (clubColor ?? tierColor(t)) : tierColor(t));
  // The shield is taller than it is wide; give every glyph the same box.
  const box = Math.ceil(size * 1.3);
  return (
    <svg
      width={box}
      height={box}
      viewBox={`${-box / 2} ${-box / 2} ${box} ${box}`}
      aria-hidden="true"
      style={{ flex: 'none', display: 'inline-block', verticalAlign: 'middle' }}
    >
      <GlyphShape shape={shape} r={r} fill={paint} />
    </svg>
  );
}
