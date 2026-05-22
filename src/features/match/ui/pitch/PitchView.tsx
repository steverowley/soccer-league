// ── features/match/ui/pitch/PitchView.tsx ───────────────────────────────────
// Composes the static <PitchSurface> with 22 player dots + a centre-spot
// ball — the "rest state" of the pitch view.  No motion yet; this lives
// in issue 5b6 as the layout + visual chrome layer, and issue 3/6 (lfo)
// will add the per-event choreography on top.
//
// COMPOSITION
//   1. Wrapper <div> with the responsive aspect-ratio container so the
//      surface scales gracefully from desktop sidebar widths down to a
//      narrow phone column.
//   2. Stacked SVG: <PitchSurface /> at z-index 0, the dot/ball layer
//      over it.  Both SVGs share the same viewBox (100×64) so coords
//      from `initPitchState()` (normalised [0..1]) translate by ×100
//      / ×64 with no other transform math.
//
// DATA
//   Uses `initPitchState()` to produce a deterministic 4-4-2 rest state
//   for both teams.  Player ids are synthetic positional labels
//   (`home-0`..`home-10`) — the rest state doesn't need real player
//   data; live wiring lands in 3/6 alongside the choreographer.
//
// SCALE
//   Players: 1.5 SVG units radius (~1.5% of pitch length) — visually
//   distinct from the ball without dominating.  Ball: 1.0 unit radius
//   so the eye is drawn to it as the centre of action.

import { COLORS } from '../../../../components/Layout';
import {
  initPitchState,
  type FormationKey,
} from '../../logic/pitch';

import { PitchSurface, PITCH_VIEWBOX_HEIGHT, PITCH_VIEWBOX_WIDTH } from './PitchSurface';

/**
 * Default formation rendered for both sides when the caller doesn't
 * pass overrides.  4-4-2 reads as the canonical "balanced shape" so
 * the rest state looks immediately familiar to any soccer reader.
 */
const DEFAULT_FORMATION: FormationKey = '4-4-2';

/** SVG-unit radius for each player dot.  See module header for the rationale. */
const PLAYER_RADIUS = 1.5;

/** SVG-unit radius for the ball.  Smaller than players so the eye reads it as discrete. */
const BALL_RADIUS = 1.0;

// ── Public types ─────────────────────────────────────────────────────────────

/**
 * Props for <PitchView>.  Both formations default to 4-4-2 if omitted
 * so a typical "just render the rest state" call site is a single
 * `<PitchView />`.  Explicit formations are accepted so a future
 * caller (e.g. /admin?tab=fixtures preview) can paint a tactical
 * variant without forking the component.
 */
export interface PitchViewProps {
  /** Home team formation key.  Defaults to 4-4-2. */
  homeFormation?: FormationKey;
  /** Away team formation key.  Defaults to 4-4-2. */
  awayFormation?: FormationKey;
}

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Static "rest state" pitch view.  Renders the bare surface plus 22
 * player dots positioned at their formation slots and a ball at the
 * centre spot.  No animation, no event consumption yet — issue 3/6
 * (lfo) layers the choreographer on top of this composition.
 *
 * Sized via CSS aspect-ratio so the parent column controls width and
 * the surface fills it at the correct 100:64 ratio.  At narrow widths
 * the dots scale down proportionally — no special mobile branch
 * needed.
 *
 * @param props.homeFormation  Optional override for the home team
 *                             formation (defaults to 4-4-2).
 * @param props.awayFormation  Optional override for the away team
 *                             formation (defaults to 4-4-2).
 * @returns                    The composed pitch view subtree.
 */
export function PitchView({
  homeFormation = DEFAULT_FORMATION,
  awayFormation = DEFAULT_FORMATION,
}: PitchViewProps = {}) {
  // ── Rest-state snapshot ────────────────────────────────────────────────
  // initPitchState builds 22 PlayerDots at their slot coords plus a
  // ball at (0.5, 0.5).  We feed synthetic positional ids — the real-
  // player wiring lands in 3/6 alongside the event stream.
  const homeIds = Array.from({ length: 11 }, (_, i) => `home-${i}`);
  const awayIds = Array.from({ length: 11 }, (_, i) => `away-${i}`);
  const state = initPitchState({
    homeFormation,
    awayFormation,
    homePlayerIds: homeIds,
    awayPlayerIds: awayIds,
  });

  return (
    <div
      // CSS aspect-ratio keeps the wrapper's height proportional to its
      // width, so the surface fills whatever column the parent gives it
      // without distortion.  100:64 matches the SVG viewBox exactly so
      // the surface paints edge-to-edge.
      style={{
        position:    'relative',
        width:       '100%',
        aspectRatio: `${PITCH_VIEWBOX_WIDTH} / ${PITCH_VIEWBOX_HEIGHT}`,
        background:  COLORS.abyss,
        border:      `1px solid ${COLORS.hairline}`,
        boxSizing:   'border-box',
      }}
    >
      {/* ── Surface layer ─────────────────────────────────────────────── */}
      {/* Absolute positioning so the dot layer above can stack on the
          same coord space without flex / grid gap math intruding. */}
      <div style={{ position: 'absolute', inset: 0 }}>
        <PitchSurface />
      </div>

      {/* ── Dot + ball layer ──────────────────────────────────────────── */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <svg
          viewBox={`0 0 ${PITCH_VIEWBOX_WIDTH} ${PITCH_VIEWBOX_HEIGHT}`}
          width="100%"
          height="100%"
          preserveAspectRatio="xMidYMid meet"
          style={{ display: 'block' }}
        >
          {/* Players: dust-faint outline + per-side fill so home / away
              can be told apart at a glance.  Home = dust (the canonical
              "subject" colour), Away = quantum (focus colour) — matches
              the relationship-graph kind-colour convention. */}
          {state.players.map((p) => (
            <circle
              key={p.id}
              cx={p.x * PITCH_VIEWBOX_WIDTH}
              cy={p.y * PITCH_VIEWBOX_HEIGHT}
              r={PLAYER_RADIUS}
              fill={p.side === 'home' ? COLORS.dust : COLORS.quantum}
              stroke={COLORS.abyss}
              strokeWidth={0.3}
            />
          ))}

          {/* Ball: astro orange so it's the visually loudest dot on the
              surface and the eye immediately catches its position. */}
          <circle
            cx={state.ball.x * PITCH_VIEWBOX_WIDTH}
            cy={state.ball.y * PITCH_VIEWBOX_HEIGHT}
            r={BALL_RADIUS}
            fill={COLORS.astro}
            stroke={COLORS.abyss}
            strokeWidth={0.2}
          />
        </svg>
      </div>
    </div>
  );
}
