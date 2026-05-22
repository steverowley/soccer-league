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

import { useCallback, useEffect, useRef, useState } from 'react';

import { COLORS } from '../../../../components/Layout';
import {
  initPitchState,
  type FormationKey,
} from '../../logic/pitch';
// useReducedMotion lives on the entities feature barrel — it's a
// purely accessibility-themed media-query hook and intentionally
// shared across features rather than duplicated.  The cross-feature
// import is barrel-only (no deep path) so ESLint's
// no-restricted-imports doesn't flag it.
import { useReducedMotion } from '@features/entities';

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

/**
 * Total duration of an Architect-flair burst in milliseconds (isl-u8u).
 * Sub-700ms so the burst overlaps the per-event choreography window
 * (~600ms CSS transition) without extending past it — the user reads
 * the flair as "happening DURING" the event, not "after".
 */
const ARCHITECT_FLAIR_MS = 600;

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
/**
 * Minimal player descriptor the pitch view needs to render one dot.
 * Real callers (MatchPitchPanel) hydrate from the players table; the
 * `id` field is what the choreographer keys motion off so it must be
 * stable across re-renders.
 *
 * `jersey_number` is optional — surfaced as a small label inside the
 * dot when the viewport is wide enough to read at the default radius.
 */
export interface PitchPlayerInput {
  id:            string;
  name:          string;
  /** Two-letter position abbreviation (GK / DF / MF / FW). */
  position:      string;
  /** Optional jersey number rendered inside the dot when room allows. */
  jersey_number?: number | null;
}

export interface PitchViewProps {
  /** Home team formation key.  Defaults to 4-4-2. */
  homeFormation?: FormationKey;
  /** Away team formation key.  Defaults to 4-4-2. */
  awayFormation?: FormationKey;
  /**
   * 11 home-side player descriptors in slot order (GK first).  When
   * omitted, synthetic positional ids fall back to the pre-isl-6da
   * rest-state behaviour so the component still renders meaningfully
   * during loading / standalone use.
   */
  homePlayers?:   readonly PitchPlayerInput[];
  /** 11 away-side player descriptors in slot order (GK first). */
  awayPlayers?:   readonly PitchPlayerInput[];
  /**
   * Team brand colour for each side — drives the dot fill.  Falls
   * back to the canonical dust (home) / quantum (away) palette when
   * either side's colour is missing, matching the isl-5b6 baseline.
   */
  homeTeamColor?: string | null;
  awayTeamColor?: string | null;
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
  /**
   * Home team display name + score so the SVG aria-label can read
   * out the natural-language scoreline for screen readers (isl-7rh).
   * Omitting either falls back to a generic "Match pitch view"
   * label.
   */
  homeTeamName?: string;
  homeScore?:    number;
  awayTeamName?: string;
  awayScore?:    number;
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
  homePlayers,
  awayPlayers,
  homeTeamColor,
  awayTeamColor,
  events,
  paused,
  currentMinute,
  homeTeamName,
  homeScore,
  awayTeamName,
  awayScore,
}: PitchViewProps = {}) {
  // ── Motion gates (isl-7rh polish) ─────────────────────────────────────
  // Aggregates three signals into a single boolean handed to the hook
  // and used to suppress CSS transitions:
  //   • Explicit `paused` prop (caller's choice).
  //   • OS-level `prefers-reduced-motion: reduce` preference.
  //   • Document visibility — when the tab is hidden we stop draining
  //     the queue so a background match page burns zero CPU.
  // The CSS transition is also stripped under any of these gates so a
  // reduced-motion user lands on a static snapshot instead of a
  // ghost-trail interpolation.
  const reducedMotion = useReducedMotion();
  const [tabHidden, setTabHidden] = useState<boolean>(() =>
    typeof document !== 'undefined' && document.visibilityState === 'hidden',
  );
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVis = () => setTabHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);
  const motionPaused = (paused ?? false) || reducedMotion || tabHidden;

  // ── Player id resolution (isl-6da) ────────────────────────────────────
  // Real player ids when the caller supplied them; otherwise fall back
  // to synthetic positional labels ("home-0".."home-10") so the rest-
  // state preview + standalone use cases still paint dots.  The
  // choreographer keys motion off whichever id flavour lands here.
  // If a caller supplied fewer than 11 players for either side we pad
  // with synthetic ids — better than refusing to render at all when a
  // partial-squad team would otherwise leave a half-empty pitch.
  const homeIds: string[] = Array.from({ length: 11 }, (_, i) =>
    homePlayers?.[i]?.id ?? `home-${i}`,
  );
  const awayIds: string[] = Array.from({ length: 11 }, (_, i) =>
    awayPlayers?.[i]?.id ?? `away-${i}`,
  );

  // Build lookup maps so the renderer can pull jersey numbers + names
  // by dot id without searching the supplied player array on every
  // render.  Slot index → player; absent slots stay undefined.
  const homePlayerBySlot = new Map<number, PitchPlayerInput | undefined>();
  const awayPlayerBySlot = new Map<number, PitchPlayerInput | undefined>();
  for (let i = 0; i < 11; i++) {
    homePlayerBySlot.set(i, homePlayers?.[i]);
    awayPlayerBySlot.set(i, awayPlayers?.[i]);
  }

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
    paused:        motionPaused,
  });
  const state = choreography.state;

  // ── Architect flair state (isl-u8u) ───────────────────────────────────
  // `flair` holds the most-recently-fired Architect intervention.  The
  // halo + flicker + ball-trail render against this snapshot for
  // ARCHITECT_FLAIR_MS milliseconds, then auto-clear.  We keep the
  // PREVIOUS ball position in a ref so the trail can paint a line
  // segment from the old spot to the current one without setState
  // churn between every tick.
  const [flair, setFlair] = useState<{
    /** Optional player whose dot should glow. */
    playerId?: string;
    /** Origin of the trail line — typically the ball position at
        the moment the flair fired. */
    fromBall: { x: number; y: number };
    /** Destination of the trail line — typically the next ball
        position the choreographer wrote. */
    toBall:   { x: number; y: number };
    /** Token for the auto-clear scheduler — clearing one fires
        cancels any in-flight teardown when a second flair lands
        on top. */
    token:    number;
  } | null>(null);

  /** Ref to the LAST seen ball position; used to seed `fromBall`. */
  const prevBallRef = useRef<{ x: number; y: number }>({ x: 0.5, y: 0.5 });

  /** Monotonic counter so the auto-clear setTimeout only fires when
      it matches the active flair (a second flair arriving inside
      the 600ms window invalidates the older clear). */
  const flairTokenRef = useRef<number>(0);

  // Watch every new event for an architect flag.  When one fires,
  // capture the ball positions before/after and schedule the auto-
  // clear.  Skipping the effect entirely under motionPaused honours
  // the same accessibility + visibility gates as the rest of the
  // surface — a reduced-motion user gets no Architect flicker.
  useEffect(() => {
    if (motionPaused) return;
    if (!events || events.length === 0) return;
    const last = events[events.length - 1];
    if (!last || !last.architectFlag) return;
    const token = ++flairTokenRef.current;
    setFlair({
      ...(last.playerId ? { playerId: last.playerId } : {}),
      fromBall: prevBallRef.current,
      toBall:   { x: state.ball.x, y: state.ball.y },
      token,
    });
    const handle = setTimeout(() => {
      // Only clear when we're STILL the active flair — a newer one
      // would have a higher token.  This guards against blanking a
      // freshly-fired second flair when the first one's setTimeout
      // resolves late.
      setFlair((prev) => (prev && prev.token === token ? null : prev));
    }, ARCHITECT_FLAIR_MS);
    return () => clearTimeout(handle);
  }, [events, motionPaused, state.ball.x, state.ball.y]);

  // Capture each post-render ball position into prevBallRef so the
  // next flair's `fromBall` reflects the actual previous spot.
  useEffect(() => {
    prevBallRef.current = { x: state.ball.x, y: state.ball.y };
  }, [state.ball.x, state.ball.y]);

  /**
   * Manual flair trigger for the debug overlay's "fire architect
   * flair" button (isl-u8u).  Reuses the same setFlair path so the
   * visual behaviour is identical to a real Architect event.
   */
  const fireDebugFlair = useCallback(() => {
    const token = ++flairTokenRef.current;
    setFlair({
      fromBall: prevBallRef.current,
      toBall:   { x: state.ball.x, y: state.ball.y },
      token,
    });
    setTimeout(() => {
      setFlair((prev) => (prev && prev.token === token ? null : prev));
    }, ARCHITECT_FLAIR_MS);
  }, [state.ball.x, state.ball.y]);

  /**
   * CSS transition string applied to every player + ball circle.
   * Suppressed (`'none'`) when reduced motion / paused / tab hidden
   * so the GPU doesn't interpolate between snapshots — the dot just
   * jumps to its new position instantly.
   */
  const dotTransition = motionPaused
    ? 'none'
    : 'cx 600ms cubic-bezier(0.4, 0, 0.2, 1), cy 600ms cubic-bezier(0.4, 0, 0.2, 1)';

  /**
   * Natural-language description of the current pitch state for
   * screen readers.  Falls back to a generic label when the parent
   * doesn't supply score / team names — better than emitting a
   * half-built sentence like "Match pitch view: 0".
   */
  const svgAriaLabel =
    homeTeamName != null && awayTeamName != null && homeScore != null && awayScore != null
      ? `Match pitch view. ${homeTeamName} ${homeScore}, ${awayTeamName} ${awayScore}. ` +
        (events && events.length > 0
          ? `Last event: ${events[events.length - 1]!.type.replace(/_/g, ' ')}.`
          : 'No events yet.')
      : 'Match pitch view.';

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
          same coord space without flex / grid gap math intruding.
          The `isl-pitch-flicker` class is toggled when an Architect
          flair is active — its CSS keyframes briefly drop the
          surface to 0.3 opacity then snap back, reading as a
          "reality-glitch" moment (isl-u8u). */}
      <div
        style={{ position: 'absolute', inset: 0 }}
        className={flair ? 'isl-pitch-flicker' : undefined}
      >
        <PitchSurface />
      </div>

      {/* ── Dot + ball layer ──────────────────────────────────────────── */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <svg
          // role="img" + aria-label expose a natural-language scoreline
          // + last-event summary for screen readers (isl-7rh).  Sighted
          // users get the same info from the commentary feed next door,
          // so the label here is the SR-only restatement.
          role="img"
          aria-label={svgAriaLabel}
          viewBox={`0 0 ${PITCH_VIEWBOX_WIDTH} ${PITCH_VIEWBOX_HEIGHT}`}
          width="100%"
          height="100%"
          preserveAspectRatio="xMidYMid meet"
          style={{ display: 'block' }}
        >
          {/* Players (isl-6da):
                • Fill inherits the team's brand colour when supplied;
                  falls back to dust (home) / quantum (away) so the
                  rest-state preview still reads cleanly when no
                  match row is attached.
                • Goalkeepers (slotIndex 0) get a thin quantum ring
                  so the eye picks out the keeper at a glance — even
                  at narrow viewport widths where the dot itself is
                  small.
                • Jersey numbers render as a tiny mono label inside
                  the dot when the player carries one.  The label
                  uses an SVG <text> with `pointer-events: none` so
                  it never intercepts the choreographer's hover/click
                  paths (none today, but kept consistent with the
                  relationship-graph node convention).
                • An active Architect flair (isl-u8u) layers a
                  quantum drop-shadow halo on the involved dot. */}
          {state.players.map((p) => {
            const isFlared = flair && flair.playerId === p.id;
            const isKeeper = p.slotIndex === 0;
            const sidePlayer =
              p.side === 'home' ? homePlayerBySlot.get(p.slotIndex) : awayPlayerBySlot.get(p.slotIndex);
            const fallbackFill = p.side === 'home' ? COLORS.dust : COLORS.quantum;
            const fill =
              (p.side === 'home' ? homeTeamColor : awayTeamColor) ?? fallbackFill;
            const cx = p.x * PITCH_VIEWBOX_WIDTH;
            const cy = p.y * PITCH_VIEWBOX_HEIGHT;
            return (
              <g key={p.id} style={{ transition: dotTransition }}>
                {/* GK ring — rendered FIRST so the dot fill paints
                    over its inner edge cleanly.  1.4× radius, thin
                    quantum stroke; no animation cost. */}
                {isKeeper && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={PLAYER_RADIUS * 1.4}
                    fill="none"
                    stroke={COLORS.quantum}
                    strokeWidth={0.4}
                    style={{ transition: dotTransition }}
                  />
                )}
                <circle
                  cx={cx}
                  cy={cy}
                  r={PLAYER_RADIUS}
                  fill={fill}
                  stroke={COLORS.abyss}
                  strokeWidth={0.3}
                  style={{
                    transition: dotTransition,
                    filter: isFlared
                      ? `drop-shadow(0 0 1.5px ${COLORS.quantum}) drop-shadow(0 0 3px ${COLORS.quantum})`
                      : undefined,
                  }}
                />
                {sidePlayer?.jersey_number != null && (
                  <text
                    x={cx}
                    y={cy + 0.6}
                    textAnchor="middle"
                    style={{
                      // 1.6 SVG units ≈ 8 px at typical viewport
                      // widths — small enough not to dominate the
                      // dot but readable on desktop.  Tabular-nums
                      // so two-digit jerseys align cleanly.
                      fontFamily:    'Space Mono, monospace',
                      fontSize:      1.6,
                      fontWeight:    700,
                      fill:          COLORS.abyss,
                      pointerEvents: 'none',
                      fontVariantNumeric: 'tabular-nums',
                      transition:    dotTransition,
                    }}
                  >
                    {sidePlayer.jersey_number}
                  </text>
                )}
              </g>
            );
          })}

          {/* Architect ball trail (isl-u8u): a quantum-coloured line
              segment from the previous ball position to the current
              one, fading out via the `isl-architect-trail` CSS
              animation.  Rendered BELOW the ball circle so the ball
              itself remains the visually loudest mark. */}
          {flair && (
            <line
              x1={flair.fromBall.x * PITCH_VIEWBOX_WIDTH}
              y1={flair.fromBall.y * PITCH_VIEWBOX_HEIGHT}
              x2={flair.toBall.x   * PITCH_VIEWBOX_WIDTH}
              y2={flair.toBall.y   * PITCH_VIEWBOX_HEIGHT}
              stroke={COLORS.quantum}
              strokeWidth={1.2}
              strokeLinecap="round"
              className="isl-architect-trail"
            />
          )}

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
            style={{ transition: dotTransition }}
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
          onFireArchitectFlair={fireDebugFlair}
        />
      )}

      {/* ── Architect flair keyframe CSS (isl-u8u) ──────────────────────
          Two animations live here so the flair is contained inside
          the component:
            • isl-pitch-flicker — drops the surface to 0.3 opacity for
              ~80ms then snaps back, reading as a "reality glitch".
            • isl-architect-trail — fades the ball-trail line from
              full opacity to 0 over ARCHITECT_FLAIR_MS so it
              dissolves rather than vanishing mid-paint.  Both
              animations are play-once via `forwards` / `infinite:false`. */}
      <style>{`
        @keyframes isl-pitch-flicker-kf {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.3; }
        }
        .isl-pitch-flicker {
          animation: isl-pitch-flicker-kf 80ms ease-out 1;
        }
        @keyframes isl-architect-trail-kf {
          0%   { opacity: 1; }
          100% { opacity: 0; }
        }
        .isl-architect-trail {
          animation: isl-architect-trail-kf ${ARCHITECT_FLAIR_MS}ms ease-out 1 forwards;
        }
      `}</style>
    </div>
  );
}
