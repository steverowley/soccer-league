// ── features/match/logic/zoneMapping.ts ─────────────────────────────────────
// Pitch zone model for the spatial simulation layer.
//
// WHY ZONES INSTEAD OF EXACT COORDINATES
//   The engine produces discrete events, not continuous physics. Rather than
//   invent false precision, we model the pitch as a 4-row × 3-column grid
//   (12 zones) where each zone is a bounded rectangular region in pitch
//   coordinates. Players occupy a zone, drift within it, and transition
//   between zones based on formation, role, and match situation.
//
//   This gives the 2D pitch viewer enough positional data to animate smoothly
//   (client interpolates between zone centres) while remaining faithful to
//   what the engine actually models.
//
// PITCH COORDINATES
//   105 × 68 units (FIFA standard, metres).
//   Origin: top-left corner when viewed from above (home attacks right).
//   X: 0 = home goal line, 105 = away goal line
//   Y: 0 = top touchline, 68 = bottom touchline
//
// ZONE GRID
//   Columns (left/centre/right): 3
//   Rows (home-third / home-half / away-half / away-third): 4
//   → 12 zones total
//
// HOME ATTACK DIRECTION
//   Home team attacks from left (x=0) toward right (x=105).
//   Zone row 0 = home team's own third (defensive); row 3 = attacking third.
//   For away team positions, the zone grid is mirrored.

// ── Zone types ───────────────────────────────────────────────────────────────

/** Column index: 0=left, 1=centre, 2=right */
export type ZoneCol = 0 | 1 | 2;

/** Row index from home goal to away goal: 0=home third … 3=away third */
export type ZoneRow = 0 | 1 | 2 | 3;

export interface Zone {
  readonly col: ZoneCol;
  readonly row: ZoneRow;
}

/** Concrete pitch coordinates (metres, from top-left) */
export interface PitchCoord {
  readonly x: number;
  readonly y: number;
}

// ── Action bias ──────────────────────────────────────────────────────────────

/**
 * Relative tendency for a player to take each action type.
 * Values are not strict probabilities — they are blended with other factors
 * in decisionBlender.ts and normalised there. Think of each as a weight.
 */
export interface ActionBias {
  readonly shoot:  number;
  readonly pass:   number;
  readonly dribble: number;
  readonly tackle: number;
  readonly press:  number;
}

// ── Constants ────────────────────────────────────────────────────────────────

export const PITCH_WIDTH  = 105; // x axis
export const PITCH_HEIGHT =  68; // y axis

// Zone dimension constants — derived from pitch size and grid counts.
//
// AXIS MAPPING (read before editing zoneCentre)
// ─────────────────────────────────────────────
// X axis (0–105): runs from home goal line to away goal line.
//   → zone.ROW determines X position (row 0 = home's own third, row 3 = away's third).
//   → ZONE_ROW_W = PITCH_WIDTH / 4 rows = 26.25 units per row segment.
//
// Y axis (0–68): runs from top touchline to bottom touchline.
//   → zone.COL determines Y position (col 0 = left, col 1 = centre, col 2 = right).
//   → ZONE_COL_H = PITCH_HEIGHT / 3 cols ≈ 22.67 units per column segment.
//
// This mapping is NOT col→X / row→Y. "Column" is the left-right split (Y axis)
// and "row" is the home-to-away split (X axis). The naming follows American
// grid convention (column = vertical slice of a table = left-right slice of a
// pitch) but the spatial axis is Y, not X.

/** Width of each row zone along the X axis (home goal → away goal). 26.25 units. */
const ZONE_ROW_W = PITCH_WIDTH  / 4; // 26.25: 4 rows across 105-unit X axis
/** Height of each column zone along the Y axis (top → bottom touchline). ≈22.67 units. */
const ZONE_COL_H = PITCH_HEIGHT / 3; // ≈22.67: 3 cols across 68-unit Y axis

// ── Zone → pitch coordinate ───────────────────────────────────────────────────

/**
 * Centre coordinate of a zone in pitch units (metres, FIFA standard).
 *
 * The coordinate system has the home goal at x=0 and the away goal at x=105.
 * The away team's zones are mirrored on the X axis so all returned coordinates
 * are in absolute pitch space — no downstream mirroring needed.
 *
 * @param zone    The zone to convert ({ col: 0|1|2, row: 0|1|2|3 }).
 * @param isAway  True for away-team players — mirrors the X coordinate so
 *                away row 0 (their defensive third) maps to x ≈ 91 not x ≈ 13.
 * @returns       Absolute pitch coordinate { x: 0–105, y: 0–68 }.
 */
export function zoneCentre(zone: Zone, isAway: boolean): PitchCoord {
  // zone.row → X: row 0 is near the home goal (x ≈ 13), row 3 is near the
  // away goal (x ≈ 92).  ZONE_ROW_W = 26.25 per row.
  const x = ZONE_ROW_W * (zone.row + 0.5);

  // zone.col → Y: col 0 = left touchline (y ≈ 11), col 1 = centre (y ≈ 34),
  // col 2 = right touchline (y ≈ 57).  ZONE_COL_H ≈ 22.67 per column.
  const y = ZONE_COL_H * (zone.col + 0.5);

  // Mirror X for away team: their row 0 (own defensive third) is near x=105,
  // so we flip: absX = PITCH_WIDTH - x.
  const absX = isAway ? PITCH_WIDTH - x : x;
  return { x: absX, y };
}

// ── Formation → zone assignments ─────────────────────────────────────────────
//
// Each formation maps jersey_number (1–22) → home Zone.
// Jersey 1 = GK; jerseys 2–11 = starters in formation order.
// Bench players (12–22) get sensible park-and-wait zones near the halfway
// line — they only appear if substituted on.
//
// Positions in the array correspond to the typical line order for each
// formation:
//
//   4-4-2:  [GK] [RB CB CB LB] [RM CM CM LM] [ST ST]
//   4-3-3:  [GK] [RB CB CB LB] [CM CM CM] [RW ST LW]
//   3-4-3:  [GK] [CB CB CB] [RM CM CM LM] [RW ST LW]
//   4-5-1:  [GK] [RB CB CB LB] [RM CM CM CM LM] [ST]
//
// Bench (12–22) get zone { col:1, row:2 } (home half, centre) regardless
// of formation — they stand near the technical area.

type Formation = '4-4-2' | '4-3-3' | '3-4-3' | '4-5-1';

/** jersey_number 1..22 → home Zone for each formation */
const FORMATION_ZONES: Record<Formation, Zone[]> = {
  '4-4-2': [
    /* GK  1 */ { col: 1, row: 0 },
    /* RB  2 */ { col: 2, row: 0 },
    /* CB  3 */ { col: 1, row: 0 },
    /* CB  4 */ { col: 1, row: 0 },
    /* LB  5 */ { col: 0, row: 0 },
    /* RM  6 */ { col: 2, row: 1 },
    /* CM  7 */ { col: 1, row: 1 },
    /* CM  8 */ { col: 1, row: 1 },
    /* LM  9 */ { col: 0, row: 1 },
    /* ST 10 */ { col: 1, row: 2 },
    /* ST 11 */ { col: 1, row: 2 },
    // bench
    { col: 1, row: 1 }, { col: 1, row: 1 }, { col: 1, row: 1 },
    { col: 1, row: 1 }, { col: 1, row: 1 }, { col: 1, row: 1 },
    { col: 1, row: 1 }, { col: 1, row: 1 }, { col: 1, row: 1 },
    { col: 1, row: 1 }, { col: 1, row: 1 },
  ],
  '4-3-3': [
    /* GK  1 */ { col: 1, row: 0 },
    /* RB  2 */ { col: 2, row: 0 },
    /* CB  3 */ { col: 1, row: 0 },
    /* CB  4 */ { col: 1, row: 0 },
    /* LB  5 */ { col: 0, row: 0 },
    /* CM  6 */ { col: 1, row: 1 },
    /* CM  7 */ { col: 1, row: 1 },
    /* CM  8 */ { col: 1, row: 1 },
    /* RW  9 */ { col: 2, row: 2 },
    /* ST 10 */ { col: 1, row: 3 },
    /* LW 11 */ { col: 0, row: 2 },
    // bench
    { col: 1, row: 1 }, { col: 1, row: 1 }, { col: 1, row: 1 },
    { col: 1, row: 1 }, { col: 1, row: 1 }, { col: 1, row: 1 },
    { col: 1, row: 1 }, { col: 1, row: 1 }, { col: 1, row: 1 },
    { col: 1, row: 1 }, { col: 1, row: 1 },
  ],
  '3-4-3': [
    /* GK  1 */ { col: 1, row: 0 },
    /* CB  2 */ { col: 0, row: 0 },
    /* CB  3 */ { col: 1, row: 0 },
    /* CB  4 */ { col: 2, row: 0 },
    /* RM  5 */ { col: 2, row: 1 },
    /* CM  6 */ { col: 1, row: 1 },
    /* CM  7 */ { col: 1, row: 1 },
    /* LM  8 */ { col: 0, row: 1 },
    /* RW  9 */ { col: 2, row: 2 },
    /* ST 10 */ { col: 1, row: 3 },
    /* LW 11 */ { col: 0, row: 2 },
    // bench
    { col: 1, row: 1 }, { col: 1, row: 1 }, { col: 1, row: 1 },
    { col: 1, row: 1 }, { col: 1, row: 1 }, { col: 1, row: 1 },
    { col: 1, row: 1 }, { col: 1, row: 1 }, { col: 1, row: 1 },
    { col: 1, row: 1 }, { col: 1, row: 1 },
  ],
  '4-5-1': [
    /* GK  1 */ { col: 1, row: 0 },
    /* RB  2 */ { col: 2, row: 0 },
    /* CB  3 */ { col: 1, row: 0 },
    /* CB  4 */ { col: 1, row: 0 },
    /* LB  5 */ { col: 0, row: 0 },
    /* RM  6 */ { col: 2, row: 1 },
    /* CM  7 */ { col: 1, row: 1 },
    /* CM  8 */ { col: 1, row: 1 },
    /* CM  9 */ { col: 1, row: 1 },
    /* LM 10 */ { col: 0, row: 1 },
    /* ST 11 */ { col: 1, row: 2 },
    // bench
    { col: 1, row: 1 }, { col: 1, row: 1 }, { col: 1, row: 1 },
    { col: 1, row: 1 }, { col: 1, row: 1 }, { col: 1, row: 1 },
    { col: 1, row: 1 }, { col: 1, row: 1 }, { col: 1, row: 1 },
    { col: 1, row: 1 }, { col: 1, row: 1 },
  ],
};

/** Fallback formation for any DB value we don't recognise */
const DEFAULT_FORMATION: Formation = '4-4-2';

function parseFormation(raw: string | undefined | null): Formation {
  const f = (raw ?? '').trim();
  if (f === '4-4-2' || f === '4-3-3' || f === '3-4-3' || f === '4-5-1') return f;
  return DEFAULT_FORMATION;
}

/**
 * Home zone for a player given their jersey number and team formation.
 * Jersey numbers outside [1, 22] clamp to the nearest bench slot.
 */
export function playerHomeZone(jerseyNumber: number, formationRaw: string | null | undefined): Zone {
  const formation = parseFormation(formationRaw);
  const zones = FORMATION_ZONES[formation];
  // Clamp to [0, 21] — every FORMATION_ZONES entry has exactly 22 elements
  // (11 starters + 11 bench), so the clamped index is always in bounds.
  // The `?? { col: 1, row: 0 }` fallback (the GK home zone) satisfies
  // noUncheckedIndexedAccess; it can never actually fire given the clamp.
  const idx = Math.max(0, Math.min(21, jerseyNumber - 1));
  return zones[idx] ?? { col: 1, row: 0 };
}

// ── Position → action bias ────────────────────────────────────────────────────
//
// Baseline action tendency for each position BEFORE manager / situation
// modifiers are applied.  These are not probabilities — they are relative
// weights fed into decisionBlender.blendDecision(), which normalises them to
// [0, 1] against the other layers before sampling.
//
// HOW TO READ THE VALUES
// ──────────────────────
// A FW with shoot:0.40 and a DF with shoot:0.06 means the forward's base
// shooting tendency is ~6.7× stronger than the defender's when all other
// factors are equal.  After blending with personality, agent state, and
// relationships, the exact multiplier shifts, but the order of magnitude
// stays true to role.
//
// CALIBRATION NOTES
// ─────────────────
// GK   — shoot:0.01 (only a desperate long punt in extremis), pass:0.60
//         (distribution is the primary function), dribble:0.04 (almost never)
// DF   — shoot:0.06 (rare long-range attempt), tackle:0.30 (primary job),
//         pass:0.45 (clear the ball / play out from the back)
// MF   — balanced across all actions; shoot:0.18 drives the majority of
//         long-range goals, press:0.18 reflects midfield's pressing role
// FW   — shoot:0.40 (primary function), dribble:0.22 (beats defenders),
//         tackle:0.05 (will try to win it back but rarely succeeds)

const POSITION_BIAS: Record<string, ActionBias> = {
  GK:  { shoot: 0.01, pass: 0.60, dribble: 0.04, tackle: 0.10, press: 0.05 },
  DF:  { shoot: 0.06, pass: 0.45, dribble: 0.12, tackle: 0.30, press: 0.12 },
  MF:  { shoot: 0.18, pass: 0.32, dribble: 0.22, tackle: 0.15, press: 0.18 },
  FW:  { shoot: 0.40, pass: 0.18, dribble: 0.22, tackle: 0.05, press: 0.10 },
};

/**
 * Fallback when position is unknown — mirrors the MF baseline.
 * Declared as a literal (rather than `POSITION_BIAS['MF']`) so it is a
 * guaranteed ActionBias under noUncheckedIndexedAccess, which would otherwise
 * type the indexed lookup as `ActionBias | undefined`.
 */
const DEFAULT_POSITION_BIAS: ActionBias =
  { shoot: 0.18, pass: 0.32, dribble: 0.22, tackle: 0.15, press: 0.18 };

// ── Manager playstyle → zone pressure modifier ────────────────────────────────
//
// Each playstyle applies an additive delta to every player's base position
// bias, regardless of position.  decisionBlender.blendDecision() normalises
// the final blended weights, so these values are relative adjustments, not
// absolute probabilities.
//
// Named styles match `managers.style` in the DB (see CLAUDE.md "Manager"
// section).  An unrecognised style string falls back to Balanced (all zeros).
//
// HOW TO READ THE MAGNITUDE
// ─────────────────────────
// +0.10 on shoot for 'Offensive' means the manager adds roughly 10 percentage
// points of shooting tendency on top of every player's position baseline.
// Combined with a FW base of 0.40, an Offensive manager FW has ~0.50 shoot
// weight before blending — making that player noticeably trigger-happy.
// +0.20 press for 'High Pressing' is the strongest single modifier in the
// table, reflecting how high-press requires every player to run hard.
//
// WHY THESE SPECIFIC VALUES
// ─────────────────────────
// Deltas are bounded to ±0.20 so no playstyle completely overrides a player's
// natural tendencies.  A GK with base shoot:0.01 should NEVER become a
// shooting threat even under an Offensive manager (+0.10 → 0.11 ≪ FW base).
// That boundary is also why Balanced is all zeros — it is the neutral
// reference point, not "mediocre"; a balanced manager lets players express
// their own position biases unfiltered.

export interface StyleModifier {
  readonly shoot:   number; // additive delta on shooting tendency
  readonly pass:    number; // additive delta on passing tendency
  readonly dribble: number; // additive delta on dribbling tendency
  readonly tackle:  number; // additive delta on tackling tendency
  readonly press:   number; // additive delta on pressing tendency
}

const STYLE_MODIFIERS: Record<string, StyleModifier> = {
  // Offensive: push everyone forward; slight sacrifice of defensive solidity
  Offensive:       { shoot: +0.10, pass: +0.05, dribble: +0.05, tackle: -0.05, press: +0.05 },
  // Balanced: no adjustment — players play to their natural position role
  Balanced:        { shoot:  0.00, pass:  0.00, dribble:  0.00, tackle:  0.00, press:  0.00 },
  // Defensive: reduce risk-taking, increase defensive actions (+0.15 tackle is the biggest defensive modifier)
  Defensive:       { shoot: -0.08, pass: +0.10, dribble: -0.05, tackle: +0.15, press: -0.05 },
  // Direct: long balls and early shots; sacrifices patient build-up (-0.08 dribble)
  Direct:          { shoot: +0.12, pass: -0.05, dribble: -0.08, tackle:  0.00, press: +0.05 },
  // Possession: maximum pass weight (+0.18 is the strongest pass modifier); fewer shots
  Possession:      { shoot: -0.05, pass: +0.18, dribble: +0.08, tackle: -0.05, press: -0.05 },
  // Counterattacking: conserve in defence, explode on transition (+0.08 shoot when counter fires)
  Counterattacking:{ shoot: +0.08, pass:  0.00, dribble: +0.05, tackle: +0.05, press: -0.05 },
  // High Pressing: press:+0.20 is the table maximum — everyone harasses, everywhere, all match
  'High Pressing': { shoot:  0.00, pass: -0.05, dribble:  0.00, tackle: +0.10, press: +0.20 },
  // Aggressive: physical, confrontational; tackle:+0.15 and press:+0.10 create fouls and flashpoints
  Aggressive:      { shoot: +0.05, pass: -0.08, dribble: +0.05, tackle: +0.15, press: +0.10 },
};

/**
 * Fallback when manager style is unknown — the Balanced zero-delta modifier.
 * Declared as a literal (rather than `STYLE_MODIFIERS['Balanced']`) so it is a
 * guaranteed StyleModifier under noUncheckedIndexedAccess.
 */
const DEFAULT_STYLE_MODIFIER: StyleModifier =
  { shoot: 0.00, pass: 0.00, dribble: 0.00, tackle: 0.00, press: 0.00 };

// ── Manager stat → tactical urgency ──────────────────────────────────────────
//
// The manager's 5 numeric stats (0–100) scale their style modifier.
// A high-attacking manager amplifies offensive modifiers; a high-defending
// manager amplifies defensive modifiers. Scale is gentle (÷200 gives ±0.5
// sensitivity on top of the style delta).

interface ManagerStats {
  attacking:  number;
  defending:  number;
  technical:  number;
  athletic:   number;
  mental:     number;
}

/**
 * Compute the final action bias for a player given their position, their
 * manager's playstyle, the manager's numeric stats, and the current match
 * situation.
 *
 * Pure function — no I/O, no side effects.
 *
 * @param position     Player's position ('GK'|'DF'|'MF'|'FW').
 * @param styleRaw     Manager's style string from the DB.
 * @param mgrStats     Manager's numeric stats (0–100 each).
 * @param scoreDiff    Positive = team is winning, negative = losing.
 * @param minute       Current match minute (1–90).
 */
/**
 * Compute the positional action-bias for a single player, incorporating their
 * position, manager playstyle, manager numeric stats, and the live match
 * situation.
 *
 * This is the "Manager playstyle → Positional instructions" step in the
 * decision pipeline.  The returned ActionBias is not normalised — it is
 * fed as one weighted layer into decisionBlender.blendDecision(), which
 * normalises across all layers before sampling an action.
 *
 * @param position   Player DB position string: 'GK' | 'DF' | 'MF' | 'FW'.
 *                   Unknown values fall back to the MF baseline.
 * @param styleRaw   Manager's style string from `managers.style` in the DB
 *                   (e.g. 'High Pressing', 'Possession').  Unknown or null
 *                   values fall back to the Balanced zero-delta modifier.
 * @param mgrStats   Manager's five numeric stats from the `managers` table.
 *                   Any missing stat defaults to 70, which is the league
 *                   average and produces a neutral 0 amplifier.
 * @param scoreDiff  Goal difference from this team's perspective.
 *                   Positive = winning, negative = losing, 0 = level.
 * @param minute     Current match minute (1–90).  Controls when situation
 *                   modifiers activate (desperation at 70+, comfort at 60+).
 * @returns          ActionBias with all weights ≥ 0.01 (ready for blender).
 */
export function getPositionalInstructions(
  position:  string,
  styleRaw:  string | undefined | null,
  mgrStats:  Partial<ManagerStats>,
  scoreDiff: number,
  minute:    number,
): ActionBias {
  const base   = POSITION_BIAS[position] ?? DEFAULT_POSITION_BIAS;
  const style  = STYLE_MODIFIERS[styleRaw ?? ''] ?? DEFAULT_STYLE_MODIFIER;

  // ── Manager stat amplifier ─────────────────────────────────────────────────
  // The manager's attacking and defending stats (0–100) scale how strongly
  // their playstyle modifiers apply.  We centre on 50 (average) and divide
  // by 200 to map [0, 100] → [−0.25, +0.25] (a quarter-turn of amplification
  // either way).  A stat of 70 (solid) → atkScale = +0.10, amplifying the
  // Offensive shoot modifier from +0.10 to +0.11 — a subtle but compounding
  // effect over 90 minutes.  A stat of 90 (elite) → +0.20 amplification.
  // Default of 70 is the league average for normalizeTeamForEngine fallback.
  const atkScale = ((mgrStats.attacking ?? 70) - 50) / 200;
  const defScale = ((mgrStats.defending ?? 70) - 50) / 200;

  // ── Desperation modifier ───────────────────────────────────────────────────
  // When a team is losing with 20 minutes left (minute ≥ 70), the manager
  // implicitly asks everyone to push forward.  The modifier scales with goal
  // deficit: 0.04 per goal means trailing by 1 adds +0.04 shoot/press, while
  // trailing by 3 (unlikely but possible) adds +0.12 — enough to turn a
  // Defensive DF into an attacking threat.  Minute threshold of 70 matches
  // the engine's own late-game logic (see gameEngine.js "scoreDiff < 0 &&
  // min >= 80" roll multiplier) but fires 10 minutes earlier to give the
  // tactical shift time to affect events.
  const desperationMod = (scoreDiff < 0 && minute >= 70)
    ? Math.abs(scoreDiff) * 0.04   // +0.04 per goal behind
    : 0;

  // ── Comfort modifier ──────────────────────────────────────────────────────
  // When winning by more than 1 goal after the hour mark, the manager can
  // afford to sit deeper and protect the lead.  scoreDiff > 1 avoids triggering
  // on a fragile 1-goal lead; minute ≥ 60 avoids conservative play in the
  // first half.  Rate of 0.03 per goal is half of desperationMod — winning
  // teams tighten slowly, losing teams panic quickly.
  const comfortMod = (scoreDiff > 1 && minute >= 60)
    ? scoreDiff * 0.03   // +0.03 per extra goal of lead
    : 0;

  // ── Combine layers ────────────────────────────────────────────────────────
  // Offensive actions (shoot, dribble) are amplified by atkScale.
  // Defensive actions (tackle, pass) are amplified by defScale.
  // Desperation boosts shooting most (+1.0×), dribbling partially (+0.3×),
  // and pressing (+0.4×) — a desperate team does NOT tackle more, they push
  // forward and hope.  Comfort boosts passing (+0.5×) and tackling (+1.0×) —
  // a winning team keeps the ball and breaks up counter-attacks.
  const raw = {
    shoot:   base.shoot   + style.shoot   * (1 + atkScale) + desperationMod,
    pass:    base.pass    + style.pass    * (1 + defScale) + comfortMod * 0.5,
    dribble: base.dribble + style.dribble * (1 + atkScale) + desperationMod * 0.3,
    tackle:  base.tackle  + style.tackle  * (1 + defScale) + comfortMod,
    press:   base.press   + style.press   * (1 + atkScale) + desperationMod * 0.4,
  };

  // Clamp to 0.01 minimum — a weight of exactly 0 would cause divide-by-zero
  // in the blender's normalisation step; a weight of 0.01 is functionally
  // impossible without breaking the math.  Upper bound is unconstrained here
  // because the blender normalises across the total weight sum anyway.
  return {
    shoot:   Math.max(0.01, raw.shoot),
    pass:    Math.max(0.01, raw.pass),
    dribble: Math.max(0.01, raw.dribble),
    tackle:  Math.max(0.01, raw.tackle),
    press:   Math.max(0.01, raw.press),
  };
}

// ── Situation-driven zone offset ──────────────────────────────────────────────
//
// Players don't stand still — they shift their effective zone based on
// whether their team has the ball and what the scoreline demands.  This
// returns a signed row delta that the caller applies on top of a player's
// formation home zone via applyZoneDelta().
//
// WHY A DELTA RATHER THAN AN ABSOLUTE ZONE
// ─────────────────────────────────────────
// Formation zones already encode the right base position; the delta just
// answers "how far have circumstances pushed you from your natural spot?"
// Keeping them separate lets the renderer blend smoothly: the home zone is
// the anchor, the delta is the drift, and CSS transitions handle the visual
// interpolation between the two.

/**
 * Context the caller must supply for the situation-driven zone offset.
 * All fields come from the engine's per-minute state available in genEvent().
 */
export interface SituationContext {
  /** True when this team has possession this minute. */
  hasPossession: boolean;
  /**
   * Goal difference from this team's perspective.
   * Positive = winning, negative = losing, 0 = level.
   */
  scoreDiff:     number;
  /** Current match minute (1–90). */
  minute:        number;
  /** Engine chaos level (0–100); reserved for future use. */
  chaosLevel:    number;
}

/**
 * Compute the zone-row delta a player should apply to their formation home
 * zone given the current match situation.
 *
 * The returned value is always in {−1, 0, +1} — exactly one zone row of
 * movement in either direction, or no movement.  Callers apply it via
 * applyZoneDelta() which clamps the result to the valid [0, 3] row range.
 *
 * @param ctx       Live situation context (possession, score, minute).
 * @param position  Player's position string ('GK'|'DF'|'MF'|'FW').
 * @returns         Row delta: −1 = drop back, 0 = hold, +1 = push forward.
 */
export function situationZoneDelta(ctx: SituationContext, position: string): -1 | 0 | 1 {
  let delta = 0;

  // ── Possession phase ──────────────────────────────────────────────────────
  // When the team has the ball, attackers and midfielders push into advanced
  // zones; defenders hold their line (no delta) to maintain defensive shape.
  // When defending, the whole team drops half a row (rounds to −1 after
  // Math.round) — enough to compact the defensive block without GK running
  // into their own penalty area.
  //
  // FW   +1  — push to the opponent's third (zone row 3) to stay onside
  // MF   +0.5 — advance to the transition zone; rounds to +1 at this delta
  // DF    0  — hold the defensive line; no delta
  // GK    0  — stays in goal regardless of possession
  if (ctx.hasPossession) {
    if (position === 'FW') delta += 1;   // one full zone row forward
    if (position === 'MF') delta += 0.5; // half row; rounds to +1 via Math.round
  } else {
    // WHY -1 NOT -0.5: JavaScript's Math.round(-0.5) returns -0 (not -1) because
    // it rounds toward +∞ on ties.  Using -1 directly is the only reliable way
    // to produce a -1 delta after clamping.  The net effect is the same as the
    // intended "drop one row back" — the half-step was only there to allow
    // combination with desperation (+1) to cancel out, which -1 + 1 = 0 also
    // achieves correctly.
    delta -= 1; // defending: every player drops one full row back
  }

  // ── Desperation push (last 15 minutes, losing) ────────────────────────────
  // From minute 75 onward a losing team throws everyone forward regardless of
  // role.  +1 row is added on top of the possession delta, meaning a defending
  // DF who is also losing will net to 0 delta (drops for defending, rises for
  // desperation) — they advance to the halfway line rather than sitting back.
  // Minute threshold of 75 gives the engine 15 minutes of visible cavalry
  // charge, matching how real teams actually behave (substitutions, set-piece
  // gambles) rather than starting too early.
  if (ctx.scoreDiff < 0 && ctx.minute >= 75) {
    delta += 1; // +1 row: "everyone attack" instruction overrides formation
  }

  // ── Comfort pull (hour mark, winning by 2+) ───────────────────────────────
  // scoreDiff > 1 (not just > 0) avoids triggering on a fragile one-goal
  // lead; teams really do only start sitting deep when they feel safe.
  // −0.5 (rounds to −1) pulls the whole team one row back — the tactical
  // equivalent of "keep the ball, don't concede on a break."
  if (ctx.scoreDiff > 1 && ctx.minute >= 60) {
    delta -= 0.5; // tighten up: drop one row across the board
  }

  // ── Clamp to ±1 ──────────────────────────────────────────────────────────
  // Multiple deltas can push past ±1 (e.g. FW in possession + desperate =
  // +2.0 before rounding).  Clamping to [−1, +1] ensures we never ask the
  // renderer to jump two zones in a single 2-second snapshot tick.
  return Math.round(Math.max(-1, Math.min(1, delta))) as -1 | 0 | 1;
}

/**
 * Apply a row delta to a zone, clamping within [0, 3].
 */
export function applyZoneDelta(zone: Zone, delta: number): Zone {
  const newRow = Math.max(0, Math.min(3, zone.row + delta)) as ZoneRow;
  return { col: zone.col, row: newRow };
}
