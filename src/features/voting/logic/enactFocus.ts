// ── voting/logic/enactFocus.ts ───────────────────────────────────────────────
// WHY: Voting tallies have been wired since Phase 4, but the winning focus was
// never applied. This module is the engine that converts a vote result into
// concrete roster/stat/facility mutations — closing the social experience loop.
//
// DESIGN: Pure functions only — no Supabase, no React. Takes existing player
// rows + a seeded RNG function; returns a typed `FocusEnactmentSpec` describing
// mutations that the API layer (`enactment.ts`) will apply to the DB.
//
// DETERMINISM: The caller injects an `rng` function seeded from
// `${seasonId}:${teamId}:${focusKey}` so the same inputs always produce the
// same mutations. This makes the system reproducible for debugging and ensures
// test assertions are stable.
//
// ALL STATS CLAMPED to 1–99. Delta operations use `clampStat()` so a ±bump
// never produces an invalid value even if the source row is near the boundary.
//
// FOCUS KEYS:
//   Major: sign_star_player, youth_academy, tactical_overhaul, stadium_upgrade
//   Minor: preseason_camp, scout_network, fan_engagement, sports_science,
//          mental_coaching

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Minimal player row shape needed for enactment calculations.
 * Mirrors the `players` table columns consumed by the engine.
 * `overall_rating` is optional because it's rarely used in hot-path logic.
 */
export interface PlayerRow {
  id: string;
  team_id: string;
  name: string;
  position: 'GK' | 'DF' | 'MF' | 'FW';
  age: number | null;
  overall_rating: number | null;
  attacking: number;
  defending: number;
  mental: number;
  athletic: number;
  technical: number;
  starter: boolean;
}

/**
 * Partial player shape for INSERT mutations. `id` is omitted — the DB generates
 * it. All numeric stats are clamped to 1–99 by `enactFocus()` before returning.
 */
export interface NewPlayerData {
  team_id: string;
  name: string;
  position: 'GK' | 'DF' | 'MF' | 'FW';
  age: number;
  overall_rating: number;
  attacking: number;
  defending: number;
  mental: number;
  athletic: number;
  technical: number;
  starter: boolean;
  jersey_number: number;
}

/**
 * Discriminated union of every mutation type the enactment engine can produce.
 * The API layer (`enactment.ts`) switches on `kind` to apply each one to the DB.
 */
export type EnactmentMutation =
  | {
      kind: 'player_stat_bump';
      /** UUID of the player to update. */
      player_id: string;
      /** Which stat column to adjust. */
      stat: 'attacking' | 'defending' | 'mental' | 'athletic' | 'technical';
      /** Signed integer delta. Clamped before storage to keep values in 1–99. */
      delta: number;
    }
  | {
      kind: 'promote_player';
      /** UUID of the bench player to promote to starter. */
      player_id: string;
      /** Stat bumps to apply alongside the promotion. */
      stat_bumps: Partial<
        Record<'attacking' | 'defending' | 'mental' | 'athletic' | 'technical', number>
      >;
    }
  | {
      kind: 'insert_player';
      /** Full data for the new player row (id assigned by DB). */
      player: NewPlayerData;
    }
  | {
      kind: 'team_finances_delta';
      team_id: string;
      season_id: string;
      /**
       * Positive integers only. Applied as cumulative increments to the
       * team_finances row for the season — never overwrites the whole row.
       */
      ticket_revenue_delta: number;
      balance_delta: number;
    };

/**
 * The fully-resolved enactment for one focus win.
 *
 * `reason` is a non-empty human/Architect-readable explanation for the
 * `architect_interventions` audit row.  It MUST NOT expose raw stat numbers
 * to users (the interventions table IS readable by the dev log, but `reason`
 * becomes lore text — stay in-universe).
 *
 * `mutations` may be empty if the focus type has no applicable players
 * (e.g. `youth_academy` when a team has zero bench players aged ≤21).  The
 * caller still writes the `focus_enacted` row in that case; the focus was
 * voted for, even if the cosmos found nothing to change.
 */
export interface FocusEnactmentSpec {
  focus_key: string;
  focus_label: string;
  reason: string;
  mutations: EnactmentMutation[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Clamp a stat value to the valid 1–99 range.
 * Applied to every stat produced by enactment so the DB CHECK constraint is
 * never violated — even if a team's bench players have edge-case values.
 */
function clampStat(value: number): number {
  return Math.max(1, Math.min(99, Math.round(value)));
}

/**
 * Compute the mean of a stat across a list of players.
 * Returns 50 (the neutral midpoint) when the list is empty.
 *
 * @param players  Player rows to average over.
 * @param stat     Which stat column to average.
 */
function meanStat(
  players: PlayerRow[],
  stat: 'attacking' | 'defending' | 'mental' | 'athletic' | 'technical',
): number {
  if (players.length === 0) return 50;
  return players.reduce((sum, p) => sum + p[stat], 0) / players.length;
}

/**
 * Build a seeded LCG (Linear Congruential Generator) from a string seed.
 * The same seed always produces the same sequence — used so enactment
 * mutations are deterministic given the same (seasonId, teamId, focusKey).
 *
 * @param seed  Arbitrary string — typically `${seasonId}:${teamId}:${focusKey}`.
 * @returns     A `() => number` function returning values in [0, 1).
 */
export function seededRng(seed: string): () => number {
  // Simple djb2 hash to turn the string into a numeric seed.
  let h = 5381;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) + h + seed.charCodeAt(i)) & 0x7fffffff;
  }
  let s = h;
  // LCG parameters from Numerical Recipes.
  return () => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/**
 * Generate a new player name from a fixed pool of cosmic-themed first/last
 * name fragments seeded by the RNG.  Names are intentionally alien-sounding
 * without being offensive — consistent with the ISL's space-colony aesthetic.
 *
 * @param rng  Seeded RNG function.
 * @returns    A first-last name string.
 */
function generatePlayerName(rng: () => number): string {
  const firsts = [
    'Kael', 'Vex', 'Oryn', 'Zyx', 'Thal', 'Nyx', 'Drav', 'Sova',
    'Elyx', 'Cron', 'Vaal', 'Hyth', 'Quor', 'Meld', 'Bryn', 'Flux',
  ];
  const lasts = [
    'Vorn', 'Solan', 'Drex', 'Quill', 'Talus', 'Maren', 'Eryx', 'Crux',
    'Helm', 'Volsin', 'Pyrex', 'Thorn', 'Axen', 'Lore', 'Synth', 'Obel',
  ];
  const first = firsts[Math.floor(rng() * firsts.length)] ?? 'Kael';
  const last  = lasts [Math.floor(rng() * lasts.length)]  ?? 'Vorn';
  return `${first} ${last}`;
}

/**
 * Pick a position for the new signing, weighted toward filling the team's
 * weakest position slot.  GK is intentionally under-weighted — teams usually
 * have one competent keeper and want fielders.
 *
 * @param starters  Current starting XI.
 * @param rng       Seeded RNG.
 */
function pickSigningPosition(
  starters: PlayerRow[],
  rng: () => number,
): 'GK' | 'DF' | 'MF' | 'FW' {
  const positions: Array<'GK' | 'DF' | 'MF' | 'FW'> = ['GK', 'DF', 'MF', 'FW'];
  // Count starters per position; prefer positions with fewer starters.
  const counts = Object.fromEntries(positions.map((p) => [p, 0]));
  for (const pl of starters) counts[pl.position] = (counts[pl.position] ?? 0) + 1;
  // GK rarely needs another; cap its effective shortage at 1.
  const shortage = positions.map((p) => ({
    pos: p,
    gap: p === 'GK' ? Math.min(1, Math.max(0, 1 - (counts[p] ?? 0))) : Math.max(0, 4 - (counts[p] ?? 0)),
  }));
  const totalGap = shortage.reduce((s, x) => s + x.gap, 0);
  if (totalGap === 0) {
    // All positions filled — random pick excluding GK.
    const nonGk: Array<'GK' | 'DF' | 'MF' | 'FW'> = ['DF', 'MF', 'FW'];
    return nonGk[Math.floor(rng() * nonGk.length)] ?? 'FW';
  }
  // Weighted random: probability proportional to shortage.
  let roll = rng() * totalGap;
  for (const { pos, gap } of shortage) {
    roll -= gap;
    if (roll <= 0) return pos;
  }
  return 'FW';
}

// ── Variant selection (#375) ────────────────────────────────────────────────
// Each focus that supports variants composes 2-N `FocusVariant`s. The
// seeded RNG picks one at enactment time, so identical (team_id, season_id,
// focus_key) inputs always yield the same variant — reproducibility matters
// for tests AND for not surprising fans on enactment day.
//
// Weights are arbitrary positive numbers (need not sum to 100). The picker
// rolls in [0, totalWeight) and walks the list; the last variant is a
// guard against floating-point edge cases.

/**
 * A single named outcome for a focus that supports variants.
 *
 * `weight` controls relative frequency vs sibling variants. Variants with
 * downsides should usually carry slightly higher weights so the cosmos
 * doesn't always reward fans — predictably positive enactments would
 * weaken the "what the star was made of" tension the audit asked for.
 *
 * `apply()` is a closure that captures the focus's inputs and returns
 * the full FocusEnactmentSpec. Variants that share most logic can share
 * a private builder; variants that diverge structurally (different
 * mutation kinds entirely) should build their own.
 */
interface FocusVariant {
  /** Stable string id for logging/analytics — not user-visible. */
  key:    string;
  /** Relative pick weight. Variants with weight 0 are skipped entirely. */
  weight: number;
  /** Build the full focus spec. Called at most once per enactment. */
  apply:  () => FocusEnactmentSpec;
}

/**
 * Select a variant from the list using the seeded RNG.
 *
 * Walks the cumulative weight; the last variant catches floating-point
 * rounding so a weight roll exactly at `totalWeight` never falls through
 * to return undefined.
 *
 * @param variants  Non-empty list of weighted variants.
 * @param rng       Seeded RNG (typically the focus's enactment RNG).
 * @returns         One variant. Picks the last if weights are all zero.
 */
function pickVariant(variants: FocusVariant[], rng: () => number): FocusVariant {
  const total = variants.reduce((sum, v) => sum + v.weight, 0);
  if (total <= 0) return variants[variants.length - 1]!;
  let roll = rng() * total;
  for (const v of variants) {
    roll -= v.weight;
    if (roll <= 0) return v;
  }
  return variants[variants.length - 1]!;
}

// ── Focus handlers ────────────────────────────────────────────────────────────

/**
 * Append a new star-quality signing to the squad.
 * Stats are seeded from the RNG and scaled slightly above team average —
 * a signing should improve the team, not just fill numbers.
 *
 * VARIANTS (#375):
 *   - classic           — prime-age all-rounder, slight boost across all stats
 *                          (original pre-#375 behaviour, kept as a baseline)
 *   - prodigy           — 18-21 years old, high athletic + technical, lower
 *                          mental; volatile potential
 *   - veteran           — 29-34 years old, high mental + technical, lower
 *                          athletic; reliable on paper, ages fast
 *   - architect_touched — average age, anomalously balanced bump across all
 *                          five stats; rare; the cosmos didn't just deliver
 *                          a player, it delivered something
 *
 * Generates stats 8–14 points above team average (classic + variants),
 * clamped at 99. Jersey number: next available above the current highest.
 */
function enactSignStarPlayer(
  teamId: string,
  players: PlayerRow[],
  rng: () => number,
): FocusEnactmentSpec {
  const starters  = players.filter((p) => p.starter);
  const avgAtk    = meanStat(starters, 'attacking');
  const avgDef    = meanStat(starters, 'defending');
  const avgMen    = meanStat(starters, 'mental');
  const avgAtl    = meanStat(starters, 'athletic');
  const avgTech   = meanStat(starters, 'technical');
  const teamAvg   = (avgAtk + avgDef + avgMen + avgAtl + avgTech) / 5;

  const position = pickSigningPosition(starters, rng);
  const nextJersey = Math.max(...players.map((p) => (p as unknown as { jersey_number?: number }).jersey_number ?? 0), 0) + 1;

  /**
   * Build the per-variant new-player row + reason string. Each variant
   * picks an age range, an attribute bias, and a reason that frames the
   * arrival narratively. Shared scaffolding (position, jersey, team_id)
   * is identical across variants.
   *
   * @param ageMin       Lower bound (inclusive) for the player's starting age.
   * @param ageMax       Upper bound (inclusive) for the player's starting age.
   * @param boostFn      How big the per-stat boost is. Variants tune this.
   * @param posBoostFn   Returns the position-specific stat shape; identical
   *                     across variants but allows future variants to skew.
   * @returns            (newPlayer, reason) tuple.
   */
  const buildSigning = (
    ageMin: number,
    ageMax: number,
    boostFn: () => number,
    posBoostFn: () => Partial<Record<'attacking' | 'defending' | 'mental' | 'athletic' | 'technical', number>>,
    reason: string,
  ): FocusEnactmentSpec => {
    const pb = posBoostFn();
    const newPlayer: NewPlayerData = {
      team_id:       teamId,
      name:          generatePlayerName(rng),
      position,
      age:           Math.round(ageMin + rng() * (ageMax - ageMin)),
      overall_rating: clampStat(Math.round(teamAvg) + Math.round(boostFn())),
      attacking:     clampStat(avgAtk  + (pb.attacking  ?? 0)),
      defending:     clampStat(avgDef  + (pb.defending  ?? 0)),
      mental:        clampStat(avgMen  + (pb.mental     ?? 0)),
      athletic:      clampStat(avgAtl  + (pb.athletic   ?? 0)),
      technical:     clampStat(avgTech + (pb.technical  ?? 0)),
      starter:       true,
      jersey_number: nextJersey,
    };
    return {
      focus_key:   'sign_star_player',
      focus_label: 'Sign a Star Player',
      reason,
      mutations:   [{ kind: 'insert_player', player: newPlayer }],
    };
  };

  /** Per-position stat shape used by the classic + veteran variants. */
  const standardPosBoost = (boost: () => number): Partial<Record<'attacking' | 'defending' | 'mental' | 'athletic' | 'technical', number>> => {
    const tableFor: Record<string, Partial<Record<'attacking' | 'defending' | 'mental' | 'athletic' | 'technical', number>>> = {
      FW: { attacking: boost() + 4, defending: -4, mental: boost(), athletic: boost(), technical: boost() },
      DF: { attacking: -4, defending: boost() + 4, mental: boost(), athletic: boost(), technical: boost() },
      MF: { attacking: boost(), defending: boost(), mental: boost() + 2, athletic: boost(), technical: boost() + 2 },
      GK: { attacking: -30, defending: boost() + 10, mental: boost(), athletic: boost(), technical: boost() },
    };
    return tableFor[position] ?? {};
  };

  // Variant pool (#375). Weights chosen so the cosmos doesn't lean too hard
  // on either extreme: classic is the everyday case, prodigy + veteran share
  // the middle, architect_touched is rare so its appearance carries weight.
  const variants: FocusVariant[] = [
    {
      key:    'classic',
      weight: 35,
      apply:  () => buildSigning(
        22, 28,
        () => 8 + rng() * 6,
        () => standardPosBoost(() => Math.round(8 + rng() * 6)),
        `A new signing arrives — destiny carries them to the squad. The cosmos prepared this arrival long before the vote was cast.`,
      ),
    },
    {
      key:    'prodigy',
      weight: 25,
      apply:  () => buildSigning(
        18, 21,
        () => 5 + rng() * 4, // overall slightly lower than classic — they grow into it
        () => {
          // Prodigies skew athletic + technical, lag on mental until they age.
          const lift = Math.round(10 + rng() * 4);
          const dip  = Math.round(-2 - rng() * 3);
          const tab: Record<string, Partial<Record<'attacking' | 'defending' | 'mental' | 'athletic' | 'technical', number>>> = {
            FW: { attacking: lift + 2, defending: -6, mental: dip, athletic: lift + 4, technical: lift },
            DF: { attacking: -6, defending: lift, mental: dip, athletic: lift + 4, technical: lift },
            MF: { attacking: lift, defending: 0, mental: dip, athletic: lift + 2, technical: lift + 2 },
            GK: { attacking: -30, defending: lift + 6, mental: dip, athletic: lift + 4, technical: lift },
          };
          return tab[position] ?? {};
        },
        `A child barely past their stellar baptism arrives in the kit. The cosmos warns: this one is fast, this one is sharp, and this one does not yet know who they are.`,
      ),
    },
    {
      key:    'veteran',
      weight: 25,
      apply:  () => buildSigning(
        29, 34,
        () => 9 + rng() * 5, // a touch higher than classic on day one
        () => {
          // Veterans skew mental + technical, lag athletic.
          const lift = Math.round(10 + rng() * 4);
          const dip  = Math.round(-3 - rng() * 3);
          const tab: Record<string, Partial<Record<'attacking' | 'defending' | 'mental' | 'athletic' | 'technical', number>>> = {
            FW: { attacking: lift + 2, defending: -4, mental: lift + 2, athletic: dip, technical: lift + 2 },
            DF: { attacking: -4, defending: lift + 4, mental: lift + 2, athletic: dip, technical: lift },
            MF: { attacking: lift, defending: lift, mental: lift + 4, athletic: dip, technical: lift + 4 },
            GK: { attacking: -30, defending: lift + 8, mental: lift + 4, athletic: dip, technical: lift + 2 },
          };
          return tab[position] ?? {};
        },
        `A veteran answers a call they had stopped listening for. They are slower than they were. They know things the rest of the squad does not.`,
      ),
    },
    {
      key:    'architect_touched',
      weight: 15,
      apply:  () => buildSigning(
        24, 29,
        () => 9 + rng() * 4,
        () => {
          // Architect-touched: anomalously balanced — every stat lifts the
          // same amount, no position lean. The cosmos handed them a player
          // shaped like a thumb on a scale.
          const uniform = Math.round(8 + rng() * 4);
          return {
            attacking:  uniform,
            defending:  uniform,
            mental:     uniform,
            athletic:   uniform,
            technical:  uniform,
          };
        },
        `Something arrives that wasn't there before. They wear the kit as if it had always been theirs. Their stats are too even. Nobody asks where they came from.`,
      ),
    },
  ];

  return pickVariant(variants, rng).apply();
}

/**
 * Promote the youngest bench player (aged ≤21) to starter, with a modest
 * +3 bump to their two primary stats. If no bench players aged ≤21 exist,
 * falls back to the highest-rated bench player of any age.
 *
 * The plan specifies "lift a 16–18yo bench player" but the template says
 * "youth_academy" so we interpret broadly as ≤21 (youth/reserve age).
 */
/**
 * Promote a bench player into the starting XI with a small stat bump.
 *
 * VARIANTS (#424):
 *   - rapid_ascent     — youngest ≤21 bench player gets the +2/+4 bump
 *                         on their position's primary stats (the
 *                         original pre-#424 behaviour, kept as the
 *                         "academy works" baseline).
 *   - dormant_promise  — same youngest target but smaller (+1/+2)
 *                         bumps. Reason text hints at patience: the
 *                         cosmos isn't done with this one yet.
 *   - wrong_one        — picks the OLDEST bench player instead. The
 *                         academy was meant for the young; the cosmos
 *                         elevated a veteran instead. When no
 *                         non-youth bench player exists, falls back to
 *                         the youth pool (so the variant still produces
 *                         a promotion rather than fizzling).
 *
 * Weights lean rapid_ascent (50) because that's the on-tin behaviour
 * fans expect; dormant_promise (30) is the cosmos saying "not yet";
 * wrong_one (20) is the rarer twist. Same focus_key + label for all
 * variants — only the chosen target and bump magnitude vary.
 */
function enactYouthAcademy(
  players: PlayerRow[],
  rng: () => number,
): FocusEnactmentSpec {
  const bench = players.filter((p) => !p.starter);
  if (bench.length === 0) {
    return {
      focus_key:  'youth_academy',
      focus_label: 'Invest in Youth Academy',
      reason: `The youth academy searched the stars for its champions. This season, none were yet ready to step forward — but the seeds are planted.`,
      mutations: [],
    };
  }

  // ── Per-position primary stats to bump ──
  // Mirrors the per-position bias logic in sign_star_player: forwards
  // bump attacking + athletic, defenders bump defending + mental, etc.
  // Two stats per position is the long-standing cadence — wider would
  // dilute the "academy lift" feel; narrower would be invisible at the
  // running average level.
  const posBumps: Record<string, Array<'attacking' | 'defending' | 'mental' | 'athletic' | 'technical'>> = {
    FW: ['attacking', 'athletic'],
    DF: ['defending', 'mental'],
    MF: ['technical', 'mental'],
    GK: ['defending', 'mental'],
  };

  // Sort youngest-first (with overall_rating DESC as tiebreaker so the
  // best of equal-aged kids gets the lift). Used by rapid_ascent +
  // dormant_promise — both target the prodigy at the bottom of the squad.
  const youth = bench.filter((p) => p.age !== null && p.age <= 21);
  const youthPool = youth.length > 0 ? youth : bench;
  const sortedYoungest = [...youthPool].sort((a, b) => {
    const ageDiff = (a.age ?? 99) - (b.age ?? 99);
    if (ageDiff !== 0) return ageDiff;
    return (b.overall_rating ?? 50) - (a.overall_rating ?? 50);
  });

  // Sort oldest-first for wrong_one. Prefers the older end of the
  // bench (the "veteran finally given their chance" framing); falls
  // back to the youth pool when every bench player is ≤21 so the
  // variant still produces a promotion.
  const nonYouth = bench.filter((p) => p.age === null || p.age > 21);
  const wrongPool = nonYouth.length > 0 ? nonYouth : bench;
  const sortedOldest = [...wrongPool].sort((a, b) => {
    const ageDiff = (b.age ?? 0) - (a.age ?? 0);
    if (ageDiff !== 0) return ageDiff;
    return (b.overall_rating ?? 50) - (a.overall_rating ?? 50);
  });

  /**
   * Shared spec builder — every variant ends up calling this with a
   * chosen player, a bump magnitude, and a variant-specific reason.
   *
   * @param chosen  The bench player being promoted.
   * @param bump    Magnitude added to each of the position's two
   *                primary stats (variants pass 1–4 here).
   * @param reason  Variant-specific in-world explanation.
   */
  const buildPromotion = (
    chosen: PlayerRow,
    bump:   number,
    reason: string,
  ): FocusEnactmentSpec => {
    const statsToBoost = posBumps[chosen.position] ?? ['mental', 'athletic'];
    const stat_bumps: Partial<Record<'attacking' | 'defending' | 'mental' | 'athletic' | 'technical', number>> = {};
    for (const s of statsToBoost) (stat_bumps as Record<string, number>)[s] = bump;
    return {
      focus_key:   'youth_academy',
      focus_label: 'Invest in Youth Academy',
      reason,
      mutations:   [{ kind: 'promote_player', player_id: chosen.id, stat_bumps }],
    };
  };

  // Variant pool (#424). rapid_ascent is the "on-tin" outcome that
  // most fans expect; dormant_promise is a quieter beat with a
  // narrative hint; wrong_one is the cosmos contradicting itself.
  const variants: FocusVariant[] = [
    {
      key:    'rapid_ascent',
      weight: 50,
      apply:  () => {
        const chosen = sortedYoungest[0]!;
        // 2–4 bump: the established "academy works" magnitude.
        const bump = Math.round(2 + rng() * 2);
        return buildPromotion(
          chosen,
          bump,
          `The youth steps into the light. ${chosen.name} — long watched, long waiting — claims a place in the starting eleven. The Architect notes: this one was always meant to emerge now.`,
        );
      },
    },
    {
      key:    'dormant_promise',
      weight: 30,
      apply:  () => {
        const chosen = sortedYoungest[0]!;
        // 1–2 bump: deliberately smaller than rapid_ascent so the
        // variant FEELS like a partial step rather than a full lift.
        const bump = Math.round(1 + rng());
        return buildPromotion(
          chosen,
          bump,
          `${chosen.name} steps forward, but the threads twist slowly. The academy whispers: be patient. The cosmos is not finished with this one.`,
        );
      },
    },
    {
      key:    'wrong_one',
      weight: 20,
      apply:  () => {
        const chosen = sortedOldest[0]!;
        // Same 2–4 magnitude as rapid_ascent — the cosmos delivers a
        // full lift, just to the unexpected target. The twist is the
        // identity, not the size of the gift.
        const bump = Math.round(2 + rng() * 2);
        return buildPromotion(
          chosen,
          bump,
          `The academy was meant for the young. But the cosmos plucked ${chosen.name} from the shadows instead — a veteran finally given their chance. The Architect insists this was always the plan.`,
        );
      },
    },
  ];

  return pickVariant(variants, rng).apply();
}

/**
 * Tactical overhaul: the coaching staff is reorganised around a new
 * philosophy. Always lifts ONE stat by +4 across all starters; the
 * variant chooses which stat — mental (disciplined), athletic (frenzied),
 * or technical (cerebral).
 *
 * VARIANTS (#375):
 *   - disciplined  (mental +4)    — the historical default; sharper
 *                                    decision-making, composure under pressure.
 *   - frenzied     (athletic +4)  — pressing pace, intense ball-side
 *                                    coverage. Same +4 magnitude but
 *                                    a different match feel.
 *   - cerebral     (technical +4) — possession-based reset; ball
 *                                    retention prized over verticality.
 */
function enactTacticalOverhaul(
  players: PlayerRow[],
  rng: () => number,
): FocusEnactmentSpec {
  const starters = players.filter((p) => p.starter);

  /**
   * Build the spec for a given target stat + reason. Identical across
   * variants except which stat column is bumped.
   *
   * @param stat   One of mental / athletic / technical.
   * @param reason Variant-specific in-world explanation.
   */
  const buildOverhaul = (
    stat: 'mental' | 'athletic' | 'technical',
    reason: string,
  ): FocusEnactmentSpec => {
    const mutations: EnactmentMutation[] = starters.map((p) => ({
      kind:      'player_stat_bump',
      player_id: p.id,
      stat,
      delta:     4,
    }));
    return {
      focus_key:   'tactical_overhaul',
      focus_label: 'Tactical Overhaul',
      reason,
      mutations,
    };
  };

  // Weights equal across the three philosophies — no a-priori reason
  // the cosmos should prefer one tactical style over another. If
  // analytics later show fans rebel against `frenzied`, drop its
  // weight; the variant key is stable.
  const variants: FocusVariant[] = [
    {
      key:    'disciplined',
      weight: 33,
      apply:  () => buildOverhaul(
        'mental',
        `The old patterns are dissolved. The squad emerges from the tactical purge with sharper minds, though the transition unsettles their rest.`,
      ),
    },
    {
      key:    'frenzied',
      weight: 33,
      apply:  () => buildOverhaul(
        'athletic',
        `The new philosophy is pace and pressure. Lungs burn in training; ball-side coverage tightens. The squad runs harder than it has ever run.`,
      ),
    },
    {
      key:    'cerebral',
      weight: 33,
      apply:  () => buildOverhaul(
        'technical',
        `The coaching staff insists on the ball. Touches per possession climb in training. The squad emerges patient — almost slow — but their feet have grown careful.`,
      ),
    },
  ];

  return pickVariant(variants, rng).apply();
}

/**
 * Stadium upgrade: improved facilities yield higher gate revenue.
 * Adds a revenue delta to team_finances for this season; some variants
 * also bump starter mental on the back of the cosmic event.
 *
 * VARIANTS (#424):
 *   - gleaming_new       — Higher revenue (+7500). The cosmos delivers
 *                          everything fans hoped for: bright steel,
 *                          turnstiles spinning, gates singing.
 *   - haunted_renovation — Lower revenue (+2500) + ominous reason.
 *                          The renovation woke something. Fans came,
 *                          but fewer than the planners expected.
 *   - record_crowd       — Median revenue (+5000) + mental +1 across
 *                          every starter. The cosmic crowd surge
 *                          reaches the squad — confidence builds with
 *                          witnesses.
 *
 * Weights lean gleaming_new (45) because the pure facility upgrade is
 * the on-tin outcome; haunted_renovation (25) is the cosmos punishing
 * hubris; record_crowd (30) is the rare "extra boon" outcome.
 *
 * REVENUE FIGURES
 *   In the absence of a `home_ground.capacity` column in this schema,
 *   the financial proxy (ticket revenue delta) is used.  The 7.5k /
 *   5k / 2.5k spread keeps the median variant at the pre-#424 +5000
 *   so the season-aggregate impact of stadium_upgrade only shifts
 *   slightly as the variants mix.
 */
function enactStadiumUpgrade(
  teamId:   string,
  seasonId: string,
  players:  PlayerRow[],
  rng:      () => number,
): FocusEnactmentSpec {
  /**
   * Build the spec for a given (revenue, reason, optional mental bump
   * count).  Every variant emits the team_finances_delta first; record_crowd
   * additionally appends per-starter player_stat_bump mutations.
   *
   * @param revenue   Positive integer delta added to both ticket_revenue
   *                  and balance.  Variant tunables.
   * @param reason    Variant-specific in-world explanation.
   * @param mentalBump Optional +N applied to mental across every
   *                  starter.  Pass 0 (or omit) for variants that
   *                  don't touch player stats.
   */
  const build = (
    revenue:    number,
    reason:     string,
    mentalBump: number = 0,
  ): FocusEnactmentSpec => {
    const mutations: EnactmentMutation[] = [
      {
        kind:                 'team_finances_delta',
        team_id:              teamId,
        season_id:            seasonId,
        ticket_revenue_delta: revenue,
        balance_delta:        revenue,
      },
    ];
    if (mentalBump > 0) {
      for (const p of players) {
        if (!p.starter) continue;
        mutations.push({
          kind:      'player_stat_bump',
          player_id: p.id,
          stat:      'mental',
          delta:     mentalBump,
        });
      }
    }
    return {
      focus_key:   'stadium_upgrade',
      focus_label: 'Upgrade the Stadium',
      reason,
      mutations,
    };
  };

  // Variant pool (#424). Weights tuned per the design rationale above.
  const variants: FocusVariant[] = [
    {
      key:    'gleaming_new',
      weight: 45,
      apply:  () => build(
        7_500,
        `The stadium's walls push outward. Bright steel, turnstiles spinning, gates singing. More mortals than ever will witness the spectacle — and their presence will swell the coffers.`,
      ),
    },
    {
      key:    'haunted_renovation',
      weight: 25,
      apply:  () => build(
        2_500,
        `The renovation woke something. Fans still came — but fewer than the planners promised, and they spoke of cold drafts in the new concourse. The cosmos collects its tribute in silence.`,
      ),
    },
    {
      key:    'record_crowd',
      weight: 30,
      apply:  () => build(
        5_000,
        `The cosmic crowd surge reaches the pitch. The squad walks out beneath a wall of witnesses; confidence settles into the bones of every starter. Revenue rises — and so does the squad's composure.`,
        1, // +1 mental on every starter
      ),
    },
  ];

  return pickVariant(variants, rng).apply();
}

/**
 * Intensive preseason camp: the squad runs harder drills before the season
 * opens.
 *
 * VARIANTS (#424):
 *   - traditional — Athletic +2 across ALL players (the pre-#424 baseline).
 *                   The on-tin preseason: lungs burn, the whole squad
 *                   sharpens.
 *   - holistic    — Athletic +1 AND mental +1 across all players.
 *                   Conditioning is split with mindfulness work; the bump
 *                   reaches further but each stat moves less.
 *   - brutal      — Athletic +3 on starters ONLY.  The coaching staff
 *                   chose to push the first XI to the edge; the bench
 *                   spent the camp running cones.  Bigger lift, narrower
 *                   scope.
 *
 * Weights equal across the three philosophies — no a-priori reason the
 * cosmos should prefer one preseason style over another. If analytics
 * later show fans rebel against `brutal` (the only variant that excludes
 * the bench), drop its weight; the variant key is stable.
 */
function enactPreseasonCamp(
  players: PlayerRow[],
  rng:     () => number,
): FocusEnactmentSpec {
  /**
   * Per-variant spec builder.  Each variant decides:
   *   - a `targets` predicate (filter the players list — squad-wide or
   *     starters only),
   *   - one or more (stat, delta) pairs to apply per targeted player,
   *   - a variant-specific reason.
   *
   * @param targets  Filter predicate selecting which players to bump.
   * @param bumps    Array of (stat, delta) pairs applied per targeted
   *                 player.  Each pair becomes ONE mutation per player.
   * @param reason   Variant-specific in-world explanation.
   */
  const build = (
    targets: (p: PlayerRow) => boolean,
    bumps:   Array<{ stat: 'attacking' | 'defending' | 'mental' | 'athletic' | 'technical'; delta: number }>,
    reason:  string,
  ): FocusEnactmentSpec => {
    const mutations: EnactmentMutation[] = [];
    for (const p of players) {
      if (!targets(p)) continue;
      for (const b of bumps) {
        mutations.push({
          kind:      'player_stat_bump',
          player_id: p.id,
          stat:      b.stat,
          delta:     b.delta,
        });
      }
    }
    return {
      focus_key:   'preseason_camp',
      focus_label: 'Intensive Preseason Camp',
      reason,
      mutations,
    };
  };

  // Variant pool (#424).  Weights chosen equal — see prose above for the
  // tie-breaking rationale.
  const variants: FocusVariant[] = [
    {
      key:    'traditional',
      weight: 33,
      apply:  () => build(
        () => true,                // all players
        [{ stat: 'athletic', delta: 2 }],
        `The squad is driven to the edge of endurance before the first whistle blows. They emerge harder, faster — but the stars only watch to see if it was enough.`,
      ),
    },
    {
      key:    'holistic',
      weight: 33,
      apply:  () => build(
        () => true,                // all players
        [
          { stat: 'athletic', delta: 1 },
          { stat: 'mental',   delta: 1 },
        ],
        `The staff balance lungs with thought. Morning drills end with breathing work in the shade; the squad emerges quieter, surer, evenly tempered. The cosmos approves of the patience.`,
      ),
    },
    {
      key:    'brutal',
      weight: 34,
      apply:  () => build(
        (p) => p.starter,          // starters only
        [{ stat: 'athletic', delta: 3 }],
        `The bench ran cones. The first XI ran walls. The coaching staff chose their warriors, and the squad's reserves know it. The starters emerge sharper than the cosmos has seen them before — at a price.`,
      ),
    },
  ];

  return pickVariant(variants, rng).apply();
}

/**
 * Scout network: a hidden gem from the bench earns a pathway to first-team
 * action.  Variants differ on which bench archetype the scouts surface
 * AND on the stat bumps the promotion carries.
 *
 * VARIANTS (#424):
 *   - pure_skill    — Highest-rated bench player (the pre-#424 baseline).
 *                     Bumps: technical +2, mental +1.  The classic
 *                     "overlooked technician finally seen" story.
 *   - youth_find    — Youngest bench player (regardless of rating).
 *                     Bumps: athletic +2, technical +1.  The scouts
 *                     uncovered raw pace; the player can grow into
 *                     the rest.
 *   - veteran_steal — Oldest bench player.  Bumps: mental +3.  A wily
 *                     journeyman, undervalued for their age — the
 *                     squad inherits a vault of game knowledge.
 *
 * Weights tilt slightly toward pure_skill (40) because that's the
 * on-tin "scout network" narrative; youth_find (35) and veteran_steal
 * (25) cover the cosmos's preference for surprise.  If no bench
 * players exist, every variant collapses to the same empty-mutations
 * outcome (the scouts found nothing).
 */
function enactScoutNetwork(
  players: PlayerRow[],
  rng: () => number,
): FocusEnactmentSpec {
  const bench = players.filter((p) => !p.starter);
  if (bench.length === 0) {
    return {
      focus_key:   'scout_network',
      focus_label: 'Expand Scout Network',
      reason: `The scouts sent their reports. No hidden gems were found this cycle — but the network extends further into the dark.`,
      mutations: [],
    };
  }

  // ── Pre-sorted target lists ────────────────────────────────────────
  // Each variant picks its target from one of these lists.  Building
  // them up front keeps the variant `.apply()` bodies focused on the
  // bumps + reason text rather than re-sorting on every call.
  //
  //   sortedHighestRated — pure_skill picks index 0 (best-rated).
  //   sortedYoungest     — youth_find  picks index 0 (lowest age).
  //   sortedOldest       — veteran_steal picks index 0 (highest age).
  const sortedHighestRated = [...bench].sort((a, b) => {
    const diff = (b.overall_rating ?? 50) - (a.overall_rating ?? 50);
    if (diff !== 0) return diff;
    return rng() - 0.5;
  });
  const sortedYoungest = [...bench].sort((a, b) => {
    const diff = (a.age ?? 99) - (b.age ?? 99);
    if (diff !== 0) return diff;
    return (b.overall_rating ?? 50) - (a.overall_rating ?? 50);
  });
  const sortedOldest = [...bench].sort((a, b) => {
    const diff = (b.age ?? 0) - (a.age ?? 0);
    if (diff !== 0) return diff;
    return (b.overall_rating ?? 50) - (a.overall_rating ?? 50);
  });

  /**
   * Build the per-variant promotion spec.  Identical shape across
   * variants — only the chosen player + stat_bumps + reason vary.
   *
   * @param chosen      The bench player being promoted.
   * @param stat_bumps  Per-stat delta map applied alongside the
   *                    promotion.  Variant-specific.
   * @param reason      Variant-specific in-world explanation.
   */
  const buildPromotion = (
    chosen:     PlayerRow,
    stat_bumps: Partial<Record<'attacking' | 'defending' | 'mental' | 'athletic' | 'technical', number>>,
    reason:     string,
  ): FocusEnactmentSpec => ({
    focus_key:   'scout_network',
    focus_label: 'Expand Scout Network',
    reason,
    mutations:   [{ kind: 'promote_player', player_id: chosen.id, stat_bumps }],
  });

  // Variant pool (#424). Weights chosen per the design rationale above.
  const variants: FocusVariant[] = [
    {
      key:    'pure_skill',
      weight: 40,
      apply:  () => {
        const chosen = sortedHighestRated[0]!;
        return buildPromotion(
          chosen,
          { technical: 2, mental: 1 },
          `A hidden gem is uncovered. ${chosen.name} — overlooked, underestimated — now steps into the light. The scout network reaches deeper into the void.`,
        );
      },
    },
    {
      key:    'youth_find',
      weight: 35,
      apply:  () => {
        const chosen = sortedYoungest[0]!;
        return buildPromotion(
          chosen,
          { athletic: 2, technical: 1 },
          `The scouts brought back a name from the outer colonies. ${chosen.name} runs faster than the squad's expectations — and the cosmos suspects there is more still to come.`,
        );
      },
    },
    {
      key:    'veteran_steal',
      weight: 25,
      apply:  () => {
        const chosen = sortedOldest[0]!;
        return buildPromotion(
          chosen,
          { mental: 3 },
          `The scouts uncovered a journeyman, undervalued for their age. ${chosen.name} brings a vault of game knowledge to the squad — a wily voice in the dressing room the cosmos has finally remembered.`,
        );
      },
    },
  ];

  return pickVariant(variants, rng).apply();
}

/**
 * Fan engagement drive: community investment lifts gate income and/or
 * lifts the squad's spirits.
 *
 * VARIANTS (#424):
 *   - revenue_focus  — Pure +2000 ticket revenue, no stat bump (the
 *                      pre-#424 baseline).  Pure financial cosmetic.
 *   - mental_lift    — +1000 revenue + mental +1 on starters.  The
 *                      community campaign reaches the dressing room;
 *                      every starter walks a little taller.
 *   - morale_surge   — +500 revenue + athletic +1 across ALL players.
 *                      The fan energy translates to physical
 *                      excitement; the whole squad runs harder.
 *
 * Weights split the cosmos's preferences roughly 40/30/30.  The
 * revenue-only outcome stays the most common (matches the pre-#424
 * "fan drive lifts revenue" expectation), with the two stat-bump
 * variants splitting the remainder.  Total revenue across the three
 * variants averages roughly 2000/3 + 1000/3 + 500/3 ≈ 1167 — lower
 * than the pre-#424 flat 2000 because the stat bumps absorb some
 * of the cosmos's gift.
 */
function enactFanEngagement(
  teamId:   string,
  seasonId: string,
  players:  PlayerRow[],
  rng:      () => number,
): FocusEnactmentSpec {
  /**
   * Build a spec from a revenue amount + optional player stat bumps.
   *
   * @param revenue  Positive ticket_revenue + balance delta.
   * @param reason   Variant-specific in-world explanation.
   * @param bumps    Optional per-player bumps applied to the players
   *                 matching `targets`.  Pass undefined for no bumps.
   * @param targets  Filter predicate for which players receive bumps.
   *                 Only used when `bumps` is non-null.
   */
  const build = (
    revenue: number,
    reason:  string,
    bumps?:  Array<{ stat: 'attacking' | 'defending' | 'mental' | 'athletic' | 'technical'; delta: number }>,
    targets?: (p: PlayerRow) => boolean,
  ): FocusEnactmentSpec => {
    const mutations: EnactmentMutation[] = [
      {
        kind:                 'team_finances_delta',
        team_id:              teamId,
        season_id:            seasonId,
        ticket_revenue_delta: revenue,
        balance_delta:        revenue,
      },
    ];
    if (bumps && targets) {
      for (const p of players) {
        if (!targets(p)) continue;
        for (const b of bumps) {
          mutations.push({
            kind:      'player_stat_bump',
            player_id: p.id,
            stat:      b.stat,
            delta:     b.delta,
          });
        }
      }
    }
    return {
      focus_key:   'fan_engagement',
      focus_label: 'Fan Engagement Drive',
      reason,
      mutations,
    };
  };

  // Variant pool (#424). Revenue-focus stays the most common outcome
  // (matches the pre-#424 expectation that fan engagement = revenue);
  // mental_lift + morale_surge split the cosmos's flair budget.
  const variants: FocusVariant[] = [
    {
      key:    'revenue_focus',
      weight: 40,
      apply:  () => build(
        2_000,
        `The fans are drawn closer. Their voices grow louder. The treasury notes the increase.`,
      ),
    },
    {
      key:    'mental_lift',
      weight: 30,
      apply:  () => build(
        1_000,
        `The campaign reaches the dressing room. Letters from children, banners hand-painted in the stands — every starter walks a little taller into the next match.`,
        [{ stat: 'mental', delta: 1 }],
        (p) => p.starter,
      ),
    },
    {
      key:    'morale_surge',
      weight: 30,
      apply:  () => build(
        500,
        `The crowd's energy crosses the touchline. The whole squad — starters and reserves — picks up the rhythm. The cosmos approves of the contagion.`,
        [{ stat: 'athletic', delta: 1 }],
        () => true,
      ),
    },
  ];

  return pickVariant(variants, rng).apply();
}

/**
 * Sports science programme: medical and physio investment yields stat gains
 * shaped by which sub-discipline the staff chose to invest in.
 *
 * VARIANTS (#424):
 *   - conditioning   — Athletic +1 AND defending +1 across ALL players (the
 *                      pre-#424 baseline).  Whole-squad durability gain.
 *   - recovery       — Defending +2 across ALL players.  Cellular-level
 *                      injury resistance; players take fewer knocks.
 *   - explosiveness  — Athletic +2 on STARTERS only.  The lab focused on
 *                      peak-output sprint conditioning for the first XI;
 *                      bigger lift, narrower scope.
 *
 * Weights split roughly evenly (33/33/34) — no a-priori reason the cosmos
 * should prefer one sub-discipline over another.
 */
function enactSportsScience(
  players: PlayerRow[],
  rng:     () => number,
): FocusEnactmentSpec {
  /**
   * Spec builder — every variant supplies a `targets` predicate (squad-wide
   * or starters only), one or more (stat, delta) pairs to apply per
   * targeted player, and a variant-specific reason.
   *
   * @param targets  Filter predicate selecting which players to bump.
   * @param bumps    Array of (stat, delta) pairs applied per targeted player.
   * @param reason   Variant-specific in-world explanation.
   */
  const build = (
    targets: (p: PlayerRow) => boolean,
    bumps:   Array<{ stat: 'attacking' | 'defending' | 'mental' | 'athletic' | 'technical'; delta: number }>,
    reason:  string,
  ): FocusEnactmentSpec => {
    const mutations: EnactmentMutation[] = [];
    for (const p of players) {
      if (!targets(p)) continue;
      for (const b of bumps) {
        mutations.push({
          kind:      'player_stat_bump',
          player_id: p.id,
          stat:      b.stat,
          delta:     b.delta,
        });
      }
    }
    return {
      focus_key:   'sports_science',
      focus_label: 'Sports Science Programme',
      reason,
      mutations,
    };
  };

  // Variant pool (#424). Equal weights — see prose above.
  const variants: FocusVariant[] = [
    {
      key:    'conditioning',
      weight: 33,
      apply:  () => build(
        () => true,                // all players
        [
          { stat: 'athletic',  delta: 1 },
          { stat: 'defending', delta: 1 },
        ],
        `The medical staff rewrite the squad's limits at a cellular level. The cosmos approves — it prefers its mortals difficult to break.`,
      ),
    },
    {
      key:    'recovery',
      weight: 33,
      apply:  () => build(
        () => true,                // all players
        [{ stat: 'defending', delta: 2 }],
        `The lab focuses on the long arc: collagen mapping, joint scans, regenerative protocols. The squad emerges harder to break, harder to bend. The cosmos collects fewer souls this season.`,
      ),
    },
    {
      key:    'explosiveness',
      weight: 34,
      apply:  () => build(
        (p) => p.starter,          // starters only
        [{ stat: 'athletic', delta: 2 }],
        `The lab burns its budget on peak output. Sprint conditioning, plyometric drills, neural-pathway tuning — the first XI emerges sharper than the cosmos has seen them. The bench watches from the sidelines.`,
      ),
    },
  ];

  return pickVariant(variants, rng).apply();
}

/**
 * Mental resilience coaching: a sports psychologist runs workshops. The
 * variants differ on which set of mortals end up doing the work.
 *
 * VARIANTS (#424):
 *   - collective_calm — Mental +3 across ALL starters (the pre-#424
 *                       baseline).  Group-therapy cadence — every
 *                       starter pulls a moderate lift.
 *   - captain_focus   — Mental +5 on the highest-mental starter alone.
 *                       The cosmos chose the squad's natural leader to
 *                       carry the dressing room.  Bigger lift, single
 *                       point of failure.
 *   - squad_therapy   — Mental +1 across the WHOLE squad (starters +
 *                       bench).  The psychologist ran open sessions;
 *                       the bench's belief lifts too.
 *
 * Weights split equally — no a-priori preference between solidarity,
 * captaincy, or breadth.  When the squad has no starters (degenerate
 * test fixture), captain_focus still emits zero mutations cleanly.
 */
function enactMentalCoaching(
  players: PlayerRow[],
  rng:     () => number,
): FocusEnactmentSpec {
  const starters = players.filter((p) => p.starter);

  /**
   * Build a spec from a list of (player, stat, delta) triples + a reason.
   * Variants compose their own triples and feed them in.
   *
   * @param triples  Pre-resolved mutation list.
   * @param reason   Variant-specific in-world explanation.
   */
  const build = (
    triples: Array<{ player: PlayerRow; delta: number }>,
    reason:  string,
  ): FocusEnactmentSpec => {
    const mutations: EnactmentMutation[] = triples.map((t) => ({
      kind:      'player_stat_bump',
      player_id: t.player.id,
      stat:      'mental',
      delta:     t.delta,
    }));
    return {
      focus_key:   'mental_coaching',
      focus_label: 'Mental Resilience Coaching',
      reason,
      mutations,
    };
  };

  // Find the natural captain — highest-mental starter, ties broken by
  // overall_rating then id (deterministic, RNG-free). Used by
  // captain_focus only.  Falls back to null when no starters exist.
  const captain = [...starters]
    .sort((a, b) => {
      const diff = b.mental - a.mental;
      if (diff !== 0) return diff;
      return (b.overall_rating ?? 50) - (a.overall_rating ?? 50);
    })[0] ?? null;

  // Variant pool (#424). Equal weights per the design rationale above.
  const variants: FocusVariant[] = [
    {
      key:    'collective_calm',
      weight: 33,
      apply:  () => build(
        starters.map((p) => ({ player: p, delta: 3 })),
        `The ghosts in their minds are quieted. The squad faces pressure with new calm — the kind only suffering, and then release, can produce.`,
      ),
    },
    {
      key:    'captain_focus',
      weight: 33,
      apply:  () => build(
        captain ? [{ player: captain, delta: 5 }] : [],
        captain
          ? `${captain.name} carries the dressing room. The coach speaks only to one mortal this season — and the cosmos watches them grow heavier, steadier, until the whole squad rests on their shoulders.`
          : `The coach searched for a captain among the empty pitch. None was found.`,
      ),
    },
    {
      key:    'squad_therapy',
      weight: 34,
      apply:  () => build(
        players.map((p) => ({ player: p, delta: 1 })),
        `The psychologist opens the sessions to everyone — bench, starters, recently-injured. The whole squad's belief lifts a half-degree. Quiet, but the cosmos notes the spread.`,
      ),
    },
  ];

  return pickVariant(variants, rng).apply();
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Resolve a single focus win into a concrete `FocusEnactmentSpec`.
 *
 * @param focusKey  The `option_key` from the winning `FocusTallyEntry`.
 * @param teamId    The team slug whose roster will be mutated.
 * @param seasonId  The season UUID — used for finance mutations.
 * @param players   All players on this team (starters + bench). Should be
 *                  fetched fresh before enactment to avoid stale state.
 * @param rng       Seeded RNG — use `seededRng(\`${seasonId}:${teamId}:${focusKey}\`)`.
 * @returns         A `FocusEnactmentSpec` describing all mutations, or `null`
 *                  if the focus key is unrecognised.
 */
export function enactFocus(
  focusKey: string,
  teamId: string,
  seasonId: string,
  players: PlayerRow[],
  rng: () => number,
): FocusEnactmentSpec | null {
  switch (focusKey) {
    case 'sign_star_player': return enactSignStarPlayer(teamId, players, rng);
    case 'youth_academy':    return enactYouthAcademy(players, rng);
    case 'tactical_overhaul':return enactTacticalOverhaul(players, rng);
    case 'stadium_upgrade':  return enactStadiumUpgrade(teamId, seasonId, players, rng);
    case 'preseason_camp':   return enactPreseasonCamp(players, rng);
    case 'scout_network':    return enactScoutNetwork(players, rng);
    case 'fan_engagement':   return enactFanEngagement(teamId, seasonId, players, rng);
    case 'sports_science':   return enactSportsScience(players, rng);
    case 'mental_coaching':  return enactMentalCoaching(players, rng);
    default:                 return null;
  }
}
