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
import {
  useChoreographyQueue,
  type PitchEventInput,
} from './useChoreographyQueue';
import { PitchDebugOverlay } from './PitchDebugOverlay';

/**
 * Read the URL search params on every render to decide whether the
 * debug overlay should mount.  We avoid useSearchParams() here so
 * PitchView stays usable outside a react-router context (e.g. unit
 * tests, storybook).  The check is a single `URLSearchParams.has()`
 * — cheap enough to run unmemoised.
 */
function isPitchDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('pitchDebug') === '1';
  } catch {
    return false;
  }
}

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
 *
 * `events` is the optional stream of visible match events.  When
 * provided, the choreographer hook (isl-lfo) animates the dots in
 * lockstep with the commentary feed.  When omitted, the component
 * paints the static 4-4-2 rest state — same as the isl-5b6 baseline.
 */
export interface PitchViewProps {
  /** Home team formation key.  Defaults to 4-4-2. */
  homeFormation?: FormationKey;
  /** Away team formation key.  Defaults to 4-4-2. */
  awayFormation?: FormationKey;
  /**
   * Visible match-event stream — when present each new event drives a
   * choreography keyframe via the useChoreographyQueue hook.  Empty /
   * omitted means "static rest state".
   */
  events?:        readonly PitchEventInput[];
  /**
   * Pauses the choreography tick (mirrors RelationshipGraph's reduced-
   * motion gate).  Defaults to false.  When true the component still
   * paints the latest state but the tick interval stops draining.
   */
  paused?:        boolean;
  /**
   * Elapsed game minute the parent computed (typically via
   * `computeElapsedGameMinute` from the match feature).  Currently
   * only the debug overlay reads it — production rendering ignores
   * it because the choreographer is event-driven, not minute-driven.
   */
  currentMinute?: number;
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
  events,
  paused,
  currentMinute,
}: PitchViewProps = {}) {
  // ── Synthetic positional ids ──────────────────────────────────────────
  // Real-player wiring lands in 4/6 (isl-6da); for now we use stable
  // positional ids ("home-0".."home-10").  The choreographer keys
  // motion off these ids so swapping to real player ids later is just
  // a string substitution at the call site.
  const homeIds = Array.from({ length: 11 }, (_, i) => `home-${i}`);
  const awayIds = Array.from({ length: 11 }, (_, i) => `away-${i}`);

  // ── Animated state via the choreography hook (isl-lfo) ────────────────
  // When events are provided, the hook drives per-tick motion in
  // response to each visible event.  When events is undefined the
  // hook still runs but its queue stays empty — `idleDriftStep`
  // converges to the formation rest state on the first tick and the
  // surface reads as the static baseline (matches isl-5b6 v1).
  const choreography = useChoreographyQueue({
    homeFormation,
    awayFormation,
    homePlayerIds: homeIds,
    awayPlayerIds: awayIds,
    events:        events ?? [],
    paused:        paused ?? false,
  });
  const state = choreography.state;

  // Build the static rest-state once for the first paint (before the
  // hook has ticked).  initPitchState is referenced lazily — the hook
  // returns its own initial state on mount so we don't need to call
  // it here; keeping the import for type-checking and any future
  // server-render path.
  void initPitchState;

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
              the relationship-graph kind-colour convention.
              CSS transition on cx/cy delegates motion to the GPU — no
              rAF loop needed (isl-lfo). */}
          {state.players.map((p) => (
            <circle
              key={p.id}
              cx={p.x * PITCH_VIEWBOX_WIDTH}
              cy={p.y * PITCH_VIEWBOX_HEIGHT}
              r={PLAYER_RADIUS}
              fill={p.side === 'home' ? COLORS.dust : COLORS.quantum}
              stroke={COLORS.abyss}
              strokeWidth={0.3}
              style={{ transition: 'cx 600ms cubic-bezier(0.4, 0, 0.2, 1), cy 600ms cubic-bezier(0.4, 0, 0.2, 1)' }}
            />
          ))}

          {/* Ball: astro orange so it's the visually loudest dot on the
              surface and the eye immediately catches its position.
              Same CSS transition as the players keeps the motion arc
              in sync visually. */}
          <circle
            cx={state.ball.x * PITCH_VIEWBOX_WIDTH}
            cy={state.ball.y * PITCH_VIEWBOX_HEIGHT}
            r={BALL_RADIUS}
            fill={COLORS.astro}
            stroke={COLORS.abyss}
            strokeWidth={0.2}
            style={{ transition: 'cx 600ms cubic-bezier(0.4, 0, 0.2, 1), cy 600ms cubic-bezier(0.4, 0, 0.2, 1)' }}
          />
        </svg>
      </div>

      {/* ── Debug overlay (gated by ?pitchDebug=1) ───────────────────────
          Mounts inside the same absolute-positioned wrapper so it sits
          bottom-right of the pitch.  pointer-events: none on the
          overlay itself keeps clicks/hover passing through to the
          dots beneath. */}
      {isPitchDebugEnabled() && (
        <PitchDebugOverlay
          phase={choreography.phase}
          queueDepth={choreography.queueDepth}
          elapsedMinute={currentMinute ?? 0}
          events={events ?? []}
        />
      )}
    </div>
  );
}
