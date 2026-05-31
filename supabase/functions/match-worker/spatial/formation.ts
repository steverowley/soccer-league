// ── features/match/logic/spatial/formation.ts ────────────────────────────────
// Formation slot tables + the dynamic "team shape" anchor that slides with the
// ball.  This is what makes a spatial match look organised rather than 22
// players all chasing one ball: each player has a home slot, and the whole
// block shifts up the pitch in attack and drops back in defence.
//
// TEAM-RELATIVE SLOTS
//   Slots are stored as fractions from a team's OWN goal (fx) and across the
//   pitch (fy), both in [0,1].  Storing them team-relative means one table
//   serves both sides — slotToAbsolute() mirrors them onto the correct half.

import { type Vec2, vec } from './vec2.ts';
import {
  PITCH_LENGTH, PITCH_WIDTH,
  type Role, type TeamSide, type SimPlayer,
  attackingGoalX, defendingGoalX,
} from './types.ts';

/** The four formations the club managers table supports (migration 0045). */
export type Formation = '4-4-2' | '4-5-1' | '3-4-3' | '5-4-1';

/** A single formation slot: role + team-relative home fraction. */
export interface FormationSlot {
  role: Role;
  /** Distance from own goal, 0 (own line) … 1 (opponent line). */
  fx: number;
  /** Across the pitch, 0 (top touchline) … 1 (bottom touchline). */
  fy: number;
}

// ── Slot tables ───────────────────────────────────────────────────────────────
//
// fx bands by line: GK ≈ 0.05, defenders ≈ 0.22, midfield ≈ 0.50, attack ≈
// 0.75.  fy is spread evenly across each line.  These are resting shapes; the
// dynamic anchor below pushes them around as play develops.

/** 4-4-2: flat back four, flat midfield four, two strikers. */
const F_442: FormationSlot[] = [
  { role: 'GK', fx: 0.05, fy: 0.50 },
  { role: 'DF', fx: 0.22, fy: 0.20 }, { role: 'DF', fx: 0.22, fy: 0.40 },
  { role: 'DF', fx: 0.22, fy: 0.60 }, { role: 'DF', fx: 0.22, fy: 0.80 },
  { role: 'MF', fx: 0.50, fy: 0.20 }, { role: 'MF', fx: 0.50, fy: 0.40 },
  { role: 'MF', fx: 0.50, fy: 0.60 }, { role: 'MF', fx: 0.50, fy: 0.80 },
  { role: 'FW', fx: 0.76, fy: 0.38 }, { role: 'FW', fx: 0.76, fy: 0.62 },
];

/** 4-5-1: back four, packed five-man midfield, lone striker. */
const F_451: FormationSlot[] = [
  { role: 'GK', fx: 0.05, fy: 0.50 },
  { role: 'DF', fx: 0.22, fy: 0.20 }, { role: 'DF', fx: 0.22, fy: 0.40 },
  { role: 'DF', fx: 0.22, fy: 0.60 }, { role: 'DF', fx: 0.22, fy: 0.80 },
  { role: 'MF', fx: 0.50, fy: 0.15 }, { role: 'MF', fx: 0.50, fy: 0.33 },
  { role: 'MF', fx: 0.50, fy: 0.50 }, { role: 'MF', fx: 0.50, fy: 0.67 },
  { role: 'MF', fx: 0.50, fy: 0.85 },
  { role: 'FW', fx: 0.78, fy: 0.50 },
];

/** 3-4-3: back three, midfield four, front three. */
const F_343: FormationSlot[] = [
  { role: 'GK', fx: 0.05, fy: 0.50 },
  { role: 'DF', fx: 0.22, fy: 0.30 }, { role: 'DF', fx: 0.22, fy: 0.50 },
  { role: 'DF', fx: 0.22, fy: 0.70 },
  { role: 'MF', fx: 0.50, fy: 0.20 }, { role: 'MF', fx: 0.50, fy: 0.40 },
  { role: 'MF', fx: 0.50, fy: 0.60 }, { role: 'MF', fx: 0.50, fy: 0.80 },
  { role: 'FW', fx: 0.76, fy: 0.25 }, { role: 'FW', fx: 0.76, fy: 0.50 },
  { role: 'FW', fx: 0.76, fy: 0.75 },
];

/** 5-4-1: back five (wing-backs), midfield four, lone striker. */
const F_541: FormationSlot[] = [
  { role: 'GK', fx: 0.05, fy: 0.50 },
  { role: 'DF', fx: 0.20, fy: 0.15 }, { role: 'DF', fx: 0.20, fy: 0.33 },
  { role: 'DF', fx: 0.20, fy: 0.50 }, { role: 'DF', fx: 0.20, fy: 0.67 },
  { role: 'DF', fx: 0.20, fy: 0.85 },
  { role: 'MF', fx: 0.48, fy: 0.20 }, { role: 'MF', fx: 0.48, fy: 0.40 },
  { role: 'MF', fx: 0.48, fy: 0.60 }, { role: 'MF', fx: 0.48, fy: 0.80 },
  { role: 'FW', fx: 0.76, fy: 0.50 },
];

/** Lookup from formation key to its 11-slot table. */
export const FORMATION_SLOTS: Readonly<Record<Formation, FormationSlot[]>> = Object.freeze({
  '4-4-2': F_442,
  '4-5-1': F_451,
  '3-4-3': F_343,
  '5-4-1': F_541,
});

/**
 * Resolve a formation key that may have drifted (free-text DB column) to a
 * supported one, defaulting to 4-4-2.  Mirrors the narrowing the existing
 * MatchPitchPanel does so both viewers agree on the fallback shape.
 */
export function narrowFormation(raw: unknown): Formation {
  return raw === '4-4-2' || raw === '4-5-1' || raw === '3-4-3' || raw === '5-4-1'
    ? raw
    : '4-4-2';
}

/**
 * Map a team-relative slot to an absolute pitch position for `side`.
 *
 * Home attacks toward x=105, so fx grows with x.  Away attacks toward x=0, so
 * fx is mirrored (fx=0 sits at x=105, the away team's own goal).  y is shared
 * (no left/right mirroring needed — the shapes are vertically symmetric).
 *
 * @param slot  The team-relative slot.
 * @param side  Which side owns it.
 * @returns     Absolute position in pitch metres.
 */
export function slotToAbsolute(slot: FormationSlot, side: TeamSide): Vec2 {
  const ownGoal = defendingGoalX(side);
  const oppGoal = attackingGoalX(side);
  const x = ownGoal + (oppGoal - ownGoal) * slot.fx;
  const y = slot.fy * PITCH_WIDTH;
  return vec(x, y);
}

// ── Dynamic anchor ────────────────────────────────────────────────────────────

/**
 * How far the outfield block slides up/down the pitch as the ball travels
 * between the two thirds, in metres.  ~28m gives a compact-when-defending,
 * stretched-when-attacking feel without players abandoning their zones.
 */
const LINE_TRAVEL = 28;

/**
 * Sideways pull toward the ball's lateral position, as a fraction of the
 * ball's offset from the central lane.  0.22 keeps the block shifting toward
 * the ball side (overloading the flank where play is) while preserving width.
 */
const BALL_Y_PULL = 0.22;

/**
 * Per-role multiplier on the forward/back line travel.  Keepers barely move
 * off their line; forwards roam the most.  This keeps defensive shape tighter
 * than the attacking line, which is how real blocks behave.
 */
const ROLE_TRAVEL: Readonly<Record<Role, number>> = Object.freeze({
  GK: 0.12,  // hugs the goal; only nudges out for a high line
  DF: 0.70,  // holds a disciplined line
  MF: 1.00,  // box-to-box, full travel
  FW: 1.10,  // presses high, drops to receive — most mobile
});

/**
 * Compute the position a player's steering should hold when NOT actively
 * chasing the ball or marking — i.e. their formation slot, shifted by where
 * play currently is.
 *
 * The shift has two parts:
 *   1. Longitudinal: the whole block slides toward the opponent goal as the
 *      ball advances into the attacking half (and retreats when it doesn't),
 *      scaled per role so the back line stays compact.
 *   2. Lateral: a gentle pull toward the ball's y so the team overloads the
 *      side the ball is on.
 *
 * @param player   The player whose anchor we want.
 * @param ballPos  Current ball position (the play's centre of gravity).
 * @returns        The shifted home anchor, clamped to the pitch.
 */
export function dynamicAnchor(player: SimPlayer, ballPos: Vec2): Vec2 {
  // Ball progress along THIS team's attacking direction, 0 (own goal) … 1.
  const ownGoal = defendingGoalX(player.side);
  const oppGoal = attackingGoalX(player.side);
  const prog = (ballPos.x - ownGoal) / (oppGoal - ownGoal); // sign handles away mirroring
  const progClamped = prog < 0 ? 0 : prog > 1 ? 1 : prog;

  // (prog − 0.5) is negative in our own half (drop back), positive in theirs
  // (push up).  Multiply by the direction of attack so "forward" is correct
  // for both sides.
  const attackDir = oppGoal > ownGoal ? 1 : -1;
  const shiftX = (progClamped - 0.5) * LINE_TRAVEL * ROLE_TRAVEL[player.role] * attackDir;

  // Lateral pull toward the ball, weaker for the keeper.
  const yPull = (player.role === 'GK' ? BALL_Y_PULL * 0.3 : BALL_Y_PULL);
  const shiftY = (ballPos.y - PITCH_WIDTH / 2) * yPull;

  const x = player.homePos.x + shiftX;
  const y = player.homePos.y + shiftY;

  // Clamp to the pitch with a small inset so anchors never sit exactly on the
  // touchline (players would constantly fight the boundary).
  const INSET = 1.5;
  return vec(
    x < INSET ? INSET : x > PITCH_LENGTH - INSET ? PITCH_LENGTH - INSET : x,
    y < INSET ? INSET : y > PITCH_WIDTH - INSET ? PITCH_WIDTH - INSET : y,
  );
}
