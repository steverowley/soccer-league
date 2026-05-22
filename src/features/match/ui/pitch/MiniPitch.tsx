// ── features/match/ui/pitch/MiniPitch.tsx ───────────────────────────────────
// Tiny pitch chip used in the Matches list page for live-match rows
// (isl-a8i).  ~100px wide; renders the static pitch surface plus a
// single moving ball whose position is derived from the most recent
// match_events row delivered via the shared broadcast hook.
//
// WHY A REDUCED COMPONENT (rather than reusing <PitchView>)
//   PitchView runs the full choreographer per match — fine for the
//   single match detail page, prohibitively expensive when 3-10 live
//   matches share a list page.  MiniPitch trades dot-level motion for
//   chip-friendly performance: 22 dots in the 4-4-2 rest state, plus
//   a single ball whose CSS transition keeps the cursor of action
//   readable at a glance.
//
// SUBSCRIPTION DISCIPLINE
//   This component does NOT open its own Realtime channel.  It reads
//   from `useMatchEventLatest(matchId)`, which shares ONE table-wide
//   Realtime channel across every mounted MiniPitch (and any future
//   broadcast consumer).  See the isl-a8i acceptance criterion: "no
//   more than 1 Realtime subscription regardless of how many live
//   matches".

import { useMemo } from 'react';

import { COLORS } from '../../../../components/Layout';
import { eventToArchetype } from '../../logic/pitch/archetypes';
import {
  choreographArchetype,
  eventSeed,
  mulberry32,
} from '../../logic/pitch/choreographer';
import { initPitchState } from '../../logic/pitch/pitchState';

import { PitchSurface, PITCH_VIEWBOX_HEIGHT, PITCH_VIEWBOX_WIDTH } from './PitchSurface';
import { useMatchEventLatest } from './useMatchEventsBroadcast';

// ── Visual constants ────────────────────────────────────────────────────────

/**
 * Player dot radius in SVG user units.  Smaller than PitchView's
 * (1.5) because the chip itself is smaller and the dots need to
 * coexist with the ball without crowding.
 */
const MINI_PLAYER_RADIUS = 1.2;

/**
 * Ball dot radius in SVG user units.  Slightly bigger than the
 * player dots so the eye reads it as the cursor of action even at
 * chip size.
 */
const MINI_BALL_RADIUS = 1.4;

/**
 * CSS transition string for the ball's cx/cy.  Longer than the main
 * pitch's 600ms — at chip size the eye needs more time to register
 * the move, and we'd rather see a smooth slide than a snap.
 */
const MINI_BALL_TRANSITION = 'cx 900ms cubic-bezier(0.4, 0, 0.2, 1), cy 900ms cubic-bezier(0.4, 0, 0.2, 1)';

// ── Static rest state ──────────────────────────────────────────────────────
// 4-4-2 / 4-4-2 default — one snapshot shared across every MiniPitch
// instance.  Players never move in the chip view (only the ball
// does), so we can pre-compute the dot positions once at module load.

const REST_HOME_IDS = Array.from({ length: 11 }, (_, i) => `mini-home-${i}`);
const REST_AWAY_IDS = Array.from({ length: 11 }, (_, i) => `mini-away-${i}`);
const REST_STATE = initPitchState({
  homeFormation: '4-4-2',
  awayFormation: '4-4-2',
  homePlayerIds: REST_HOME_IDS,
  awayPlayerIds: REST_AWAY_IDS,
});

// ── Public types ────────────────────────────────────────────────────────────

/**
 * Props for <MiniPitch>.  `matchId` is required; the rest are
 * cosmetic overrides for the very small minority of callers that
 * need to deviate from the chip default (e.g. a future Matches-page
 * filter that wants outsized chips for the next-up match).
 */
export interface MiniPitchProps {
  /** UUID of the match whose live ball position to track. */
  matchId: string;
  /** Override the chip width in CSS pixels.  Default 100. */
  widthPx?: number;
  /**
   * Override the home team's brand colour.  Falls back to dust
   * when omitted — matches PitchView's same-default behaviour.
   */
  homeTeamColor?: string | null;
  /** Override the away team's brand colour.  Falls back to quantum. */
  awayTeamColor?: string | null;
}

// ── Helper ──────────────────────────────────────────────────────────────────

/**
 * Derive the ball position from the most recent match event.  Runs
 * the same `choreographArchetype` the main pitch view uses but only
 * takes the LAST keyframe's ball coordinate — we don't paint
 * intermediate frames at chip size, so the resting position is the
 * one the eye sees.
 *
 * Returns the centre spot (0.5, 0.5) when no event has arrived yet
 * or the archetype produces no keyframes (STOPPAGE).  Always returns
 * a clamped {x, y} pair so callers don't have to validate.
 */
function deriveBallPosition(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  event: { id?: string; type?: string; payload?: any } | null,
): { x: number; y: number } {
  if (!event?.id || !event.type) return { x: 0.5, y: 0.5 };

  // Resolve team-hint and archetype the same way MatchPitchPanel does
  // (without payload.team short-name resolution — we don't have the
  // team short_names at chip mount time; the chip only needs ball
  // movement, not team-specific attacking direction).
  const archetype = eventToArchetype(event.type);
  const payload   = (event.payload ?? {}) as { team?: string };
  const team =
    payload.team === 'home' || payload.team === 'away'
      ? payload.team
      : 'home';

  const rng = mulberry32(eventSeed(event.id));
  const frames = choreographArchetype(REST_STATE, archetype, { team }, rng);
  // Pick the LAST frame's ball position (the resting position after
  // the animation completes).  STOPPAGE / RESTART produce 0-1
  // keyframes; for those we either fall back to centre or to the
  // single keyframe's value.
  for (let i = frames.length - 1; i >= 0; i--) {
    const ball = frames[i]?.ball;
    if (ball) {
      return {
        x: Math.max(0, Math.min(1, ball.x)),
        y: Math.max(0, Math.min(1, ball.y)),
      };
    }
  }
  return { x: 0.5, y: 0.5 };
}

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Compact 100px-wide pitch chip for the Matches list page.
 *
 * Renders the static pitch surface (PitchSurface) + 22 fixed-position
 * dots + one ball whose position updates on each live match_events
 * row.  Subscribes via the shared broadcast hook so total Realtime
 * cost is bounded at one channel regardless of how many MiniPitch
 * chips the page mounts.
 *
 * @param props.matchId        UUID of the live match.
 * @param props.widthPx        Optional pixel width (default 100).
 * @param props.homeTeamColor  Optional home dot fill override.
 * @param props.awayTeamColor  Optional away dot fill override.
 * @returns                    The chip subtree.
 */
export function MiniPitch({
  matchId,
  widthPx,
  homeTeamColor,
  awayTeamColor,
}: MiniPitchProps) {
  const latest = useMatchEventLatest(matchId);

  // Memoise ball position so a re-render that doesn't change the
  // latest event row re-uses the existing object and React's diff
  // skips the SVG attribute write.  Depends on `latest` (the whole
  // row reference) so the React Compiler's inference matches.
  const ball = useMemo(() => deriveBallPosition(latest), [latest]);

  const width = widthPx ?? 100;

  return (
    <div
      // Aspect-ratio container so the chip scales from `widthPx`
      // alone — height follows automatically at the 100:64 surface
      // ratio.  Inline-block so it sits inline with row text without
      // taking the full row width.
      style={{
        position:    'relative',
        display:     'inline-block',
        width:       `${width}px`,
        aspectRatio: `${PITCH_VIEWBOX_WIDTH} / ${PITCH_VIEWBOX_HEIGHT}`,
        background:  COLORS.abyss,
        border:      `1px solid ${COLORS.hairline}`,
        boxSizing:   'border-box',
        flexShrink:  0,
      }}
      aria-label="Live match position preview"
      role="img"
    >
      {/* Surface layer */}
      <div style={{ position: 'absolute', inset: 0 }}>
        <PitchSurface />
      </div>

      {/* Dot + ball layer */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <svg
          viewBox={`0 0 ${PITCH_VIEWBOX_WIDTH} ${PITCH_VIEWBOX_HEIGHT}`}
          width="100%"
          height="100%"
          preserveAspectRatio="xMidYMid meet"
          style={{ display: 'block' }}
        >
          {/* Static dots — same shapes as PitchView but smaller radius
              for chip readability.  No GK ring, no jersey number — at
              this size both would crowd the dot illegibly. */}
          {REST_STATE.players.map((p) => (
            <circle
              key={p.id}
              cx={p.x * PITCH_VIEWBOX_WIDTH}
              cy={p.y * PITCH_VIEWBOX_HEIGHT}
              r={MINI_PLAYER_RADIUS}
              fill={p.side === 'home'
                ? (homeTeamColor ?? COLORS.dust)
                : (awayTeamColor ?? COLORS.quantum)}
              stroke={COLORS.abyss}
              strokeWidth={0.25}
            />
          ))}

          {/* Ball — the only moving piece.  CSS transition slides it
              between event-derived positions; if no event has landed,
              it sits at the centre spot. */}
          <circle
            cx={ball.x * PITCH_VIEWBOX_WIDTH}
            cy={ball.y * PITCH_VIEWBOX_HEIGHT}
            r={MINI_BALL_RADIUS}
            fill={COLORS.astro}
            stroke={COLORS.abyss}
            strokeWidth={0.2}
            style={{ transition: MINI_BALL_TRANSITION }}
          />
        </svg>
      </div>
    </div>
  );
}
