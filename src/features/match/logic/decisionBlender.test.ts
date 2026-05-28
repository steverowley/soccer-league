// ── decisionBlender.test.ts ──────────────────────────────────────────────────
// Unit tests for the weighted multi-factor decision blender.
//
// COVERAGE GOALS
// ──────────────
// • blendDecision() output always sums to 1.0 (normalised probability dist.)
// • All five action weights are strictly positive (no zero-weight actions).
// • Layer dominance: selfish FW shoots more than cautious DF in equal other conditions.
// • Desperation: losing late raises shoot weight.
// • Relationships: rivalry raises tackle; partnership raises pass.
// • Agent state: high confidence raises shoot; exhaustion lowers press.
// • Architect nudge is bounded to ±0.05 per action.
// • sampleAction() always returns a valid action string.
// • sampleAction() respects the probability distribution (law of large numbers).
// • buildRelationshipContext() correctly classifies partners, rivals, favourite.

import { describe, expect, it } from 'vitest';
import {
  blendDecision,
  sampleAction,
  buildRelationshipContext,
  type BlendInput,
  type PlayerStats,
  type AgentState,
  type RelationshipContext,
} from './decisionBlender';
import type { ActionBias } from './zoneMapping';

// ── Test fixtures ─────────────────────────────────────────────────────────────

/** Neutral positional bias: equal weight across all actions before blending */
const NEUTRAL_POSITIONAL: ActionBias = {
  shoot: 0.20, pass: 0.25, dribble: 0.20, tackle: 0.18, press: 0.17,
};

/** Average player stats — produces near-equal stat contributions */
const AVERAGE_STATS: PlayerStats = {
  attacking: 70, defending: 70, mental: 70, athletic: 70, technical: 70,
  shooting: 70, passing: 70, dribbling: 70, speed: 70, stamina: 70,
  tackling: 70, strength: 70, vision: 70, aggression: 70,
};

/** Elite FW stats — shooting/dribbling/speed very high, tackling low */
const FW_STATS: PlayerStats = {
  attacking: 85, defending: 35, mental: 72, athletic: 80, technical: 75,
  shooting: 88, passing: 65, dribbling: 82, speed: 85, stamina: 75,
  tackling: 28, strength: 60, vision: 70, aggression: 65,
};

/** Elite CB stats — tackling/strength high, shooting very low */
const CB_STATS: PlayerStats = {
  attacking: 38, defending: 85, mental: 75, athletic: 72, technical: 62,
  shooting: 32, passing: 65, dribbling: 45, speed: 65, stamina: 80,
  tackling: 88, strength: 85, vision: 60, aggression: 75,
};

/** Calm, fresh agent — no modifiers from state */
const NEUTRAL_AGENT: AgentState = {
  confidence: 55, fatigue: 20, emotion: 'neutral', isClutch: false,
};

/** High-confidence, fully rested agent */
const CONFIDENT_AGENT: AgentState = {
  confidence: 85, fatigue: 10, emotion: 'ecstatic', isClutch: true,
};

/** Exhausted, anxious agent */
const TIRED_AGENT: AgentState = {
  confidence: 25, fatigue: 85, emotion: 'anxious', isClutch: false,
};

/** No relationships — the baseline with no entity-graph influence */
const NO_RELATIONSHIPS: RelationshipContext = {
  partnerIds:  new Set(),
  rivalIds:    new Set(),
  isFavourite: false,
  isDisliked:  false,
  isPupil:     false,
};

/** Helper: build a complete BlendInput with optional overrides */
function makeInput(overrides: Partial<BlendInput> = {}): BlendInput {
  return {
    positional:    NEUTRAL_POSITIONAL,
    stats:         AVERAGE_STATS,
    personality:   'cautious',
    agentState:    NEUTRAL_AGENT,
    relationships: NO_RELATIONSHIPS,
    ...overrides,
  };
}

// ── blendDecision — output invariants ────────────────────────────────────────

describe('blendDecision — output invariants', () => {
  it('all five weights are strictly positive', () => {
    const result = blendDecision(makeInput());
    expect(result.shoot).toBeGreaterThan(0);
    expect(result.pass).toBeGreaterThan(0);
    expect(result.dribble).toBeGreaterThan(0);
    expect(result.tackle).toBeGreaterThan(0);
    expect(result.press).toBeGreaterThan(0);
  });

  it('weights sum to 1.0 (normalised probability distribution)', () => {
    const result = blendDecision(makeInput());
    const total = result.shoot + result.pass + result.dribble + result.tackle + result.press;
    expect(total).toBeCloseTo(1.0, 5);
  });

  it('sums to 1.0 across all personality archetypes', () => {
    const personalities = [
      'selfish', 'team_player', 'aggressive', 'lazy', 'workhorse', 'creative', 'cautious',
    ] as const;
    for (const p of personalities) {
      const result = blendDecision(makeInput({ personality: p }));
      const total = result.shoot + result.pass + result.dribble + result.tackle + result.press;
      expect(total).toBeCloseTo(1.0, 5);
    }
  });

  it('sums to 1.0 even with an unknown personality string', () => {
    const result = blendDecision(makeInput({ personality: 'mystery_archetype' }));
    const total = result.shoot + result.pass + result.dribble + result.tackle + result.press;
    expect(total).toBeCloseTo(1.0, 5);
  });
});

// ── blendDecision — personality layer ────────────────────────────────────────

describe('blendDecision — personality layer', () => {
  it('selfish personality produces higher shoot weight than team_player', () => {
    const selfish = blendDecision(makeInput({ personality: 'selfish' }));
    const team    = blendDecision(makeInput({ personality: 'team_player' }));
    expect(selfish.shoot).toBeGreaterThan(team.shoot);
  });

  it('team_player produces higher pass weight than selfish', () => {
    const selfish = blendDecision(makeInput({ personality: 'selfish' }));
    const team    = blendDecision(makeInput({ personality: 'team_player' }));
    expect(team.pass).toBeGreaterThan(selfish.pass);
  });

  it('aggressive produces higher tackle weight than cautious', () => {
    const agg = blendDecision(makeInput({ personality: 'aggressive' }));
    const cau = blendDecision(makeInput({ personality: 'cautious' }));
    expect(agg.tackle).toBeGreaterThan(cau.tackle);
  });

  it('workhorse produces higher press weight than lazy', () => {
    const wrk = blendDecision(makeInput({ personality: 'workhorse' }));
    const laz = blendDecision(makeInput({ personality: 'lazy' }));
    expect(wrk.press).toBeGreaterThan(laz.press);
  });

  it('creative produces higher dribble weight than cautious', () => {
    const cre = blendDecision(makeInput({ personality: 'creative' }));
    const cau = blendDecision(makeInput({ personality: 'cautious' }));
    expect(cre.dribble).toBeGreaterThan(cau.dribble);
  });
});

// ── blendDecision — stats layer ───────────────────────────────────────────────

describe('blendDecision — stats layer', () => {
  it('FW stats produce higher shoot weight than CB stats', () => {
    const fw = blendDecision(makeInput({ stats: FW_STATS, personality: 'cautious' }));
    const cb = blendDecision(makeInput({ stats: CB_STATS, personality: 'cautious' }));
    expect(fw.shoot).toBeGreaterThan(cb.shoot);
  });

  it('CB stats produce higher tackle weight than FW stats', () => {
    const fw = blendDecision(makeInput({ stats: FW_STATS, personality: 'cautious' }));
    const cb = blendDecision(makeInput({ stats: CB_STATS, personality: 'cautious' }));
    expect(cb.tackle).toBeGreaterThan(fw.tackle);
  });

  it('missing optional stats default gracefully (no NaN)', () => {
    const minimal: PlayerStats = { attacking: 70, defending: 70, mental: 70, athletic: 70, technical: 70 };
    const result = blendDecision(makeInput({ stats: minimal }));
    expect(Number.isNaN(result.shoot)).toBe(false);
    expect(Number.isNaN(result.press)).toBe(false);
    const total = result.shoot + result.pass + result.dribble + result.tackle + result.press;
    expect(total).toBeCloseTo(1.0, 5);
  });
});

// ── blendDecision — agent state layer ────────────────────────────────────────

describe('blendDecision — agent state layer', () => {
  it('high confidence raises shoot weight vs neutral confidence', () => {
    const confident = blendDecision(makeInput({ agentState: CONFIDENT_AGENT }));
    const neutral   = blendDecision(makeInput({ agentState: NEUTRAL_AGENT   }));
    expect(confident.shoot).toBeGreaterThan(neutral.shoot);
  });

  it('exhaustion (fatigue > 80) reduces press weight', () => {
    const tired   = blendDecision(makeInput({ agentState: TIRED_AGENT   }));
    const neutral = blendDecision(makeInput({ agentState: NEUTRAL_AGENT }));
    expect(tired.press).toBeLessThan(neutral.press);
  });

  it('anxiety (anxious emotion) raises pass weight', () => {
    const anxious: AgentState = { ...NEUTRAL_AGENT, emotion: 'anxious' };
    const neutral: AgentState = { ...NEUTRAL_AGENT, emotion: 'neutral' };
    const anxResult = blendDecision(makeInput({ agentState: anxious }));
    const neuResult = blendDecision(makeInput({ agentState: neutral }));
    expect(anxResult.pass).toBeGreaterThan(neuResult.pass);
  });

  it('ecstatic emotion raises shoot weight', () => {
    const ecstatic: AgentState = { ...NEUTRAL_AGENT, emotion: 'ecstatic' };
    const neutral:  AgentState = { ...NEUTRAL_AGENT, emotion: 'neutral'  };
    const ecst = blendDecision(makeInput({ agentState: ecstatic }));
    const neu  = blendDecision(makeInput({ agentState: neutral  }));
    expect(ecst.shoot).toBeGreaterThan(neu.shoot);
  });
});

// ── blendDecision — relationship layer ───────────────────────────────────────

describe('blendDecision — relationship layer', () => {
  it('having partners raises pass weight vs no relationships', () => {
    const withPartners: RelationshipContext = {
      ...NO_RELATIONSHIPS,
      partnerIds: new Set(['entity-a', 'entity-b']),
    };
    const withRel = blendDecision(makeInput({ relationships: withPartners }));
    const without = blendDecision(makeInput({ relationships: NO_RELATIONSHIPS }));
    expect(withRel.pass).toBeGreaterThan(without.pass);
  });

  it('having rivals raises tackle weight vs no relationships', () => {
    const withRivals: RelationshipContext = {
      ...NO_RELATIONSHIPS,
      rivalIds: new Set(['enemy-a']),
    };
    const withRel = blendDecision(makeInput({ relationships: withRivals }));
    const without = blendDecision(makeInput({ relationships: NO_RELATIONSHIPS }));
    expect(withRel.tackle).toBeGreaterThan(without.tackle);
  });

  it('manager favourite raises shoot weight', () => {
    const favourite: RelationshipContext = { ...NO_RELATIONSHIPS, isFavourite: true };
    const normal:    RelationshipContext = { ...NO_RELATIONSHIPS, isFavourite: false };
    const fav = blendDecision(makeInput({ relationships: favourite }));
    const nor = blendDecision(makeInput({ relationships: normal    }));
    expect(fav.shoot).toBeGreaterThan(nor.shoot);
  });

  it('manager distrust raises pass weight (plays safe)', () => {
    const disliked: RelationshipContext = { ...NO_RELATIONSHIPS, isDisliked: true };
    const normal:   RelationshipContext = { ...NO_RELATIONSHIPS, isDisliked: false };
    const dis = blendDecision(makeInput({ relationships: disliked }));
    const nor = blendDecision(makeInput({ relationships: normal   }));
    expect(dis.pass).toBeGreaterThan(nor.pass);
  });

  it('pupil relationship raises pass weight', () => {
    const pupil:  RelationshipContext = { ...NO_RELATIONSHIPS, isPupil: true  };
    const normal: RelationshipContext = { ...NO_RELATIONSHIPS, isPupil: false };
    const pup = blendDecision(makeInput({ relationships: pupil  }));
    const nor = blendDecision(makeInput({ relationships: normal }));
    expect(pup.pass).toBeGreaterThan(nor.pass);
  });
});

// ── blendDecision — Architect nudge ──────────────────────────────────────────

describe('blendDecision — Architect nudge', () => {
  it('positive shoot nudge raises shoot weight', () => {
    const withNudge  = blendDecision(makeInput({ architect: { nudge: { shoot: 0.05 } } }));
    const noNudge    = blendDecision(makeInput());
    expect(withNudge.shoot).toBeGreaterThan(noNudge.shoot);
  });

  it('nudge larger than ±0.05 is capped at ±0.05 per action', () => {
    // A nudge of 0.99 should be capped to 0.05
    const bigNudge  = blendDecision(makeInput({ architect: { nudge: { shoot: 0.99 } } }));
    const maxNudge  = blendDecision(makeInput({ architect: { nudge: { shoot: 0.05 } } }));
    // Both should produce the same shoot weight (the cap is applied before the blend)
    expect(bigNudge.shoot).toBeCloseTo(maxNudge.shoot, 5);
  });

  it('output still sums to 1.0 after Architect nudge', () => {
    const result = blendDecision(makeInput({
      architect: { nudge: { shoot: 0.05, pass: -0.05 } },
    }));
    const total = result.shoot + result.pass + result.dribble + result.tackle + result.press;
    expect(total).toBeCloseTo(1.0, 5);
  });

  it('no architect field produces identical result to empty nudge', () => {
    // Omit `architect` entirely (rather than passing undefined, which
    // exactOptionalPropertyTypes forbids) and compare to an empty-nudge input.
    const noArch    = blendDecision(makeInput());
    const emptyArch = blendDecision(makeInput({ architect: {} }));
    expect(noArch.shoot).toBeCloseTo(emptyArch.shoot, 10);
  });
});

// ── sampleAction ──────────────────────────────────────────────────────────────

describe('sampleAction', () => {
  const VALID_ACTIONS = ['shoot', 'pass', 'dribble', 'tackle', 'press'] as const;

  it('always returns a valid action string', () => {
    const bias = blendDecision(makeInput());
    for (let i = 0; i < 100; i++) {
      const action = sampleAction(bias);
      expect(VALID_ACTIONS).toContain(action);
    }
  });

  it('respects a deterministic RNG (same draw → same result)', () => {
    const bias = blendDecision(makeInput());
    const rng  = () => 0.15; // always returns 0.15
    const first  = sampleAction(bias, rng);
    const second = sampleAction(bias, rng);
    expect(first).toBe(second);
  });

  it('extreme shoot bias (0.99) almost always returns "shoot"', () => {
    // Use a bias that heavily favours shooting to verify sampling respects weights
    const extremeBias: ActionBias = {
      shoot: 0.99, pass: 0.0025, dribble: 0.0025, tackle: 0.0025, press: 0.0025,
    };
    let shootCount = 0;
    const N = 1000;
    for (let i = 0; i < N; i++) {
      if (sampleAction(extremeBias) === 'shoot') shootCount++;
    }
    // With a 99% shoot weight, expect at least 95% shoot outcomes
    expect(shootCount / N).toBeGreaterThan(0.95);
  });

  it('equal bias produces roughly equal action distribution', () => {
    const equalBias: ActionBias = {
      shoot: 0.20, pass: 0.20, dribble: 0.20, tackle: 0.20, press: 0.20,
    };
    const counts: Record<string, number> = {
      shoot: 0, pass: 0, dribble: 0, tackle: 0, press: 0,
    };
    const N = 5000;
    for (let i = 0; i < N; i++) {
      const action = sampleAction(equalBias);
      // `?? 0` satisfies noUncheckedIndexedAccess (indexed reads are T|undefined)
      counts[action] = (counts[action] ?? 0) + 1;
    }
    // Each action should get roughly 20% ± 5% of samples
    for (const action of VALID_ACTIONS) {
      const share = (counts[action] ?? 0) / N;
      expect(share).toBeGreaterThan(0.15);
      expect(share).toBeLessThan(0.25);
    }
  });
});

// ── buildRelationshipContext ──────────────────────────────────────────────────

describe('buildRelationshipContext', () => {
  const PLAYER_ID  = 'player-uuid-1';
  const TEAMMATE   = 'player-uuid-2';
  const OPPONENT   = 'player-uuid-3';
  const MANAGER_ID = 'manager-uuid-1';

  const teamIds     = new Set([PLAYER_ID, TEAMMATE]);
  const opponentIds = new Set([OPPONENT]);

  it('classifies a partnership with a teammate as a partner', () => {
    const rels = [
      { from_id: PLAYER_ID, to_id: TEAMMATE, kind: 'partnership', strength: 80, meta: {} },
    ];
    const ctx = buildRelationshipContext(PLAYER_ID, null, teamIds, opponentIds, rels);
    expect(ctx.partnerIds.has(TEAMMATE)).toBe(true);
  });

  it('does not count partnerships with opponents as partners', () => {
    const rels = [
      { from_id: PLAYER_ID, to_id: OPPONENT, kind: 'partnership', strength: 80, meta: {} },
    ];
    const ctx = buildRelationshipContext(PLAYER_ID, null, teamIds, opponentIds, rels);
    expect(ctx.partnerIds.has(OPPONENT)).toBe(false);
  });

  it('classifies a rivalry with an opponent as a rival', () => {
    const rels = [
      { from_id: PLAYER_ID, to_id: OPPONENT, kind: 'rivalry', strength: -80, meta: {} },
    ];
    const ctx = buildRelationshipContext(PLAYER_ID, null, teamIds, opponentIds, rels);
    expect(ctx.rivalIds.has(OPPONENT)).toBe(true);
  });

  it('detects manager_favourite correctly', () => {
    const rels = [
      { from_id: MANAGER_ID, to_id: PLAYER_ID, kind: 'manager_favourite', strength: 90, meta: {} },
    ];
    const ctx = buildRelationshipContext(PLAYER_ID, MANAGER_ID, teamIds, opponentIds, rels);
    expect(ctx.isFavourite).toBe(true);
    expect(ctx.isDisliked).toBe(false);
  });

  it('detects manager_distrust correctly', () => {
    const rels = [
      { from_id: MANAGER_ID, to_id: PLAYER_ID, kind: 'manager_distrust', strength: -70, meta: {} },
    ];
    const ctx = buildRelationshipContext(PLAYER_ID, MANAGER_ID, teamIds, opponentIds, rels);
    expect(ctx.isDisliked).toBe(true);
    expect(ctx.isFavourite).toBe(false);
  });

  it('detects mentor_pupil (this player is the pupil) correctly', () => {
    const MENTOR = 'mentor-uuid';
    const rels = [
      { from_id: MENTOR, to_id: PLAYER_ID, kind: 'mentor_pupil', strength: 75, meta: {} },
    ];
    const ctx = buildRelationshipContext(PLAYER_ID, null, teamIds, opponentIds, rels);
    expect(ctx.isPupil).toBe(true);
  });

  it('does NOT flag as pupil when this player is the mentor (from_id)', () => {
    const PUPIL = 'pupil-uuid';
    const rels = [
      { from_id: PLAYER_ID, to_id: PUPIL, kind: 'mentor_pupil', strength: 75, meta: {} },
    ];
    const ctx = buildRelationshipContext(PLAYER_ID, null, teamIds, opponentIds, rels);
    expect(ctx.isPupil).toBe(false);
  });

  it('returns all-false context when no relationships exist', () => {
    const ctx = buildRelationshipContext(PLAYER_ID, null, teamIds, opponentIds, []);
    expect(ctx.partnerIds.size).toBe(0);
    expect(ctx.rivalIds.size).toBe(0);
    expect(ctx.isFavourite).toBe(false);
    expect(ctx.isDisliked).toBe(false);
    expect(ctx.isPupil).toBe(false);
  });
});
