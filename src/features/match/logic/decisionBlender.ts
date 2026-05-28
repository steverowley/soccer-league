// ── features/match/logic/decisionBlender.ts ──────────────────────────────────
// Weighted multi-factor decision blender for the player AI pipeline.
//
// PURPOSE
// ───────
// This module is the "Decision" box in the player-AI diagram.  It receives
// the output of every upstream layer — positional instructions (from
// zoneMapping), raw player stats, personality archetype, live agent state,
// entity-graph relationships, and Architect modifiers — and blends them into
// a single ActionBias that genEvent() samples to pick the event type for this
// player's turn.
//
// WHY A WEIGHTED BLEND RATHER THAN A CASCADE
// ───────────────────────────────────────────
// A strict cascade (formation overrides personality which overrides stats)
// produces brittle, unbalanced behaviour: one layer dominates and the others
// become flavour text.  A weighted blend lets every factor nudge the outcome
// proportionally, so a High-Pressing manager shifts a cautious GK's bias a
// little — not into "always shoots" territory, just slightly more adventurous
// than their baseline.  The blend weights are tuned so no single factor can
// dominate (the highest individual weight is 0.30 for positional instructions,
// meaning a perfect positional setup still only accounts for 30% of the final
// decision).
//
// LAYER WEIGHTS (must sum to 1.0)
// ────────────────────────────────
//   0.30  Positional instructions (zone + formation + manager style + situation)
//   0.25  Player stats (speed, dribbling, passing, etc.)
//   0.20  Personality archetype (selfish, creative, aggressive, …)
//   0.15  Agent state (confidence, fatigue, emotion)
//   0.10  Entity relationships (partnership, rivalry, mentor_pupil, …)
//
// Architect modifiers are applied AFTER the blend as an additive cap of
// ±0.05 per action type so the Architect shapes flavour without ever
// drowning out the players' own characters.
//
// SYNCHRONOUS CONTRACT
// ────────────────────
// This module is called inside genEvent() which runs up to 90 times per
// match simulation.  It must be fully synchronous — no I/O, no awaits.
// All relationship data must be pre-hydrated before kickoff (see
// matchRelationships.ts) and passed in as plain objects.

import type { ActionBias } from './zoneMapping';
import type { EntityRelationship } from '../../entities/types';

// ── Layer weight constants ────────────────────────────────────────────────────
//
// These sum to 1.0 and define how much each factor contributes to the final
// action bias before normalisation.  Adjust them (keeping the sum at 1.0)
// to tune which factors dominate emergent match behaviour.
//
// TUNING GUIDE
// ────────────
// Increase WEIGHT_POSITIONAL to make formation and manager playstyle more
//   deterministic — matches feel more "tactically shaped."
// Increase WEIGHT_STATS to make raw player quality dominate — elite players
//   always do elite things regardless of personality or situation.
// Increase WEIGHT_PERSONALITY to make archetypes more extreme — selfish
//   forwards shoot even when it makes no sense; aggressive defenders foul
//   on every touch.
// Increase WEIGHT_AGENT_STATE to make momentum swings more dramatic —
//   a confident team after a goal stays confident for many events.
// Increase WEIGHT_RELATIONSHIPS to make entity-graph storytelling more
//   mechanically visible — partnerships and rivalries drive more events.

/** Positional instructions (zone + formation + manager style + situation): 30% */
const WEIGHT_POSITIONAL    = 0.30;
/** Raw player stats (speed, dribbling, passing, vision, etc.): 25% */
const WEIGHT_STATS         = 0.25;
/** Personality archetype (selfish, creative, aggressive, etc.): 20% */
const WEIGHT_PERSONALITY   = 0.20;
/** Live agent state (confidence, fatigue, emotion): 15% */
const WEIGHT_AGENT_STATE   = 0.15;
/** Entity-graph relationships (partnership, rivalry, mentor, etc.): 10% */
const WEIGHT_RELATIONSHIPS = 0.10;

// ── Player stat input ─────────────────────────────────────────────────────────
//
// The full set of player stats from the `players` table.  Many of these are
// currently normalised to the engine but not used in resolveContest() —
// this module is where they finally have mechanical effect.
//
// STAT → ACTION MAPPING (see STAT_BIAS below for exact weights)
// ────────────────────────────────────────────────────────────
// shooting:    → shoot bias
// passing:     → pass bias
// dribbling:   → dribble bias
// speed:       → press bias (fast players chase the ball), dribble bias
// stamina:     → press bias (only high-stamina players can press all match)
// tackling:    → tackle bias
// strength:    → tackle bias (physical play)
// vision:      → pass bias (see the through-ball before others do)
// aggression:  → tackle bias, press bias (temperamental harrying)

export interface PlayerStats {
  attacking:   number; // primary stat for resolveContest shots — not directly used here
  defending:   number; // primary stat for resolveContest tackles — not directly used here
  mental:      number; // used in resolveContest; here it modulates personality weight
  athletic:    number; // used in resolveContest; here it boosts press/dribble
  technical:   number; // used in resolveContest; here it boosts pass accuracy
  shooting?:   number; // → shoot bias (default 70 if missing)
  passing?:    number; // → pass + dribble bias
  dribbling?:  number; // → dribble bias
  speed?:      number; // → press + dribble bias
  stamina?:    number; // → press bias
  tackling?:   number; // → tackle bias
  strength?:   number; // → tackle bias
  vision?:     number; // → pass bias
  aggression?: number; // → tackle + press bias
  goalkeeping?:number; // → tackle bias for GK (diving saves are a kind of tackle)
  positioning?:number; // → shoot bias for FW (being in the right place)
}

// ── Personality archetype ─────────────────────────────────────────────────────
//
// These string values must match the PERS.* constants in gameEngine.js which
// assigns them via createAgent().  Adding a new archetype here without adding
// it to the engine's personality assignment block means it will never fire
// (the engine won't produce it) but is otherwise harmless.

export type Personality =
  | 'selfish'       // FW who always shoots — shoot bias max
  | 'team_player'   // passes even when a shot is on — pass bias max
  | 'aggressive'    // commits hard in tackles and press — tackle+press max
  | 'lazy'          // avoids press and tackle — all biases low, especially press
  | 'workhorse'     // high press and tackle, low creativity — press+tackle
  | 'creative'      // attempts ambitious dribbles and through-balls — dribble+pass
  | 'cautious';     // plays safe — pass bias, avoids shoot and dribble

// ── Agent state ───────────────────────────────────────────────────────────────
//
// Ephemeral per-match state from createAgent() in gameEngine.js.  Passed in
// by the caller (genEvent or its refactored successor) from aim.activeHomeAgents
// / aim.activeAwayAgents.  All fields match the live agent object's shape.

export interface AgentState {
  /** 0–100. >70 → bonus; <30 → penalty. */
  confidence: number;
  /** 0–100. >80 → severe penalty; >65 → moderate penalty. */
  fatigue:    number;
  /**
   * Emotional state set by triggerEmotion() in gameEngine.js.
   * 'ecstatic' (just scored) → shoot/dribble up; 'anxious'/'nervous' → pass up, shoot down.
   * 'neutral' → no modification.
   */
  emotion:    'ecstatic' | 'anxious' | 'nervous' | 'devastated' | 'neutral';
  /** True if this player was flagged as a clutch performer at kickoff (15% chance). */
  isClutch:   boolean;
}

// ── Architect modifiers ───────────────────────────────────────────────────────
//
// A thin pass-through of the Architect's active overlays that influence
// decisions at the player level.  These are ADDITIVE CAPS (not weights) —
// applied after the blend, bounded to ±0.05 per action to prevent the
// Architect from overriding player character entirely.
//
// WHY A CAP RATHER THAN A BLEND WEIGHT
// ─────────────────────────────────────
// The Architect is the game's identity (see CLAUDE.md "Core design pillars").
// But its interference must feel cosmic and surprising, not mechanically
// dominant.  If the Architect drove 20% of the decision, the Sealed Fate
// mechanic would make every fate obvious ("that player always shoots now").
// Capping at ±0.05 means the Architect flavours the moment without removing
// the player's soul.

export interface ArchitectDecisionModifiers {
  /**
   * Per-action additive nudge from active Intentions and Edicts.
   * Positive = Architect is pushing toward this action; values are bounded
   * to ±0.05 before application.  Missing actions default to 0.
   */
  nudge?: Partial<ActionBias>;
}

// ── Stat → ActionBias conversion ─────────────────────────────────────────────
//
// Maps the 9 extended player stats to their primary action tendencies.
// Each row is: { stat name → which action it contributes to, and by how much }.
//
// NORMALISATION NOTE
// ──────────────────
// Stats are on the DB scale of roughly [38, 90].  We normalise to [0, 1]
// by dividing by 100 — not perfectly centred but good enough; stats below 50
// produce weights below 0.50 and elite stats above 80 produce weights above
// 0.80.  The blender then applies the WEIGHT_STATS layer weight on top, so
// the maximum stat contribution to any action is 0.90 × 0.25 = 0.225 of the
// final blend before normalisation.

function statsToActionBias(s: PlayerStats): ActionBias {
  // Each action draws from 1–3 stats.  Coefficients reflect the real-world
  // primacy of each stat for each action:
  //   shoot:   shooting:0.6 + positioning:0.25 + attacking:0.15
  //             (being in the right place + technical finish + aggression)
  //   pass:    passing:0.5 + vision:0.35 + technical:0.15
  //             (execution + creativity + composure under pressure)
  //   dribble: dribbling:0.5 + speed:0.35 + passing:0.15
  //             (control + burst of pace + awareness of outlet if tackled)
  //   tackle:  tackling:0.45 + strength:0.35 + aggression:0.20
  //             (timing + physical + intent)
  //   press:   speed:0.40 + stamina:0.40 + aggression:0.20
  //             (pace to close + energy to sustain + desire to win it back)

  // Helper: stat from 0–100 normalised to [0, 1], defaulting to 70 (average)
  const n = (v: number | undefined): number => (v ?? 70) / 100;

  return {
    shoot:   n(s.shooting)   * 0.60 + n(s.positioning)  * 0.25 + n(s.attacking)  * 0.15,
    pass:    n(s.passing)    * 0.50 + n(s.vision)        * 0.35 + n(s.technical)  * 0.15,
    dribble: n(s.dribbling)  * 0.50 + n(s.speed)         * 0.35 + n(s.passing)    * 0.15,
    tackle:  n(s.tackling)   * 0.45 + n(s.strength)      * 0.35 + n(s.aggression) * 0.20,
    press:   n(s.speed)      * 0.40 + n(s.stamina)       * 0.40 + n(s.aggression) * 0.20,
  };
}

// ── Personality → ActionBias conversion ──────────────────────────────────────
//
// Maps each personality archetype to a characteristic action bias.
// These are not exact probabilities — they define each archetype's
// "personality signature" which is then weighted at 0.20 in the blend.
//
// KEY DESIGN CHOICES
// ──────────────────
// 'selfish':    shoot:0.65 — extremely high; a selfish striker will shoot from
//               anywhere, producing both spectacular goals and wasted possession.
//               This is intentional: it's a character flaw, not a feature.
// 'lazy':       all values low (0.12–0.20); press:0.05 — lazy players barely
//               press at all, which reads as jogging instead of sprinting in
//               the 2D viewer and produces "walks past the ball" commentary.
// 'cautious':   pass:0.55, shoot:0.08 — the cautious player is the teammate
//               who always lays it back, infuriating fans, occasionally right.
// 'workhorse':  press:0.35, tackle:0.30 — not creative, but relentless; these
//               players cover the most ground and produce the most press events.

const PERSONALITY_BIAS: Record<Personality, ActionBias> = {
  selfish:     { shoot: 0.65, pass: 0.10, dribble: 0.15, tackle: 0.05, press: 0.05 },
  team_player: { shoot: 0.10, pass: 0.50, dribble: 0.15, tackle: 0.12, press: 0.13 },
  aggressive:  { shoot: 0.12, pass: 0.10, dribble: 0.13, tackle: 0.35, press: 0.30 },
  lazy:        { shoot: 0.20, pass: 0.45, dribble: 0.18, tackle: 0.12, press: 0.05 },
  workhorse:   { shoot: 0.10, pass: 0.20, dribble: 0.05, tackle: 0.30, press: 0.35 },
  creative:    { shoot: 0.15, pass: 0.30, dribble: 0.40, tackle: 0.05, press: 0.10 },
  cautious:    { shoot: 0.08, pass: 0.55, dribble: 0.12, tackle: 0.15, press: 0.10 },
};

/** Fallback for an unknown personality string — treated as balanced */
const DEFAULT_PERSONALITY_BIAS: ActionBias =
  { shoot: 0.20, pass: 0.28, dribble: 0.20, tackle: 0.18, press: 0.14 };

// ── Agent state → ActionBias modifier ────────────────────────────────────────
//
// Converts live agent state (confidence, fatigue, emotion) into an ActionBias
// delta.  These are DELTAS, not absolute biases — they are added to the raw
// agent-state layer before normalisation.
//
// CONFIDENCE THRESHOLDS
// ─────────────────────
// confidence > 70  (high): shoot +0.12, dribble +0.08 — player believes in
//   themselves, takes risks.  Matches engine's existing +8 atkMod at >75.
// confidence < 30  (low):  pass +0.15, shoot −0.10 — player sheds
//   responsibility, plays safe, avoids taking shots on.
// 30–70 (normal): no adjustment.
//
// FATIGUE THRESHOLDS
// ──────────────────
// fatigue > 80 (exhausted): press −0.20, dribble −0.10 — player can barely
//   run; pressing becomes impossible, close control suffers.
// fatigue > 65 (tired): press −0.10, tackle −0.05 — visibly slowing down.
// Below 65: no fatigue adjustment.
//
// EMOTION MAPPING
// ───────────────
// ecstatic  (scored recently):   shoot +0.15, dribble +0.10 — on a high, tries
//   more ambitious things.  Risk: can also lead to poor decisions.
// anxious/nervous (after card):  pass +0.12, shoot −0.08 — tentative,
//   avoids getting caught in possession.
// devastated (red card team):    pass +0.10, press −0.15 — demoralised,
//   just wants to survive.

function agentStateToActionBias(agent: AgentState): ActionBias {
  let shoot   = 0.20; // neutral baseline before adjustments
  let pass    = 0.25;
  let dribble = 0.20;
  let tackle  = 0.18;
  let press   = 0.17;

  // ── Confidence adjustment ─────────────────────────────────────────────────
  if (agent.confidence > 70) {
    shoot   += 0.12; // high confidence → attempts riskier shots
    dribble += 0.08; // high confidence → tries to beat defenders
  } else if (agent.confidence < 30) {
    pass    += 0.15; // low confidence → offloads responsibility
    shoot   -= 0.10; // low confidence → avoids the accountability of a shot
  }

  // ── Fatigue adjustment ────────────────────────────────────────────────────
  if (agent.fatigue > 80) {
    press   -= 0.20; // exhausted: can't press at all (visibly jogging)
    dribble -= 0.10; // exhausted: close control deteriorates
    tackle  -= 0.05; // exhausted: slower into challenges
  } else if (agent.fatigue > 65) {
    press   -= 0.10; // tired: pressing effort drops noticeably
    tackle  -= 0.05; // tired: slightly late into challenges
  }

  // ── Emotion adjustment ────────────────────────────────────────────────────
  if (agent.emotion === 'ecstatic') {
    shoot   += 0.15; // just scored: wants to do it again immediately
    dribble += 0.10; // just scored: confidence in individual ability
  } else if (agent.emotion === 'anxious' || agent.emotion === 'nervous') {
    pass    += 0.12; // on a yellow: plays safe, offloads quickly
    shoot   -= 0.08; // on a yellow: avoids physical commitment and risk
  } else if (agent.emotion === 'devastated') {
    pass    += 0.10; // after team red card: survival mode
    press   -= 0.15; // after team red card: ten men save energy
  }

  // Clamp to 0.01 minimum — same rationale as zoneMapping.getPositionalInstructions
  return {
    shoot:   Math.max(0.01, shoot),
    pass:    Math.max(0.01, pass),
    dribble: Math.max(0.01, dribble),
    tackle:  Math.max(0.01, tackle),
    press:   Math.max(0.01, press),
  };
}

// ── Relationship → ActionBias modifier ───────────────────────────────────────
//
// Converts entity-graph relationships between this player and others on the
// pitch (teammates, opponents, manager) into an ActionBias delta.
//
// RELATIONSHIP KINDS AND THEIR MECHANICAL EFFECT
// ───────────────────────────────────────────────
// partnership / former_teammates:
//   pass +: player prefers to pass to known allies (pre-loaded by
//   matchRelationships.ts as ctx.partnerIds).
//
// rivalry / grudge:
//   tackle + press +: player hunts the rival; shoot − (distracted by enmity,
//   forgets to get in position).  A rivalry produces more fouls and cards,
//   which feeds the Architect's conflict narratives.
//
// mentor_pupil (this player is the pupil):
//   All biases moderate toward safe choices (pass+) — the pupil listens to
//   the mentor's implicit instruction of "don't do anything stupid."
//
// manager_favourite:
//   shoot + dribble +: favoured player plays with freedom and confidence.
//
// manager_distrust:
//   pass +, shoot −: player under pressure from the manager becomes tentative.
//
// shared_homeworld:
//   pass +: subtle cultural affinity — not mechanically significant alone but
//   compounds with partnership.

export interface RelationshipContext {
  /** Entity IDs of teammates this player has a positive relationship with. */
  partnerIds:   ReadonlySet<string>;
  /** Entity IDs of opponents this player has a rivalry/grudge with. */
  rivalIds:     ReadonlySet<string>;
  /** True if the manager has a 'manager_favourite' edge to this player. */
  isFavourite:  boolean;
  /** True if the manager has a 'manager_distrust' edge to this player. */
  isDisliked:   boolean;
  /**
   * True if this player has a 'mentor_pupil' edge where they are the pupil.
   * The mentor need not be on the pitch — the lesson carries into the match.
   */
  isPupil:      boolean;
}

/**
 * Build a RelationshipContext for a specific player from a pre-loaded list of
 * their entity-graph relationships.  Called once per player at match start.
 *
 * @param playerId     The player's entity_id.
 * @param managerId    The manager's entity_id (may be null if not in entity graph).
 * @param teamEntityIds Set of entity_ids for all teammates on the pitch.
 * @param opponentEntityIds Set of entity_ids for all opponents on the pitch.
 * @param relationships All edges touching this player, pre-loaded from the DB.
 * @returns            A RelationshipContext ready for blendDecision().
 */
export function buildRelationshipContext(
  playerId:          string,
  managerId:         string | null,
  teamEntityIds:     ReadonlySet<string>,
  opponentEntityIds: ReadonlySet<string>,
  relationships:     readonly EntityRelationship[],
): RelationshipContext {
  const partnerIds = new Set<string>();
  const rivalIds   = new Set<string>();
  let isFavourite  = false;
  let isDisliked   = false;
  let isPupil      = false;

  for (const rel of relationships) {
    // Identify the "other" endpoint of this edge relative to this player
    const otherId = rel.from_id === playerId ? rel.to_id : rel.from_id;

    // ── Partnership / affinity ────────────────────────────────────────────
    if (rel.kind === 'partnership' || rel.kind === 'former_teammates') {
      // Only counts if the other entity is on the same pitch (not a retired
      // player or an off-pitch entity in the graph)
      if (teamEntityIds.has(otherId) && rel.strength > 0) {
        partnerIds.add(otherId);
      }
    }

    // ── Rivalry / grudge ──────────────────────────────────────────────────
    if (rel.kind === 'rivalry' || rel.kind === 'grudge') {
      if (opponentEntityIds.has(otherId)) {
        rivalIds.add(otherId);
      }
    }

    // ── Manager relationship ──────────────────────────────────────────────
    if (managerId && otherId === managerId) {
      if (rel.kind === 'manager_favourite') isFavourite = true;
      if (rel.kind === 'manager_distrust')  isDisliked  = true;
    }

    // ── Mentor/pupil (this player is the pupil) ───────────────────────────
    // Direction: mentor → pupil (from_id = mentor, to_id = pupil)
    if (rel.kind === 'mentor_pupil' && rel.to_id === playerId) {
      isPupil = true;
    }
  }

  return { partnerIds, rivalIds, isFavourite, isDisliked, isPupil };
}

function relationshipToActionBias(rel: RelationshipContext): ActionBias {
  let shoot   = 0.20;
  let pass    = 0.25;
  let dribble = 0.20;
  let tackle  = 0.18;
  let press   = 0.17;

  // ── Partners on the pitch → prefer to pass ────────────────────────────────
  // Each partner adds a small nudge. Cap at 3 partners to avoid exponential
  // stacking on well-connected players — 3× the nudge is already significant.
  const partnerCount = Math.min(3, rel.partnerIds.size);
  pass    += partnerCount * 0.06; // up to +0.18 pass from partnerships
  dribble -= partnerCount * 0.02; // slightly less solo play with trusted allies

  // ── Rivals on the pitch → hunt them ──────────────────────────────────────
  // Each rival on the opposing team adds aggression. Cap at 2 rivals.
  const rivalCount = Math.min(2, rel.rivalIds.size);
  tackle  += rivalCount * 0.08; // up to +0.16 tackle from rivalries
  press   += rivalCount * 0.06; // up to +0.12 press (harrying the rival)
  shoot   -= rivalCount * 0.04; // −0.08 max: distracted by enmity

  // ── Manager relationship ──────────────────────────────────────────────────
  if (rel.isFavourite) {
    shoot   += 0.10; // manager's trust → plays with freedom
    dribble += 0.08; // express yourself
  }
  if (rel.isDisliked) {
    pass    += 0.12; // trying to look safe and sensible
    shoot   -= 0.08; // avoids risk-taking that could anger the manager
  }

  // ── Pupil effect ──────────────────────────────────────────────────────────
  if (rel.isPupil) {
    pass    += 0.08; // mentors teach discipline: "find the pass first"
    shoot   -= 0.04; // not quite ready to go alone every time
  }

  return {
    shoot:   Math.max(0.01, shoot),
    pass:    Math.max(0.01, pass),
    dribble: Math.max(0.01, dribble),
    tackle:  Math.max(0.01, tackle),
    press:   Math.max(0.01, press),
  };
}

// ── Normalise ─────────────────────────────────────────────────────────────────

/**
 * Normalise an ActionBias so all five weights sum to 1.0.
 * Preserves the relative proportions of each weight.
 * Returns DEFAULT_PERSONALITY_BIAS-like values if total is 0 (degenerate input).
 */
function normalise(bias: ActionBias): ActionBias {
  const total = bias.shoot + bias.pass + bias.dribble + bias.tackle + bias.press;
  if (total <= 0) {
    // Degenerate: no action is possible.  Return equal distribution.
    return { shoot: 0.20, pass: 0.20, dribble: 0.20, tackle: 0.20, press: 0.20 };
  }
  return {
    shoot:   bias.shoot   / total,
    pass:    bias.pass    / total,
    dribble: bias.dribble / total,
    tackle:  bias.tackle  / total,
    press:   bias.press   / total,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * The full set of inputs for a single blendDecision() call.
 * Callers (genEvent or its successor) build this object each minute from the
 * match state — positional instructions from zoneMapping, agent state from
 * aim.getAgentByName(), and relationship context from matchRelationships.ts.
 */
export interface BlendInput {
  /**
   * Positional instructions for this player this minute, computed by
   * zoneMapping.getPositionalInstructions().  Incorporates formation, manager
   * playstyle, manager stats, and match situation.
   */
  positional:    ActionBias;
  /**
   * The player's full stat block from the DB.  Only the fields listed in
   * PlayerStats are used; the caller may pass the full EnginePlayer object
   * and TypeScript will pick the matching fields.
   */
  stats:         PlayerStats;
  /**
   * Personality archetype assigned by createAgent().  Determines the most
   * extreme action tendencies (selfish FW shoots; creative MF dribbles).
   */
  personality:   Personality | string;
  /**
   * Live agent state at this minute.  Confidence, fatigue, and emotion shift
   * the bias in real time as the match progresses.
   */
  agentState:    AgentState;
  /**
   * Pre-computed relationship context for this player (from
   * buildRelationshipContext()).  Encodes partnerships, rivalries, and manager
   * relationships as a ready-to-use flags struct.
   */
  relationships: RelationshipContext;
  /**
   * Optional Architect modifiers — additive nudges applied after the main
   * blend, bounded to ±0.05 per action.  Omit or pass {} when no Architect
   * overlay is active.
   */
  architect?:    ArchitectDecisionModifiers;
}

/**
 * Blend all decision-influencing factors into a single normalised ActionBias.
 *
 * The bias is a probability distribution over the five action types (shoot,
 * pass, dribble, tackle, press).  Callers sample it via a weighted random
 * choice to decide which event type this player produces this minute.
 *
 * EXAMPLE
 * ───────
 * A selfish FW in an Offensive team, high confidence, no rivalries, and a
 * redemption arc active (architect nudge toward shoot) might produce:
 *   { shoot: 0.52, pass: 0.12, dribble: 0.18, tackle: 0.05, press: 0.08 } (approx)
 *
 * A cautious DF in a Defensive team, tired (fatigue 72), no special relations:
 *   { shoot: 0.04, pass: 0.48, dribble: 0.08, tackle: 0.25, press: 0.10 } (approx)
 *
 * @param input  All decision factors — see BlendInput for field descriptions.
 * @returns      Normalised ActionBias with all five weights summing to 1.0.
 */
export function blendDecision(input: BlendInput): ActionBias {
  const {
    positional, stats, personality, agentState, relationships, architect,
  } = input;

  // ── Compute each layer's raw ActionBias ───────────────────────────────────
  const statsBias   = statsToActionBias(stats);
  const persBias    = PERSONALITY_BIAS[personality as Personality]
                        ?? DEFAULT_PERSONALITY_BIAS;
  const agentBias   = agentStateToActionBias(agentState);
  const relBias     = relationshipToActionBias(relationships);

  // ── Weighted blend ────────────────────────────────────────────────────────
  // Each layer contributes its weight × its bias for each action type.
  // The weights sum to 1.0 so the result is already in a sensible range
  // before normalisation (it won't be exactly normalised because individual
  // layer biases don't sum to 1.0 themselves, but normalise() fixes that).
  const blended: ActionBias = {
    shoot: (
      positional.shoot  * WEIGHT_POSITIONAL  +
      statsBias.shoot   * WEIGHT_STATS       +
      persBias.shoot    * WEIGHT_PERSONALITY +
      agentBias.shoot   * WEIGHT_AGENT_STATE +
      relBias.shoot     * WEIGHT_RELATIONSHIPS
    ),
    pass: (
      positional.pass   * WEIGHT_POSITIONAL  +
      statsBias.pass    * WEIGHT_STATS       +
      persBias.pass     * WEIGHT_PERSONALITY +
      agentBias.pass    * WEIGHT_AGENT_STATE +
      relBias.pass      * WEIGHT_RELATIONSHIPS
    ),
    dribble: (
      positional.dribble * WEIGHT_POSITIONAL  +
      statsBias.dribble  * WEIGHT_STATS       +
      persBias.dribble   * WEIGHT_PERSONALITY +
      agentBias.dribble  * WEIGHT_AGENT_STATE +
      relBias.dribble    * WEIGHT_RELATIONSHIPS
    ),
    tackle: (
      positional.tackle  * WEIGHT_POSITIONAL  +
      statsBias.tackle   * WEIGHT_STATS       +
      persBias.tackle    * WEIGHT_PERSONALITY +
      agentBias.tackle   * WEIGHT_AGENT_STATE +
      relBias.tackle     * WEIGHT_RELATIONSHIPS
    ),
    press: (
      positional.press   * WEIGHT_POSITIONAL  +
      statsBias.press    * WEIGHT_STATS       +
      persBias.press     * WEIGHT_PERSONALITY +
      agentBias.press    * WEIGHT_AGENT_STATE +
      relBias.press      * WEIGHT_RELATIONSHIPS
    ),
  };

  // ── Architect additive nudge (post-blend) ─────────────────────────────────
  // Applied AFTER the weighted blend so the Architect adjusts the final
  // outcome without inflating one layer's raw contribution.
  // Bounded to ±0.05 per action so the Architect is a thumb on the scale,
  // not a hammer.
  //
  // ActionBias is a readonly type, so rather than mutate `blended` we build a
  // new object with the nudge folded in.  When no nudge is present we pass
  // `blended` straight through to normalise().
  if (architect?.nudge) {
    const n = architect.nudge;
    const CAP = 0.05; // maximum per-action Architect influence
    // clamp() bounds each nudge to ±CAP before adding it to the blended weight
    const clamp = (v: number | undefined): number => Math.max(-CAP, Math.min(CAP, v ?? 0));
    const nudged: ActionBias = {
      shoot:   blended.shoot   + clamp(n.shoot),
      pass:    blended.pass    + clamp(n.pass),
      dribble: blended.dribble + clamp(n.dribble),
      tackle:  blended.tackle  + clamp(n.tackle),
      press:   blended.press   + clamp(n.press),
    };
    return normalise(nudged);
  }

  // Normalise so all five weights sum to 1.0 — required for correct weighted
  // sampling by the caller.
  return normalise(blended);
}

/**
 * Sample one action type from a normalised ActionBias using a single
 * Math.random() draw (or an injected RNG for deterministic tests).
 *
 * WHY THIS LIVES HERE
 * ───────────────────
 * genEvent() currently uses a continuous roll + threshold comparison
 * (roll < 0.05 → foul, roll < 0.20 → shot, etc.).  The new pipeline produces
 * a discrete probability distribution — sampleAction() translates that into
 * the same kind of "which branch fires" answer, keeping genEvent()'s call
 * site simple: `const action = sampleAction(blendDecision(input), rng)`.
 *
 * @param bias  Normalised ActionBias (weights sum to ~1.0).
 * @param rng   Random source in [0, 1).  Defaults to Math.random().
 * @returns     One of: 'shoot' | 'pass' | 'dribble' | 'tackle' | 'press'.
 */
export function sampleAction(
  bias: ActionBias,
  rng: () => number = Math.random,
): 'shoot' | 'pass' | 'dribble' | 'tackle' | 'press' {
  // Walk the cumulative distribution — the first bucket whose cumulative
  // weight exceeds the draw is the selected action.
  const draw = rng();
  let cumulative = 0;

  // Ordered by descending typical probability so the most-likely actions
  // short-circuit first (minor optimisation in a hot loop).
  cumulative += bias.pass;    if (draw < cumulative) return 'pass';
  cumulative += bias.shoot;   if (draw < cumulative) return 'shoot';
  cumulative += bias.dribble; if (draw < cumulative) return 'dribble';
  cumulative += bias.tackle;  if (draw < cumulative) return 'tackle';
  // press is the catch-all — also handles any floating-point remainder
  return 'press';
}
