// ── voting/logic/enactFocus.ts ───────────────────────────────────────────────
// WHY: Voting tallies have been wired since Phase 4, but the winning focus was
// never applied. This module is the engine that converts a vote result into
// concrete roster/stat/facility mutations — closing the social experiment loop.
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

// ── Focus handlers ────────────────────────────────────────────────────────────

/**
 * Append a new star-quality signing to the squad.
 * Stats are seeded from the RNG and scaled slightly above team average —
 * a signing should improve the team, not just fill numbers.
 *
 * Generates stats 8–14 points above team average, clamped at 99.
 * Jersey number: next available above the current highest.
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

  // Star quality: 8–14 above team average, seeded.
  const boost = () => Math.round(8 + rng() * 6);
  const position = pickSigningPosition(starters, rng);

  // Position-specific stat weighting: FW → attacking heavy, DF → defending, etc.
  const posBoost: Record<string, Partial<Record<'attacking' | 'defending' | 'mental' | 'athletic' | 'technical', number>>> = {
    FW: { attacking: boost() + 4, defending: -4, mental: boost(), athletic: boost(), technical: boost() },
    DF: { attacking: -4, defending: boost() + 4, mental: boost(), athletic: boost(), technical: boost() },
    MF: { attacking: boost(), defending: boost(), mental: boost() + 2, athletic: boost(), technical: boost() + 2 },
    GK: { attacking: -30, defending: boost() + 10, mental: boost(), athletic: boost(), technical: boost() },
  };
  const pb = posBoost[position] ?? {};

  const newPlayer: NewPlayerData = {
    team_id:       teamId,
    name:          generatePlayerName(rng),
    position,
    age:           Math.round(22 + rng() * 7), // 22–28 — prime signing age
    overall_rating: clampStat(Math.round((avgAtk + avgDef + avgMen + avgAtl + avgTech) / 5) + 8),
    attacking:     clampStat(avgAtk  + (pb.attacking  ?? 0)),
    defending:     clampStat(avgDef  + (pb.defending  ?? 0)),
    mental:        clampStat(avgMen  + (pb.mental     ?? 0)),
    athletic:      clampStat(avgAtl  + (pb.athletic   ?? 0)),
    technical:     clampStat(avgTech + (pb.technical  ?? 0)),
    starter:       true,
    jersey_number: Math.max(...players.map((p) => (p as unknown as { jersey_number?: number }).jersey_number ?? 0), 0) + 1,
  };

  return {
    focus_key:  'sign_star_player',
    focus_label: 'Sign a Star Player',
    reason: `A new signing arrives — destiny carries them to the squad. The cosmos prepared this arrival long before the vote was cast.`,
    mutations: [{ kind: 'insert_player', player: newPlayer }],
  };
}

/**
 * Promote the youngest bench player (aged ≤21) to starter, with a modest
 * +3 bump to their two primary stats. If no bench players aged ≤21 exist,
 * falls back to the highest-rated bench player of any age.
 *
 * The plan specifies "lift a 16–18yo bench player" but the template says
 * "youth_academy" so we interpret broadly as ≤21 (youth/reserve age).
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

  // Prefer youngest ≤21; fallback to any bench player.
  const youth  = bench.filter((p) => p.age !== null && p.age <= 21);
  const pool   = youth.length > 0 ? youth : bench;
  // Sort: youngest first, then by overall_rating DESC as tiebreaker.
  const sorted = [...pool].sort((a, b) => {
    const ageDiff = (a.age ?? 99) - (b.age ?? 99);
    if (ageDiff !== 0) return ageDiff;
    return (b.overall_rating ?? 50) - (a.overall_rating ?? 50);
  });
  const chosen = sorted[0]!;

  // Determine primary stats to boost based on position.
  const posBumps: Record<string, Array<'attacking' | 'defending' | 'mental' | 'athletic' | 'technical'>> = {
    FW: ['attacking', 'athletic'],
    DF: ['defending', 'mental'],
    MF: ['technical', 'mental'],
    GK: ['defending', 'mental'],
  };
  const statsToBoost = posBumps[chosen.position] ?? ['mental', 'athletic'];

  const bumpAmount = Math.round(2 + rng() * 2); // 2–4
  const stat_bumps: Partial<Record<'attacking' | 'defending' | 'mental' | 'athletic' | 'technical', number>> = {};

  for (const s of statsToBoost) {
    (stat_bumps as Record<string, number>)[s] = bumpAmount;
  }

  return {
    focus_key:   'youth_academy',
    focus_label: 'Invest in Youth Academy',
    reason: `The youth steps into the light. ${chosen.name} — long watched, long waiting — claims a place in the starting eleven. The Architect notes: this one was always meant to emerge now.`,
    mutations: [{ kind: 'promote_player', player_id: chosen.id, stat_bumps }],
  };
}

/**
 * Tactical overhaul: the coaching staff is reorganised around a new
 * philosophy. Boosts mental by +4 across all starters — mental represents
 * composure, decision-making, and tactical understanding.
 */
function enactTacticalOverhaul(players: PlayerRow[]): FocusEnactmentSpec {
  const starters = players.filter((p) => p.starter);
  const mutations: EnactmentMutation[] = starters.map((p) => ({
    kind:      'player_stat_bump',
    player_id: p.id,
    stat:      'mental',
    delta:     4,
  }));

  return {
    focus_key:  'tactical_overhaul',
    focus_label: 'Tactical Overhaul',
    reason: `The old patterns are dissolved. The squad emerges from the tactical purge with sharper minds, though the transition unsettles their rest.`,
    mutations,
  };
}

/**
 * Stadium upgrade: improved facilities yield higher gate revenue.
 * Adds +5 000 to ticket_revenue and balance in team_finances for this season.
 * In the absence of a `home_ground.capacity` column in this schema, the
 * financial proxy (ticket revenue delta) is used instead.
 */
function enactStadiumUpgrade(teamId: string, seasonId: string): FocusEnactmentSpec {
  return {
    focus_key:   'stadium_upgrade',
    focus_label: 'Upgrade the Stadium',
    reason: `The stadium's walls push outward. More mortals will witness the spectacle — and their presence will echo in the coffers.`,
    mutations: [
      {
        kind:                 'team_finances_delta',
        team_id:              teamId,
        season_id:            seasonId,
        ticket_revenue_delta: 5_000,
        balance_delta:        5_000,
      },
    ],
  };
}

/**
 * Intensive preseason camp: the squad runs harder drills before the season
 * opens. Boosts athletic by +2 across ALL players (not just starters) —
 * the squad depth benefits too.
 */
function enactPreseasonCamp(players: PlayerRow[]): FocusEnactmentSpec {
  const mutations: EnactmentMutation[] = players.map((p) => ({
    kind:      'player_stat_bump',
    player_id: p.id,
    stat:      'athletic',
    delta:     2,
  }));

  return {
    focus_key:   'preseason_camp',
    focus_label: 'Intensive Preseason Camp',
    reason: `The squad is driven to the edge of endurance before the first whistle blows. They emerge harder, faster — but the stars only watch to see if it was enough.`,
    mutations,
  };
}

/**
 * Scout network: a hidden gem from the bench earns a pathway to first-team
 * action. Promotes the highest-rated bench player and bumps technical +2,
 * mental +1. If no bench players exist, produces an empty mutation set.
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

  // Highest-rated bench player; random tiebreak via rng.
  const sorted = [...bench].sort((a, b) => {
    const diff = (b.overall_rating ?? 50) - (a.overall_rating ?? 50);
    if (diff !== 0) return diff;
    return rng() - 0.5;
  });
  const chosen = sorted[0]!;

  return {
    focus_key:   'scout_network',
    focus_label: 'Expand Scout Network',
    reason: `A hidden gem is uncovered. ${chosen.name} — overlooked, underestimated — now steps into the light. The scout network reaches deeper into the void.`,
    mutations: [
      {
        kind:       'promote_player',
        player_id:  chosen.id,
        stat_bumps: { technical: 2, mental: 1 },
      },
    ],
  };
}

/**
 * Fan engagement drive: community investment lifts gate income.
 * Adds +2 000 to ticket_revenue and balance in team_finances.
 */
function enactFanEngagement(teamId: string, seasonId: string): FocusEnactmentSpec {
  return {
    focus_key:   'fan_engagement',
    focus_label: 'Fan Engagement Drive',
    reason: `The fans are drawn closer. Their voices grow louder. The treasury notes the increase.`,
    mutations: [
      {
        kind:                 'team_finances_delta',
        team_id:              teamId,
        season_id:            seasonId,
        ticket_revenue_delta: 2_000,
        balance_delta:        2_000,
      },
    ],
  };
}

/**
 * Sports science programme: medical and physio investment yields squad-wide
 * conditioning gains. Buffs athletic +1 and defending +1 across ALL players —
 * better conditioning protects all positions.
 */
function enactSportsScience(players: PlayerRow[]): FocusEnactmentSpec {
  const mutations: EnactmentMutation[] = players.flatMap((p) => [
    { kind: 'player_stat_bump' as const, player_id: p.id, stat: 'athletic'  as const, delta: 1 },
    { kind: 'player_stat_bump' as const, player_id: p.id, stat: 'defending' as const, delta: 1 },
  ]);

  return {
    focus_key:   'sports_science',
    focus_label: 'Sports Science Programme',
    reason: `The medical staff rewrite the squad's limits at a cellular level. The cosmos approves — it prefers its mortals difficult to break.`,
    mutations,
  };
}

/**
 * Mental resilience coaching: a sports psychologist runs workshops across
 * the starting eleven. Boosts mental +3 for all starters.
 */
function enactMentalCoaching(players: PlayerRow[]): FocusEnactmentSpec {
  const starters  = players.filter((p) => p.starter);
  const mutations: EnactmentMutation[] = starters.map((p) => ({
    kind:      'player_stat_bump',
    player_id: p.id,
    stat:      'mental',
    delta:     3,
  }));

  return {
    focus_key:   'mental_coaching',
    focus_label: 'Mental Resilience Coaching',
    reason: `The ghosts in their minds are quieted. The squad faces pressure with new calm — the kind only suffering, and then release, can produce.`,
    mutations,
  };
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
    case 'tactical_overhaul':return enactTacticalOverhaul(players);
    case 'stadium_upgrade':  return enactStadiumUpgrade(teamId, seasonId);
    case 'preseason_camp':   return enactPreseasonCamp(players);
    case 'scout_network':    return enactScoutNetwork(players, rng);
    case 'fan_engagement':   return enactFanEngagement(teamId, seasonId);
    case 'sports_science':   return enactSportsScience(players);
    case 'mental_coaching':  return enactMentalCoaching(players);
    default:                 return null;
  }
}
