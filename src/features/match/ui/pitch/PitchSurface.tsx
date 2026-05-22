// ── features/match/ui/pitch/PitchSurface.tsx ────────────────────────────────
// Static SVG pitch markings — the bare playing surface the choreographer
// (issues 3/6 onward) overlays player dots onto.  No state, no DOM
// listeners, no per-frame updates.
//
// VIEWBOX
//   100 × 64 in normalised pitch units.  Matches the [0..1] coordinate
//   space used by formations.ts (×100 for x, ×64 for y) so the surface
//   and the dot layer share the same numeric reference frame — a dot
//   at (0.5, 0.5) lands exactly at the centre spot.
//
// PROPORTIONS
//   The 100:64 ratio approximates a real pitch (105 m × 68 m) closely
//   enough that goalmouth / centre-circle / penalty-box markings feel
//   right at a glance without copying FIFA's exact aspect ratio.  We
//   prefer round numbers (every coord is divisible by 4) so the SVG
//   markup stays readable in PR diffs.
//
// STROKE
//   `COLORS.hairline` for every line — same opacity-modulated dust
//   token used by the rest of the editorial chrome.  The pitch reads
//   as "etched into" the page rather than overlaying it, matching
//   the StandingsTable / MatchCard treatment.
//
// PURE COMPONENT
//   No props (yet).  A future iteration may parameterise stroke colour
//   for night/day match treatments, but the spec for 2/6 keeps it
//   static; the parameterisation will be additive when needed.

import { COLORS } from '../../../../components/Layout';

/**
 * Pitch viewport width in SVG user units.  Drives the `viewBox` and
 * every marking coordinate; tweaking would scale the entire surface.
 */
export const PITCH_VIEWBOX_WIDTH = 100;

/**
 * Pitch viewport height in SVG user units.  Aspect ratio 100:64 ≈ the
 * real-pitch 105:68 m ratio.
 */
export const PITCH_VIEWBOX_HEIGHT = 64;

/**
 * Stroke width (SVG user units) for every line on the surface.  0.4
 * = ~0.4% of pitch width, which renders as a crisp single-pixel
 * hairline at typical viewport sizes without disappearing at small
 * widths.
 */
const STROKE_WIDTH = 0.4;

/**
 * Penalty-box dimensions.  X = 12, Y = 36 chosen so the box covers
 * roughly the inner two-thirds of the goal line and extends 12 units
 * (≈12% of pitch length) outward — visually matches the real-pitch
 * 16.5 m × 40.3 m proportions at our 100 × 64 scale.
 */
const PEN_BOX_DEPTH = 12;
const PEN_BOX_WIDTH = 36;

/**
 * Six-yard-box dimensions.  Half the penalty box's depth (X=5) and
 * about half its width (Y=20) — same proportional shrink real pitches
 * use.
 */
const SIX_YARD_DEPTH = 5;
const SIX_YARD_WIDTH = 20;

/**
 * Centre-circle radius in SVG user units.  9 ≈ the proportionally
 * scaled 9.15 m real-pitch radius.
 */
const CENTRE_CIRCLE_R = 9;

/**
 * Penalty-spot offset from the goal line.  8 SVG units ≈ 11 m
 * proportionally scaled — the FIFA standard.
 */
const PEN_SPOT_OFFSET = 8;

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Static SVG pitch surface.  Renders the touchlines, halfway line,
 * centre circle + spot, both penalty + six-yard boxes, and both
 * penalty spots.  Sits at the bottom of the SVG z-stack — the dot
 * layer (PitchView) paints over it.
 *
 * The SVG uses `preserveAspectRatio="xMidYMid meet"` so the surface
 * scales to whatever its parent gives it without distorting the
 * pitch proportions.  Width / height set to 100% so the wrapper
 * controls the actual on-page size.
 */
export function PitchSurface() {
  // Centre-line + centre-circle coordinates.  Derived from the viewbox
  // so changing the constants above re-anchors them automatically.
  const cx = PITCH_VIEWBOX_WIDTH  / 2;
  const cy = PITCH_VIEWBOX_HEIGHT / 2;

  // Penalty-box vertical placement: centred on the y-axis.
  const penBoxTop    = (PITCH_VIEWBOX_HEIGHT - PEN_BOX_WIDTH) / 2;
  const sixYardTop   = (PITCH_VIEWBOX_HEIGHT - SIX_YARD_WIDTH) / 2;

  return (
    <svg
      role="presentation"
      viewBox={`0 0 ${PITCH_VIEWBOX_WIDTH} ${PITCH_VIEWBOX_HEIGHT}`}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      style={{ display: 'block' }}
    >
      {/* ── Pitch fill ────────────────────────────────────────────────────
          A dust-faint rectangle so the markings have a subtle backdrop
          to read against rather than the bare abyss page background. */}
      <rect
        x={0}
        y={0}
        width={PITCH_VIEWBOX_WIDTH}
        height={PITCH_VIEWBOX_HEIGHT}
        fill={COLORS.phobosAsh}
      />

      {/* ── Outer touchlines ──────────────────────────────────────────── */}
      <rect
        x={STROKE_WIDTH / 2}
        y={STROKE_WIDTH / 2}
        width={PITCH_VIEWBOX_WIDTH  - STROKE_WIDTH}
        height={PITCH_VIEWBOX_HEIGHT - STROKE_WIDTH}
        fill="none"
        stroke={COLORS.hairline}
        strokeWidth={STROKE_WIDTH}
      />

      {/* ── Halfway line ───────────────────────────────────────────────── */}
      <line
        x1={cx}
        y1={0}
        x2={cx}
        y2={PITCH_VIEWBOX_HEIGHT}
        stroke={COLORS.hairline}
        strokeWidth={STROKE_WIDTH}
      />

      {/* ── Centre circle + spot ───────────────────────────────────────── */}
      <circle
        cx={cx}
        cy={cy}
        r={CENTRE_CIRCLE_R}
        fill="none"
        stroke={COLORS.hairline}
        strokeWidth={STROKE_WIDTH}
      />
      <circle cx={cx} cy={cy} r={0.6} fill={COLORS.hairline} />

      {/* ── Home (left) penalty box ────────────────────────────────────── */}
      <rect
        x={0}
        y={penBoxTop}
        width={PEN_BOX_DEPTH}
        height={PEN_BOX_WIDTH}
        fill="none"
        stroke={COLORS.hairline}
        strokeWidth={STROKE_WIDTH}
      />
      {/* Home six-yard box */}
      <rect
        x={0}
        y={sixYardTop}
        width={SIX_YARD_DEPTH}
        height={SIX_YARD_WIDTH}
        fill="none"
        stroke={COLORS.hairline}
        strokeWidth={STROKE_WIDTH}
      />
      {/* Home penalty spot */}
      <circle cx={PEN_SPOT_OFFSET} cy={cy} r={0.6} fill={COLORS.hairline} />

      {/* ── Away (right) penalty box ───────────────────────────────────── */}
      <rect
        x={PITCH_VIEWBOX_WIDTH - PEN_BOX_DEPTH}
        y={penBoxTop}
        width={PEN_BOX_DEPTH}
        height={PEN_BOX_WIDTH}
        fill="none"
        stroke={COLORS.hairline}
        strokeWidth={STROKE_WIDTH}
      />
      {/* Away six-yard box */}
      <rect
        x={PITCH_VIEWBOX_WIDTH - SIX_YARD_DEPTH}
        y={sixYardTop}
        width={SIX_YARD_DEPTH}
        height={SIX_YARD_WIDTH}
        fill="none"
        stroke={COLORS.hairline}
        strokeWidth={STROKE_WIDTH}
      />
      {/* Away penalty spot */}
      <circle
        cx={PITCH_VIEWBOX_WIDTH - PEN_SPOT_OFFSET}
        cy={cy}
        r={0.6}
        fill={COLORS.hairline}
      />
    </svg>
  );
}
