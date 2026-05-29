// ── positionEmitter.ts ────────────────────────────────────────────────────────
// Generates per-2-second position snapshots for the 2D pitch viewer.
//
// WHY A SEPARATE FILE (not imported from src/)
// ────────────────────────────────────────────
// Deno edge functions run in an isolated environment with no access to
// `src/features/match/logic/zoneMapping.ts`.  This file provides the minimal
// subset of logic needed by the worker: position-based zone mapping (GK/DF/MF/FW)
// without the full 580-line zoneMapping.ts or its TypeScript strict-mode types.
// Formation-specific zone assignments are a planned follow-up (Phase 2B); for
// now the position string alone gives a sufficiently realistic 2D layout.
//
// PITCH COORDINATE SYSTEM (matches zoneMapping.ts exactly)
// ─────────────────────────────────────────────────────────
// x ∈ [0, 105]: 0 = home goal line, 105 = away goal line (home attacks right)
// y ∈ [0,  68]: 0 = top touchline,   68 = bottom touchline
//
// SNAPSHOT FORMAT
// ───────────────
// Each snapshot covers one 2-second tick (30/min × 90 min = 2 700 rows/match).
// The JSONB blob stored in match_positions.snapshots has the shape:
//   { players: [{ id, x, y, hasBall }], ball: { x, y, ownerId } }

import type { EngineTeam, EnginePlayer } from './gameEngine.types.ts';

// ── Pitch dimensions ──────────────────────────────────────────────────────────

/** FIFA standard pitch width in metres (home goal line → away goal line, x axis). */
const PITCH_WIDTH  = 105;
/** FIFA standard pitch height in metres (top touchline → bottom touchline, y axis). */
const PITCH_HEIGHT = 68;

// ── Position zone anchors ─────────────────────────────────────────────────────
//
// For each position string, define the approximate zone-centre x-coordinate
// for the HOME team (attacking right, x=0..105).  Away team positions are
// mirrored: x_away = PITCH_WIDTH - x_home.
//
// These values are derived from the zoneMapping.ts FORMATION_ZONES centroids,
// averaging across formations.  They are intentionally coarser than the full
// zone grid — the 2D viewer still looks correct at this resolution.
//
// GK:  x ≈  6   — penalty area depth; stays far from any action
// DF:  x ≈ 22   — own-third defensive line
// MF:  x ≈ 48   — centre-circle area; equidistant from both thirds
// FW:  x ≈ 74   — opponent's half, hovering outside the penalty box

const POSITION_X: Record<string, number> = {
  GK: 6,
  DF: 22,
  MF: 48,
  FW: 74,
};

/** Fallback x when the position string is not recognised (treat as midfield). */
const DEFAULT_POSITION_X = 48;

// ── Snapshot interval ─────────────────────────────────────────────────────────

/**
 * Seconds between consecutive snapshots within a minute.
 * 2 seconds → 30 snapshots/min → 2 700 rows for a 90-minute match.
 * Must be even so that second values stay on the 0, 2, 4 … 58 grid.
 */
export const SNAPSHOT_INTERVAL_SECONDS = 2;

// ── Public types ──────────────────────────────────────────────────────────────

/** Position of one active player in a 2-second snapshot. */
export interface SnapshotPlayer {
  /** DB entity_id (or player.id as fallback) — used by the viewer to resolve name/colour. */
  id:      string;
  x:       number;
  y:       number;
  /** True for the player currently holding the ball (at most one per snapshot). */
  hasBall: boolean;
}

/**
 * A single 2-second positional snapshot — one row in match_positions.
 * minute + second form the composite PK (minute ∈ [1, 90], second ∈ [0, 58]).
 */
export interface PositionSnapshot {
  minute:  number;
  /** Second within the minute: 0, 2, 4, … 58. */
  second:  number;
  /** All active players, both teams. */
  players: SnapshotPlayer[];
  /** Ball coordinates and the owning player's id (null when loose). */
  ball: { x: number; y: number; ownerId: string | null };
}

// ── Deterministic jitter ──────────────────────────────────────────────────────

/**
 * Deterministic positional jitter for a single player + axis.
 *
 * Uses a one-round LCG hash so each (minute, second, playerIndex, axis) tuple
 * maps to a unique but reproducible offset.  No global RNG is consumed —
 * important because `Math.random()` calls inside the sim loop would shift
 * the seed for `genEvent()` and break smoke-test determinism.
 *
 * @param min   Match minute (1–90).
 * @param sec   Second within the minute (0, 2, 4, … 58).
 * @param idx   Player ordinal index across both teams (0 = first home player).
 * @param axis  0 = x-axis jitter, 1 = y-axis jitter.
 * @returns     Signed offset in metres, clamped to [−3, +3].
 */
function jitter(min: number, sec: number, idx: number, axis: 0 | 1): number {
  // LCG constants from Numerical Recipes — same family used in smoke tests.
  const seed = min * 37 + sec * 13 + idx * 7 + axis * 3;
  // Bit-mask to 14 bits (0–16383), scale to [0, 1], map to [−3, +3].
  return ((seed * 1664525 + 1013904223) & 0x3fff) / 0x3fff * 6 - 3;
}

// ── Situation-driven zone shift ───────────────────────────────────────────────

/**
 * Compute how far a player's x anchor should shift based on match situation.
 *
 * Mirrors the logic in src/ `situationZoneDelta()` but returns a continuous
 * metre offset rather than a discrete zone-row delta:
 *
 *   - Possession: forwards/midfielders push +10 m toward opponent's goal.
 *   - Desperation (losing by ≥1 after minute 75): everyone pushes +12 m.
 *   - Comfort (winning by >1 after minute 60): everyone drops back −8 m.
 *
 * Values are intentionally generous — a zone row spans ~26 m so a 10 m push
 * keeps players within their "shifted" zone without leaving it entirely.
 *
 * @param position        Player position string ('GK'|'DF'|'MF'|'FW').
 * @param hasPossession   True when this player's team has the ball.
 * @param scoreDiff       Goal difference from this team's perspective.
 * @param minute          Current match minute.
 * @returns               Signed x offset in metres (+ve = toward opp. goal).
 */
function situationShift(
  position:     string,
  hasPossession: boolean,
  scoreDiff:    number,
  minute:       number,
): number {
  // GKs never leave their area regardless of situation.
  if (position === 'GK') return 0;

  let shift = 0;

  // Possession: FWs and MFs push forward into space; DFs hold position.
  if (hasPossession) {
    if (position === 'FW') shift += 10;
    else if (position === 'MF') shift += 5;
  } else {
    // Without the ball, everyone drops slightly — 5 m backward.
    shift -= 5;
  }

  // Desperation modifier: losing by at least 1 goal in the final 15 minutes.
  // The whole team pushes up — 12 m for DFs and MFs, 6 m extra for FWs
  // (they're already forward but get even more pressure-up urgency).
  if (scoreDiff < 0 && minute >= 75) {
    shift += position === 'FW' ? 6 : 12;
  }

  // Comfort modifier: winning by more than 1 after the hour mark.
  // Tighten the defensive line — drop back 8 m to protect the lead.
  if (scoreDiff > 1 && minute >= 60) {
    shift -= 8;
  }

  return shift;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Build a single 2-second position snapshot for all active players + ball.
 *
 * Player x-coordinates use role-based anchors (POSITION_X) adjusted by the
 * live match situation (possession, score, minute) plus deterministic jitter.
 * Player y-coordinates are spread evenly across the pitch width, offset by
 * player index to prevent stacking, then jittered for organic feel.
 *
 * Ball position follows the most advanced active outfield player on the
 * possession team (furthest x into the opponent's half).  The ball trails
 * 1.5 m behind the carrier in the direction of attack.
 *
 * @param min               Match minute (1–90).
 * @param sec               Second within the minute (0, 2, 4, … 58).
 * @param home              Full home EngineTeam (tactics, players).
 * @param away              Full away EngineTeam.
 * @param activeHome        Names of home players currently on the pitch.
 * @param activeAway        Names of away players currently on the pitch.
 * @param hasPossessionHome True when the home team has the ball this tick.
 * @param score             Running score as [homeGoals, awayGoals].
 * @returns                 Snapshot ready for batch-insert into match_positions.
 */
export function emitPositionSnapshot(
  min:               number,
  sec:               number,
  home:              EngineTeam,
  away:              EngineTeam,
  activeHome:        string[],
  activeAway:        string[],
  hasPossessionHome: boolean,
  score:             [number, number],
): PositionSnapshot {
  const players: Array<{ id: string; x: number; y: number; hasBall: boolean }> = [];

  // Ball placement tracking — most advanced outfield player on possession team.
  let ballOwnerId: string | null = null;
  let ballX = PITCH_WIDTH / 2;
  let ballY = PITCH_HEIGHT / 2;
  let bestAdvanceX = hasPossessionHome ? -1 : PITCH_WIDTH + 1;

  /**
   * Compute one player entry and update ball candidate.
   *
   * @param p       EnginePlayer (from normalizeTeamForEngine).
   * @param pIdx    Global player index (0–21 home, 22–43 away) for jitter uniqueness.
   * @param isAway  True for the away team — mirrors x-axis for their attack direction.
   */
  function addPlayer(p: EnginePlayer, pIdx: number, isAway: boolean): void {
    const activeNames = isAway ? activeAway : activeHome;
    if (!activeNames.includes(p.name)) return;

    const hasPossession  = isAway ? !hasPossessionHome : hasPossessionHome;
    const teamScoreDiff  = isAway ? score[1] - score[0] : score[0] - score[1];

    // ── x coordinate ────────────────────────────────────────────────────────
    // Anchor from position role, shifted by situation, jittered for uniqueness.
    // For the away team the anchor is mirrored (their GK is near x=99, not x=6).
    const anchorX  = isAway
      ? PITCH_WIDTH - (POSITION_X[p.position] ?? DEFAULT_POSITION_X)
      : (POSITION_X[p.position] ?? DEFAULT_POSITION_X);
    const sShift   = situationShift(p.position, hasPossession, teamScoreDiff, min);
    // Away team's "forward" direction is toward lower x, so flip the shift sign.
    const shiftedX = isAway ? anchorX - sShift : anchorX + sShift;
    const jX       = jitter(min, sec, pIdx, 0);
    const x        = Math.max(0, Math.min(PITCH_WIDTH, shiftedX + jX));

    // ── y coordinate ────────────────────────────────────────────────────────
    // Spread players evenly across the 68 m width.  Divide the pitch into
    // slots based on the player's index among their team, then add y jitter.
    // This prevents all defenders from stacking on the same y-row.
    const teamSize  = isAway ? away.players.length : home.players.length;
    const teamIdx   = pIdx % (teamSize || 11);  // ordinal within own team
    const ySlot     = (teamIdx + 0.5) / Math.max(1, teamSize);  // 0..1
    const jY        = jitter(min, sec, pIdx, 1);
    const y         = Math.max(0, Math.min(PITCH_HEIGHT, ySlot * PITCH_HEIGHT + jY));

    // ── Player ID ────────────────────────────────────────────────────────────
    // Prefer entity_id (FK into entities table, used by the viewer).
    // Fall back to the DB player UUID (always present in the worker).
    const id = (p as { entity_id?: string | null }).entity_id ?? (p as { id?: string }).id ?? p.name;

    players.push({ id, x, y, hasBall: false });

    // ── Ball placement candidate ──────────────────────────────────────────────
    // GKs excluded: a GK holding the ball near x=5 would make the ball appear
    // to teleport backward every time the home team has a goal kick / clearance.
    if (hasPossession && p.position !== 'GK') {
      // Most-advanced = highest x for home, lowest x for away.
      const isMoreAdvanced = hasPossessionHome ? x > bestAdvanceX : x < bestAdvanceX;
      if (isMoreAdvanced) {
        bestAdvanceX = x;
        ballOwnerId  = id;
        // Ball trails 1.5 m behind the carrier (in the direction of attack).
        ballX = hasPossessionHome ? x + 1.5 : x - 1.5;
        ballY = y;
      }
    }
  }

  home.players.forEach((p, i) => addPlayer(p, i,      false));
  away.players.forEach((p, i) => addPlayer(p, i + 22, true));

  // Mark the ball carrier.
  if (ballOwnerId !== null) {
    const carrier = players.find(pp => pp.id === ballOwnerId);
    if (carrier) carrier.hasBall = true;
  }

  return {
    minute: min,
    second: sec,
    players,
    ball: { x: ballX, y: ballY, ownerId: ballOwnerId },
  };
}
