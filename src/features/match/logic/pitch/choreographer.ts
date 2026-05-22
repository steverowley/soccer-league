// ── features/match/logic/pitch/choreographer.ts ─────────────────────────────
// Pure reducer that turns a PitchState + an event archetype into a small
// sequence of keyframes the renderer plays via CSS transitions.
//
// LAYER BOUNDARY
//   • No React, no DOM, no Supabase.  Single function in / data out.
//   • Time is expressed as offsets in milliseconds from the start of
//     the archetype — the consuming hook schedules the actual setTimeouts.
//   • RNG is injected so the same event id always produces the same
//     keyframe sequence regardless of when it's replayed.
//
// CHOREOGRAPHY BUDGET
//   Total ≤ 800 ms per archetype.  Long enough for the eye to register
//   the motion at a 1-sec event cadence, short enough that two events
//   firing in the same minute don't visually trample each other.
//
// KEYFRAME SHAPE
//   Each Keyframe carries a sparse map of dot positions that should
//   change AT THAT POINT IN TIME.  The renderer keeps the most-recent
//   value for every other dot, so a single SHOT_ATTEMPT only mutates
//   the shooter + ball rather than thrashing all 22 dots.
//
// PURITY GUARANTEE
//   Given (state, archetype, payload, rng), the output is byte-stable.
//   Inputs are not mutated — we always allocate fresh Maps/objects so a
//   render-time diff check downstream stays meaningful.

import {
  type Archetype,
} from './archetypes';
import {
  type PitchState,
  type PlayerDot,
} from './pitchState';

// ── Tuning constants ────────────────────────────────────────────────────────

/**
 * Hard ceiling on the total archetype animation budget.  Slightly under
 * the 1000 ms event tick so the previous archetype finishes its CSS
 * transition before the next one starts; otherwise the renderer would
 * interrupt mid-ease and the eye would catch the jolt.
 */
export const ARCHETYPE_BUDGET_MS = 800;

/**
 * How much each archetype advances the ATTACKING-side dots toward the
 * opposing goal.  0.06 ≈ 6% of pitch length per beat — visible motion
 * without yanking dots across the surface.
 */
const ATTACK_NUDGE = 0.06;

/**
 * Defensive compression distance when DEFENSIVE_ACTION fires.  Defenders
 * pull back toward their own goal by this fraction of pitch length.
 */
const DEFEND_NUDGE = 0.04;

/**
 * Jitter amplitude (normalised pitch units) added to each moving dot
 * so identical events fire with subtle per-event variation rather than
 * snapping to the same exact pixel each time.
 */
const JITTER_AMPLITUDE = 0.015;

/**
 * Ball position used by SET_PIECE_PREP when the choreographer doesn't
 * know exactly where the set piece is.  Centred along the goal line
 * 14% in from the wing — reads as "corner area" without committing to
 * left/right.
 */
const CORNER_X = 0.86; // attacking-side corner
const CORNER_Y = 0.86;

/**
 * Penalty-spot location used by PENALTY_TAKE.  Mirrors the offset baked
 * into PitchSurface's penalty mark.
 */
const PENALTY_SPOT_X = 0.88; // attacking side; mirrored for away
const PENALTY_SPOT_Y = 0.50;

// ── Public types ─────────────────────────────────────────────────────────────

/**
 * Optional context the choreographer reads when shaping the keyframes.
 *
 * `team` is the side the event "belongs to" (the team in possession for
 * attacking archetypes, the defending team for DEFENSIVE_ACTION, etc.).
 * Omitted → choreographer picks home as a default.
 *
 * `playerId` lets a per-event archetype (a shot, a goal celebration)
 * key its motion to the named player.  Omitted → choreographer picks
 * the first attacker / defender in the appropriate band.
 */
export interface ChoreographyPayload {
  team?:     'home' | 'away';
  playerId?: string;
}

/**
 * A single keyframe in the per-archetype animation.  `atMs` is the
 * elapsed time since the archetype started; the consuming hook uses
 * this to schedule the position update.  `positions` is keyed by
 * PlayerDot.id and may be partial — unmoved dots are absent.  `ball`
 * is present only when the ball itself moves at this keyframe.
 */
export interface Keyframe {
  atMs:      number;
  positions: Map<string, { x: number; y: number }>;
  ball?:     { x: number; y: number };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Clamp a normalised pitch coordinate into [0..1].  Defensive against
 * the jitter adding up just over the edge of the surface — the
 * renderer would clip the dot at the touchline and look wrong.
 */
function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/**
 * Symmetric jitter in [-amplitude, +amplitude].  Pulled from the
 * injected RNG so two test runs produce the same exact dance.
 */
function jitter(rng: () => number, amplitude = JITTER_AMPLITUDE): number {
  return (rng() * 2 - 1) * amplitude;
}

/**
 * Pick the attacking direction sign based on the `team` payload.
 * Home advances toward x=1; away toward x=0.  Returns +1 / -1 so the
 * choreographer's nudge math reads naturally as `x + sign * NUDGE`.
 */
function attackSign(team: 'home' | 'away'): 1 | -1 {
  return team === 'home' ? 1 : -1;
}

/**
 * The deepest x-coordinate for a side's goalkeeper.  Used to pin the
 * keeper in their own area during attacks / celebrations so they
 * don't float upfield with the rest of their team.
 */
function keeperX(side: 'home' | 'away'): number {
  return side === 'home' ? 0.05 : 0.95;
}

/**
 * Pick a representative dot from a side based on a position band.
 * `band='forward'` returns the dot with the highest attacking-side
 * x value (the front-most); `band='defender'` the deepest.  Returns
 * undefined when the side has no dots that match (shouldn't happen
 * for a full 11-on-11 state, but we tolerate it).
 */
function pickByBand(
  state: PitchState,
  side:  'home' | 'away',
  band:  'forward' | 'defender' | 'midfielder',
): PlayerDot | undefined {
  const sign = attackSign(side);
  const sideDots = state.players.filter(p => p.side === side);
  if (sideDots.length === 0) return undefined;

  // Project every dot's attacking-direction x — higher = further forward.
  const ranked = sideDots
    .map(p => ({ p, projected: p.x * sign }))
    .sort((a, b) => b.projected - a.projected);

  if (band === 'forward')   return ranked[0]?.p;
  if (band === 'defender')  return ranked[ranked.length - 1]?.p;
  // midfielder = middle of the sorted list
  return ranked[Math.floor(ranked.length / 2)]?.p;
}

// ── Public reducer ───────────────────────────────────────────────────────────

/**
 * Produce a keyframe sequence for a single archetype.
 *
 * The choreographer is intentionally simple — every archetype either
 * (a) emits one or two keyframes that nudge a subset of dots toward
 * their archetype's "intent" position, or (b) emits nothing (STOPPAGE
 * doesn't animate; the caller's idle-drift step keeps the surface
 * alive between events).
 *
 * @param state      Current PitchState — read-only.  Used to source
 *                   slot positions and pick representative dots.
 * @param archetype  Which archetype to play.
 * @param payload    Optional team / player hints.
 * @param rng        Seeded RNG (`() => number` returning [0..1)).  Tests
 *                   inject a mulberry32; production wires from event id.
 * @returns          Zero-to-three Keyframes within the ARCHETYPE_BUDGET_MS
 *                   ceiling.  Empty array means "no motion this beat".
 */
export function choreographArchetype(
  state:     PitchState,
  archetype: Archetype,
  payload:   ChoreographyPayload,
  rng:       () => number,
): Keyframe[] {
  const team    = payload.team ?? 'home';
  const sign    = attackSign(team);
  const enemy   = team === 'home' ? 'away' : 'home';

  switch (archetype) {
    // ── ATTACK_BUILDUP — possession side advances ───────────────────────
    case 'ATTACK_BUILDUP': {
      const mid = pickByBand(state, team, 'midfielder');
      const fwd = pickByBand(state, team, 'forward');
      if (!mid || !fwd) return [];
      const positions = new Map<string, { x: number; y: number }>();
      positions.set(mid.id, {
        x: clamp01(mid.x + sign * ATTACK_NUDGE + jitter(rng)),
        y: clamp01(mid.y + jitter(rng)),
      });
      positions.set(fwd.id, {
        x: clamp01(fwd.x + sign * ATTACK_NUDGE + jitter(rng)),
        y: clamp01(fwd.y + jitter(rng)),
      });
      return [{
        atMs:      0,
        positions,
        ball:      { x: clamp01(mid.x + sign * ATTACK_NUDGE), y: mid.y },
      }];
    }

    // ── SHOT_ATTEMPT — ball + shooter snap toward goal ──────────────────
    case 'SHOT_ATTEMPT': {
      const fwd = pickByBand(state, team, 'forward');
      if (!fwd) return [];
      const shotX = team === 'home' ? 0.90 : 0.10;
      const positions = new Map<string, { x: number; y: number }>();
      positions.set(fwd.id, {
        x: clamp01(shotX + jitter(rng, 0.02)),
        y: clamp01(fwd.y + jitter(rng)),
      });
      return [{
        atMs:      0,
        positions,
        ball:      { x: clamp01(shotX + jitter(rng, 0.02)), y: clamp01(fwd.y + jitter(rng)) },
      }];
    }

    // ── SET_PIECE_PREP — ball to corner / wall area ─────────────────────
    case 'SET_PIECE_PREP': {
      const cornerX = team === 'home' ? CORNER_X : 1 - CORNER_X;
      return [{
        atMs:      0,
        positions: new Map(),
        ball:      { x: clamp01(cornerX), y: CORNER_Y },
      }];
    }

    // ── PENALTY_TAKE — ball at penalty spot, taker steps up ─────────────
    case 'PENALTY_TAKE': {
      const fwd = pickByBand(state, team, 'forward');
      if (!fwd) return [];
      const spotX = team === 'home' ? PENALTY_SPOT_X : 1 - PENALTY_SPOT_X;
      const positions = new Map<string, { x: number; y: number }>();
      // Shooter approaches the spot from a couple of yards out so the
      // run-up is visible.
      positions.set(fwd.id, {
        x: clamp01(spotX - sign * 0.04),
        y: PENALTY_SPOT_Y,
      });
      return [{
        atMs:      0,
        positions,
        ball:      { x: spotX, y: PENALTY_SPOT_Y },
      }];
    }

    // ── DEFENSIVE_ACTION — defenders compress, ball back ────────────────
    case 'DEFENSIVE_ACTION': {
      // For DEFENSIVE_ACTION the `team` payload is the team WINNING
      // the ball; their defenders compress backward toward their own goal.
      const def = pickByBand(state, team, 'defender');
      if (!def) return [];
      const positions = new Map<string, { x: number; y: number }>();
      positions.set(def.id, {
        x: clamp01(def.x - sign * DEFEND_NUDGE + jitter(rng)),
        y: clamp01(def.y + jitter(rng)),
      });
      return [{
        atMs:      0,
        positions,
        ball:      { x: def.x, y: def.y },
      }];
    }

    // ── GOAL_CELEBRATION — scorer + cluster, ball returns to centre ────
    case 'GOAL_CELEBRATION': {
      // Scorer (and one nearby teammate) cluster near the attacking
      // goal; keepers and the opposing side stay where they are.
      // The keeper invariant matters for the test suite — neither
      // keeper should be displaced toward midfield by a celebration.
      const fwd = pickByBand(state, team, 'forward');
      const mid = pickByBand(state, team, 'midfielder');
      if (!fwd || !mid) return [];
      const goalX = team === 'home' ? 0.92 : 0.08;
      const positions = new Map<string, { x: number; y: number }>();
      positions.set(fwd.id, {
        x: clamp01(goalX + jitter(rng, 0.02)),
        y: clamp01(fwd.y + jitter(rng, 0.03)),
      });
      positions.set(mid.id, {
        x: clamp01(goalX - sign * 0.05 + jitter(rng, 0.02)),
        y: clamp01(mid.y + jitter(rng, 0.03)),
      });
      // Ball drifts back to centre for the restart (atMs 400 so the
      // celebration registers before the restart begins).
      return [
        { atMs: 0,   positions, ball: { x: goalX, y: fwd.y } },
        { atMs: 400, positions: new Map(), ball: { x: 0.5, y: 0.5 } },
      ];
    }

    // ── STOPPAGE — no motion this beat ──────────────────────────────────
    case 'STOPPAGE': {
      // Returning [] lets the caller's idle-drift step run unimpeded.
      // Players gently settle back toward their formation slots while
      // the commentary describes the stoppage.
      return [];
    }

    // ── RESTART — ball back to centre, defenders return home ────────────
    case 'RESTART': {
      // Pull the opposing team's defender back toward their slot so the
      // restart visibly resets the geometry.  `enemy` is the side that
      // didn't have possession during whatever stoppage preceded this.
      const def = pickByBand(state, enemy, 'defender');
      const positions = new Map<string, { x: number; y: number }>();
      if (def) {
        const targetX = enemy === 'home' ? keeperX('home') + 0.15 : keeperX('away') - 0.15;
        positions.set(def.id, {
          x: clamp01(targetX),
          y: clamp01(def.y + jitter(rng, 0.01)),
        });
      }
      return [{
        atMs:      0,
        positions,
        ball:      { x: 0.5, y: 0.5 },
      }];
    }

    default: {
      // Exhaustiveness sentinel — the union should be closed but if
      // someone adds a new archetype without updating this switch, we
      // fall through to "no motion" rather than throwing.  Safer for
      // production where a bad archetype must never blank the pitch.
      return [];
    }
  }
}

// ── RNG helper ──────────────────────────────────────────────────────────────
// Mulberry32 — same PRNG used by the architectRoulette tests.  Exported
// here so the consuming hook can seed one RNG per event id and tests can
// pin determinism without re-implementing the algorithm.

/**
 * Build a seeded RNG from a numeric seed.  Returns a function that
 * yields values in [0, 1) on each call.
 *
 * @param seed  Any 32-bit integer-ish number.  The hook converts an
 *              event UUID to a seed by hashing the first 8 hex chars.
 */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

/**
 * Hash an event id (UUID or any string) to a 32-bit seed.  Cheap FNV-1a
 * — collisions are fine since the consumer only uses the seed to mint
 * a deterministic RNG per event; two different events that happen to
 * collide just animate identically.
 */
export function eventSeed(eventId: string): number {
  // 32-bit FNV-1a offset basis + prime.
  let hash = 0x811c9dc5;
  for (let i = 0; i < eventId.length; i++) {
    hash ^= eventId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
