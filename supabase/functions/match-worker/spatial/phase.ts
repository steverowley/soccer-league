// ── features/match/logic/spatial/phase.ts ────────────────────────────────────
// Phases of play (docs/phases-of-play.md).  The ENGINE owns the phase machine:
// every tick each team's phase is re-read from observable state (who has the
// ball, where it is, how long since possession changed, whether the
// opponent's first line has been beaten).  The MANAGER owns the plan: his game
// model (gameModel.ts), adjusted in-match by the score and the clock, decides
// what his team does in each phase.
//
// Phases change where each player WANTS to be (his shape point) and which
// off-ball jobs he values.  They never decide an outcome, and nothing here
// draws a random number.

import { type Vec2, vec, dist } from './vec2.ts';
import {
  type SimPlayer, type SimWorld, type TeamSide, type Role,
  PITCH_LENGTH, PITCH_WIDTH, defendingGoalX, otherSide,
} from './types.ts';
import {
  type GameModel, type BlockHeight, type PressTrigger, restSplit, buildUpLines,
} from './gameModel.ts';
import { lateness, goalDiff, offsideLineX } from './possession.ts';
import type { FormationSlot } from './formation.ts';

/** A team's phase of play. */
export type TeamPhase =
  | 'attacking_transition' | 'build_up' | 'progression' | 'final_third'
  | 'defensive_transition' | 'high_block' | 'mid_block' | 'low_block'
  | 'set_piece';

/** A player's role inside his line (section 3.3). */
export type SubRole = 'GK' | 'CB' | 'FB' | 'DM' | 'CM' | 'WM' | 'W' | 'ST';

/** One entry of the phase timeline: the phase a side entered, and when. */
export interface PhaseChange { tSec: number; phase: TeamPhase }

/** Live per-team tactical state. */
export interface TeamTactics {
  /** The manager's game model as set before kickoff. */
  readonly model: GameModel;
  /** The plan in force now (the model adjusted for the score, clock and legs). */
  plan: GameModel;
  planKey: string;
  phase: TeamPhase;
  /** Whether this side has the ball (carried through passes and loose balls). */
  hasBall: boolean;
  /** Clock second of the last open-play change of possession. */
  changeSec: number;
  /** Line management: metres the back line stands above its block height. */
  lineAdjust: number;
  /** In-possession line per outfielder id: 0 back, 1 screen, 2 front; and his lane (0..1 across). */
  lines: Map<string, { line: 0 | 1 | 2; lane: number }>;
  linesKey: string;
  /** The counter-pressers the plan sent after the last loss, and the loss
   *  (its changeSec) they were picked for. */
  cpIds: string[];
  cpFor: number;
  /** The ball event (control or kick time) the press was last re-read on. */
  cpKey: number;
  readonly timeline: PhaseChange[];
}

/** Seconds a transition lasts (the research's ~6 s window). */
export const TRANSITION_SEC = 6;

/** Ball within this distance (m) of the opponent's goal: the final third. */
const FINAL_THIRD_D = 70;

// ── Sub-roles ──────────────────────────────────────────────────────────────

/**
 * A slot's sub-role from its line and lane: wide defenders are full-backs, a
 * lone central midfielder in an odd line is the holding midfielder, wide
 * forwards are wingers.
 */
export function subRoleOf(slot: FormationSlot, slots: readonly FormationSlot[]): SubRole {
  const dy = Math.abs(slot.fy - 0.5);
  if (slot.role === 'GK') return 'GK';
  if (slot.role === 'DF') return dy >= 0.25 ? 'FB' : 'CB';
  if (slot.role === 'FW') return dy >= 0.15 ? 'W' : 'ST';
  if (dy >= 0.25) return 'WM';
  const central = slots.filter((s) => s.role === 'MF' && Math.abs(s.fy - 0.5) < 0.25);
  return central.length % 2 === 1 && dy < 0.01 ? 'DM' : 'CM';
}

/** How deep a player sits in the in-possession structure (lower = deeper). */
function depthScore(sub: SubRole, role: Role, m: GameModel): number {
  switch (sub) {
    case 'CB': return 0;
    case 'FB': return m.fullBackRole === 'stay' ? 1 : m.fullBackRole === 'invert' ? 2.5 : 4.6;
    case 'DM': return 2;
    case 'CM': return 3;
    case 'WM': return 5;
    case 'W': return 5.5;
    case 'ST': return 6;
    default: return role === 'DF' ? 0.5 : role === 'MF' ? 3 : 6;
  }
}

// ── Construction ───────────────────────────────────────────────────────────

/** Fresh tactical state for a side. */
export function makeTactics(model: GameModel): TeamTactics {
  return {
    model, plan: model, planKey: '', phase: 'set_piece', hasBall: false, changeSec: -100,
    lineAdjust: 0, lines: new Map(), linesKey: '', cpIds: [], cpFor: -1, cpKey: -1, timeline: [{ tSec: 0, phase: 'set_piece' }],
  };
}

export function tacticsOf(world: SimWorld, side: TeamSide): TeamTactics {
  return side === 'home' ? world.tactics.home : world.tactics.away;
}

function setPhase(t: TeamTactics, phase: TeamPhase, now: number): void {
  if (t.phase === phase) return;
  t.phase = phase;
  t.timeline.push({ tSec: Math.round(now * 10) / 10, phase });
}

// ── In-match management (section 3.2) ─────────────────────────────────────

const BLOCK_UP: Record<BlockHeight, BlockHeight> = { low: 'mid', mid: 'high', high: 'high' };
const BLOCK_DOWN: Record<BlockHeight, BlockHeight> = { high: 'mid', mid: 'low', low: 'low' };

/**
 * The manager's plan as the match unfolds: chasing late, the rest defence
 * shrinks, the block and the line push up and every regain is a counter;
 * protecting a lead, the block drops, an extra man stays behind the ball and
 * a regain is kept; on tired legs the counter-press shortens and the block
 * stops engaging on every ball.
 */
export function adjustPlan(m: GameModel, world: SimWorld, side: TeamSide): GameModel {
  const team = (side === 'home' ? world.home : world.away).filter((p) => !p.sentOff && p.role !== 'GK');
  const legs = team.reduce((s, p) => s + p.stamina, 0) / Math.max(1, team.length);
  let plan: GameModel = m;
  if (world.flags.scoreClockTerm) {
    const L = lateness(world);
    const gd = goalDiff(world, side);
    if (gd < 0 && L > 0.25) {
      const rest = Math.max(3, m.restDefence - (L > 0.6 && gd <= -2 ? 2 : 1));
      plan = {
        ...plan, restDefence: rest,
        ...(L > 0.5 ? { blockHeight: BLOCK_UP[m.blockHeight], onRegain: 'counter' as const, settledLineHeight: Math.min(55, m.settledLineHeight + 4), lineManagement: 'aggressive' as const } : {}),
      };
    } else if (gd > 0 && L > 0.25) {
      plan = {
        ...plan, restDefence: Math.min(7, m.restDefence + 1), onRegain: 'secure',
        ...(L > 0.45 ? { blockHeight: BLOCK_DOWN[m.blockHeight], settledLineHeight: Math.max(26, m.settledLineHeight - 6) } : {}),
        ...(L > 0.65 ? { onLoss: 'recover' as const, lineManagement: 'cautious' as const } : {}),
      };
    }
  }
  if (legs < 0.62) {
    const triggers: PressTrigger[] = plan.pressTriggers.filter((t) => t !== 'always');
    const extra: PressTrigger[] = plan.pressTriggers.includes('always') ? ['bad_touch', 'back_pass'] : [];
    plan = {
      ...plan, counterpressPlayers: Math.max(0, plan.counterpressPlayers - 1),
      counterpressSec: Math.max(0, plan.counterpressSec - 1),
      pressTriggers: [...triggers, ...extra].filter((t, i, a) => a.indexOf(t) === i),
    };
  }
  return plan;
}

// ── The phase machine ─────────────────────────────────────────────────────

/** Distance (m) of a point from a side's own goal line. */
export function fromOwnGoal(side: TeamSide, x: number): number {
  return Math.abs(x - defendingGoalX(side));
}

/** The block a side settles into for its plan and the ball's position. */
function blockPhase(h: BlockHeight, ballD: number): TeamPhase {
  if (ballD < 35) return 'low_block';
  if (h === 'high') return ballD >= 52.5 ? 'high_block' : 'mid_block';
  if (h === 'low') return ballD >= 70 ? 'mid_block' : 'low_block';
  return 'mid_block';
}

/**
 * During a restart: possession belongs to the side taking it and nobody is in
 * transition (the restart resets play).
 */
export function noteRestart(world: SimWorld): void {
  const r = world.restart;
  if (!r) return;
  for (const side of ['home', 'away'] as const) {
    const t = tacticsOf(world, side);
    t.hasBall = r.side === side;
    t.changeSec = -100;
    setPhase(t, 'set_piece', world.clockSec);
  }
}

/**
 * Re-read both teams' phases.  `ownerSide` is the side of the player in
 * possession, or null while the ball is loose or in flight (possession then
 * stays with the side that had it).
 */
export function updatePhases(world: SimWorld, ownerSide: TeamSide | null, dt: number): void {
  const now = world.clockSec;
  for (const side of ['home', 'away'] as const) {
    const t = tacticsOf(world, side);
    const key = `${Math.floor(now / 30)}:${world.score[0]}:${world.score[1]}`;
    if (key !== t.planKey) { t.planKey = key; t.plan = adjustPlan(t.model, world, side); }
    if (ownerSide !== null) {
      const has = ownerSide === side;
      // Possession won from the opponent (in open play, or straight from a
      // restart he took) opens a transition for both sides.
      if (has !== t.hasBall) { t.hasBall = has; t.changeSec = now; }
    }
  }
  for (const side of ['home', 'away'] as const) {
    const t = tacticsOf(world, side);
    const ballD = fromOwnGoal(side, world.ball.pos.x);
    const since = now - t.changeSec;
    let phase: TeamPhase;
    if (t.hasBall) {
      if (since < TRANSITION_SEC) phase = 'attacking_transition';
      else if (ballD >= FINAL_THIRD_D) phase = 'final_third';
      else phase = ballD > firstLineD(world, side) + 1 ? 'progression' : 'build_up';
    } else if (since < TRANSITION_SEC) phase = 'defensive_transition';
    else phase = blockPhase(t.plan.blockHeight, ballD);
    setPhase(t, phase, now);
    if (!t.hasBall) manageLine(world, side, t, dt);
    else t.lineAdjust *= Math.max(0, 1 - dt);
  }
}

/** Distance from `side`'s own goal of the opponent's first line (its second
 *  most advanced outfielder). */
function firstLineD(world: SimWorld, side: TeamSide): number {
  const ds: number[] = [];
  for (const q of side === 'home' ? world.away : world.home) if (!q.sentOff && q.role !== 'GK') ds.push(fromOwnGoal(side, q.pos.x));
  ds.sort((a, b) => a - b);
  return ds[1] ?? 0;
}

/** Step-up and drop distances (m) per line-management choice. */
const LINE_STEP: Readonly<Record<string, [number, number]>> = {
  aggressive: [6, 2], measured: [4, 3.5], cautious: [2, 5],
};

/**
 * Line management out of possession: a covered ball (the carrier pressed, or
 * turned back toward his own goal) and the line steps up; an uncovered one
 * (nobody near him, facing forward) and it drops.  Smoothed, so the line
 * moves as a unit over a second or so.
 */
function manageLine(world: SimWorld, side: TeamSide, t: TeamTactics, dt: number): void {
  const b = world.ball;
  const carrier = b.ownerId ? findIn(world, otherSide(side), b.ownerId) : null;
  let target = 0;
  if (carrier) {
    const fwd = side === 'home' ? -1 : 1; // the carrier's attacking direction (toward our goal)
    let nearest = Infinity;
    for (const q of side === 'home' ? world.home : world.away) if (!q.sentOff) nearest = Math.min(nearest, dist(q.pos, carrier.pos));
    const backward = carrier.vel.x * fwd < -0.8;
    const [up, down] = LINE_STEP[t.plan.lineManagement]!;
    if (nearest < 3.5 || backward) target = up;
    else if (nearest > 7) target = -down;
  }
  t.lineAdjust += (target - t.lineAdjust) * Math.min(1, dt * 1.2);
}

function findIn(world: SimWorld, side: TeamSide, id: string): SimPlayer | null {
  for (const q of side === 'home' ? world.home : world.away) if (q.id === id) return q;
  return null;
}

// ── Shape targets ─────────────────────────────────────────────────────────

/** Lateral lanes (fractions of the width) for a line of n players. */
function lanes(n: number, lo: number, hi: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [0.5];
  return Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));
}

const WIDTH_SPAN: Readonly<Record<string, number>> = { wide: 0.84, balanced: 0.74, narrow: 0.62 };

/**
 * Assign every outfielder of a side in possession to the back line, the
 * screen or the front, by sub-role and the plan: the build-up shape in
 * build-up and progression, the rest-defence split once the side is in the
 * final third.  Cached until the eleven or the plan changes.
 */
function possessionLines(world: SimWorld, side: TeamSide, t: TeamTactics, final: boolean): Map<string, { line: 0 | 1 | 2; lane: number }> {
  const team = (side === 'home' ? world.home : world.away).filter((p) => !p.sentOff && p.role !== 'GK');
  const m = t.plan;
  const key = `${final ? 'F' : 'B'}${m.buildUpShape}${m.restDefence}${m.restShape}${m.width}${m.fullBackRole}:${team.map((p) => p.id).join(',')}`;
  if (key === t.linesKey) return t.lines;
  const n = team.length;
  let back: number, screen: number;
  if (final) {
    [back, screen] = restSplit(m, Math.min(m.restDefence, n - 1));
  } else {
    [back, screen] = buildUpLines(m.buildUpShape);
  }
  back = Math.min(back, n);
  screen = Math.max(0, Math.min(screen, n - back - 1));
  const ranked = team
    .map((p, i) => ({ p, s: depthScore(p.subRole, p.role, m) + Math.abs(p.homePos.y / PITCH_WIDTH - 0.5) * 0.1 + i * 1e-4 }))
    .sort((a, b) => a.s - b.s)
    .map((x) => x.p);
  const groups: SimPlayer[][] = [ranked.slice(0, back), ranked.slice(back, back + screen), ranked.slice(back + screen)];
  const span = WIDTH_SPAN[m.width]!;
  const laneSets = [
    back <= 2 ? lanes(back, 0.3, 0.7) : back === 3 ? lanes(3, 0.2, 0.8) : lanes(back, 0.1, 0.9),
    lanes(screen, screen <= 2 ? 0.38 : 0.25, screen <= 2 ? 0.62 : 0.75),
    lanes(groups[2]!.length, 0.5 - span / 2, 0.5 + span / 2),
  ];
  const out = new Map<string, { line: 0 | 1 | 2; lane: number }>();
  groups.forEach((g, li) => {
    const byY = [...g].sort((a, b) => a.homePos.y - b.homePos.y);
    byY.forEach((p, k) => out.set(p.id, { line: li as 0 | 1 | 2, lane: laneSets[li]![k]! }));
  });
  t.lines = out;
  t.linesKey = key;
  return out;
}

/** Which in-possession line a player is in right now (2 when unknown). */
export function lineOf(world: SimWorld, p: SimPlayer): 0 | 1 | 2 {
  const t = tacticsOf(world, p.side);
  if (!t.hasBall) return 2;
  const final = t.phase === 'final_third';
  return possessionLines(world, p.side, t, final).get(p.id)?.line ?? 2;
}

/**
 * Where a player wants to be while his side has the ball: his line's depth
 * (back line from the plan's settled height and the ball, screen ahead of
 * it, the front pinning the opponent's last line) and his lane across.
 */
export function possessionPoint(p: SimPlayer, world: SimWorld): Vec2 {
  const t = tacticsOf(world, p.side);
  const m = t.plan;
  const side = p.side;
  const own = defendingGoalX(side);
  const dir = side === 'home' ? 1 : -1;
  const ball = world.ball.pos;
  const ballD = fromOwnGoal(side, ball.x);
  const final = t.phase === 'final_third';
  const slot = possessionLines(world, side, t, final).get(p.id) ?? { line: 2 as const, lane: p.homePos.y / PITCH_WIDTH };
  const lastLineD = fromOwnGoal(side, offsideLineX(world, side));
  const settled = t.phase !== 'attacking_transition' && t.phase !== 'set_piece';
  // Back line: up with the ball to the plan's settled height, never level
  // with the ball once the side is past halfway (it is the rest defence).
  // Until the side is settled (a transition, a restart) the line stays
  // nearer home.
  const cap = settled ? m.settledLineHeight : Math.min(m.settledLineHeight, UNSETTLED_LINE);
  // Settled with the ball in the opponent's half, the line is up at the
  // manager's height (it ramps there over the last 12 m before halfway).
  const settledUp = settled ? cap - Math.max(0, PITCH_LENGTH / 2 - ballD) * 0.85 : 0;
  let backD = Math.min(cap, Math.max(12, 0.62 * ballD + 3, settledUp));
  if (ballD > 40) backD = Math.min(backD, ballD - 10);
  let d: number;
  let pull: number;
  if (slot.line === 0) {
    d = backD;
    pull = 0.18;
  } else if (slot.line === 1) {
    // The screen: ahead of the back line, and once the ball is in the
    // opponent's half within counter-press distance behind it, so a loss
    // can be pressed at once (the rest defence's job, section 2).
    d = Math.max(backD + 13, ballD - SCREEN_GAP);
    if (ballD > 45) d = Math.min(d, ballD - 3);
    pull = 0.22;
  } else {
    // The front: strikers and wingers pin the last line; the half-space
    // players sit a few metres off it, between the lines.
    const wide = Math.abs(slot.lane - 0.5) >= 0.3;
    // Only the strikers pin the last line.  The wide men hold the
    // touchline a few metres off it and everyone else between the lines;
    // against a deep line they arrive from the edge of the area rather than
    // stand in the box, which is where crosses and cut-backs find them.
    const pin = p.subRole === 'ST';
    d = lastLineD - (pin ? 1 : wide ? 3 : 5);
    if (!pin) d = Math.min(d, PITCH_LENGTH - EDGE_OF_BOX);
    d = Math.min(d, backD + 50);
    d = Math.max(d, backD + 22);
    pull = 0.1;
  }
  const y = slot.lane * PITCH_WIDTH + (ball.y - PITCH_WIDTH / 2) * pull;
  return vec(own + dir * Math.max(4, Math.min(PITCH_LENGTH - 4, d)), Math.max(1.5, Math.min(PITCH_WIDTH - 1.5, y)));
}

/** Furthest (m) the in-possession screen sits behind the ball. */
const SCREEN_GAP = 12;

/** Back-line cap (m from own goal) in possession before the side is settled. */
const UNSETTLED_LINE = 26;

/** Formation spread (m) the back line's lanes are scaled from: a back four
 *  across about 31 m at a 40 m block width, so the gaps between centre-back
 *  and full-back stay closable. */
const BACK_SPREAD = 52;

/** Distance (m) from the opponent's goal at which midfielders in the front
 *  line wait against a deep block: the edge of the area. */
const EDGE_OF_BOX = 24;

/** Back-line height (m from own goal) of each default block. */
const BLOCK_LINE: Readonly<Record<BlockHeight, number>> = { high: 40, mid: 29, low: 19 };

/** The back line's height for a side out of possession right now. */
export function blockLineD(world: SimWorld, side: TeamSide): number {
  const t = tacticsOf(world, side);
  const ballD = fromOwnGoal(side, world.ball.pos.x);
  const base = BLOCK_LINE[t.plan.blockHeight] + t.lineAdjust;
  // Defending the box: with the ball near goal the line drops toward the
  // six-yard box, never deeper than this floor.
  const floor = Math.min(base, Math.max(6, 0.45 * ballD + 2));
  return Math.max(floor, Math.min(base, ballD - 18));
}

/**
 * Where a player wants to be while his side defends: his line of the block
 * (back line at the block height, midfield and attack ahead of it within
 * the plan's block length) and his lane, squeezed across toward the ball to
 * the plan's block width.
 */
export function blockPoint(p: SimPlayer, world: SimWorld): Vec2 {
  const t = tacticsOf(world, p.side);
  const m = t.plan;
  const side = p.side;
  const own = defendingGoalX(side);
  const dir = side === 'home' ? 1 : -1;
  const ball = world.ball.pos;
  const ballD = fromOwnGoal(side, ball.x);
  const lineD = blockLineD(world, side);
  // Near goal the block sits in two tight lines across the face of the box
  // with the forwards dropping in front of them; further out the lines
  // spread to the plan's block length.
  const deep = ballD < 35;
  let d = lineD;
  if (p.role === 'MF') d = lineD + (deep ? 7.5 : Math.min(14, 0.45 * m.blockLength));
  else if (p.role === 'FW') d = lineD + (deep ? Math.min(m.blockLength, 19) : m.blockLength);
  // Across: the back line always spans the box (the far post is never left
  // empty), the lines ahead of it squeeze harder toward the ball.
  const back = p.role === 'DF';
  const centre = PITCH_WIDTH / 2 + (ball.y - PITCH_WIDTH / 2) * (back ? 0.4 : p.role === 'FW' ? 0.35 : 0.5);
  const y = centre + (p.homePos.y - PITCH_WIDTH / 2) * (m.blockWidth / (back ? BACK_SPREAD : 48));
  return vec(own + dir * Math.max(3, Math.min(PITCH_LENGTH - 3, d)), Math.max(1.5, Math.min(PITCH_WIDTH - 1.5, y)));
}

// ── Pressing ──────────────────────────────────────────────────────────────

/** Whether one of the plan's press triggers is live on the carrier now. */
export function pressTriggered(world: SimWorld, side: TeamSide, carrier: SimPlayer): boolean {
  const t = tacticsOf(world, side);
  const b = world.ball;
  for (const trig of t.plan.pressTriggers) {
    if (trig === 'always') return true;
    if (trig === 'wide' && (carrier.pos.y < 12 || carrier.pos.y > PITCH_WIDTH - 12)) return true;
    if (trig === 'bad_touch' && world.clockSec - b.controlSec < 0.8 && dist(carrier.pos, b.pos) > 1.3) return true;
    if (trig === 'back_pass' && b.kick && b.kick.side === carrier.side && world.clockSec - b.kick.tSec < 2.5
      && (b.kick.kind === 'pass' || b.kick.kind === 'long')
      && fromOwnGoal(carrier.side, b.kick.aim.x) < fromOwnGoal(carrier.side, b.kick.from.x) - 4) return true;
  }
  return false;
}

/** Whether a side is counter-pressing right now (and how many go). */
export function counterpressing(world: SimWorld, side: TeamSide): number {
  const t = tacticsOf(world, side);
  if (t.hasBall || t.phase !== 'defensive_transition' || t.plan.onLoss !== 'counterpress') return 0;
  return world.clockSec - t.changeSec < t.plan.counterpressSec ? t.plan.counterpressPlayers : 0;
}

