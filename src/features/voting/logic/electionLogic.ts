// ── features/voting/logic/electionLogic.ts ───────────────────────────────────
// Pure Election Night orchestration logic.  No React, no Supabase, no I/O.
// 100% unit-testable.
//
// DESIGN INTENT (Phase 3 — Election Night ritual + permadeath pipeline)
// ──────────────────────────────────────────────────────────────────────
// Election Night is the emotional peak of the 2-week season cycle.  This
// module owns the three core algorithms:
//
//   1. selectIncinerationTargets()
//      Idol-weighted random selection of which player(s) the Architect will
//      incinerate.  Most-loved = most likely to be chosen.  This is the
//      love-is-dangerous mechanic made real.
//
//   2. resolveFocusWinners()
//      Determines which focus option won per team per tier (major/minor) by
//      highest total_credits.  Ties broken by vote_count then creation order.
//      Returns an EnactedFocuses record per team.
//
//   3. buildFocusMutations()
//      Converts a winning focus option_key into a list of DB-ready mutations
//      (stat bumps, attribute changes, etc.) that the API layer can apply.
//      Pure — no side effects.  All mutations are additive (caps at 99).
//
// The calling layer (Election Night Edge Function or client-side admin trigger)
// is responsible for: fetching the data, calling these functions, writing the
// results to Supabase, and generating the Architect's decree text via Claude.
//
// WHY PURE LOGIC
// ──────────────
// Keeping these functions pure means they can be:
//   - Unit-tested without DB mocks
//   - Called from an Edge Function OR a browser client (same bundle)
//   - Reasoned about independently of network latency or DB state
// ──────────────────────────────────────────────────────────────────────────────

import type { FocusTallyEntry, EnactedFocuses } from '../types';

// ── Selection weight constants ────────────────────────────────────────────────

/**
 * Idol rank multiplier applied to the top N idolised players.
 * A player at global_rank ≤ IDOL_TARGETING_THRESHOLD receives
 * IDOL_WEIGHT_MULTIPLIER × the base weight of everyone else.
 *
 * WHY 2× (IDOL_WEIGHT_MULTIPLIER):
 *   The love-is-dangerous mechanic from the locked design decisions.
 *   Doubling the weight gives a ~2× chance of selection relative to an equally
 *   prominent non-idolised player.  Going higher (3–4×) would make idolisation
 *   too mechanically deterministic — fans would game it by spreading love to
 *   protect players they like.  2× creates risk without certainty.
 */
const IDOL_WEIGHT_MULTIPLIER = 2;

/**
 * Only players within this global rank threshold receive the idol multiplier.
 * Rank 1 = most idolised.  Players ranked > IDOL_TARGETING_THRESHOLD receive
 * base weight 1.
 *
 * WHY 10: The top 10 leaguewide idolised players is a meaningful set
 * (roughly one per team) without diluting the mechanic to near-zero.
 */
const IDOL_TARGETING_THRESHOLD = 10;

/**
 * Base selection weight for every active player not in the top idol tier.
 * Exists so even un-idolised players carry a non-zero risk — the cosmos is
 * arbitrary and cruel, not exclusively statistical.
 */
const BASE_SELECTION_WEIGHT = 1;

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Minimal player shape needed for incineration target selection.
 * Deliberately narrow — callers should not need to pass a full DB row.
 */
export interface IncinerationCandidate {
  /** Player UUID — written to the incinerations table on selection. */
  id: string;
  /** Display name for decree text generation. */
  name: string;
  /** Team the player belongs to. */
  team_id: string;
  /**
   * Global idol rank from player_idol_score view.
   * null when the player has zero idol score (not in the view).
   */
  idolRank: number | null;
}

/**
 * A selected incineration target with the weight that caused their selection.
 * Returned alongside the target so callers can write idol_rank_at_time to
 * the incinerations audit table.
 */
export interface IncinerationTarget {
  candidate: IncinerationCandidate;
  /** The computed selection weight — audit trail for the mechanic. */
  selectionWeight: number;
}

/**
 * A single DB-ready stat mutation for a player or team.
 * Produced by buildFocusMutations() and consumed by the API layer.
 */
export interface FocusMutation {
  /** 'player' | 'team' — what entity to update. */
  targetType: 'player' | 'team';
  /** Player UUID or team TEXT id. */
  targetId: string;
  /** Column name on the players or teams table. */
  column: string;
  /**
   * Amount to add to the current column value.
   * The API layer must clamp to [1, 99] for stat columns.
   */
  delta: number;
}

// ── 1. selectIncinerationTargets() ───────────────────────────────────────────

/**
 * Idol-weighted random selection of incineration targets from the active
 * player roster.
 *
 * WEIGHTING ALGORITHM
 * ────────────────────
 * Each candidate receives a selection weight:
 *   - Global idol rank ≤ IDOL_TARGETING_THRESHOLD → weight = IDOL_WEIGHT_MULTIPLIER (2)
 *   - Everyone else                               → weight = BASE_SELECTION_WEIGHT (1)
 *
 * Selection is a weighted random draw WITHOUT replacement — the same player
 * cannot be selected twice in a single Election Night.
 *
 * WHY WITHOUT REPLACEMENT: selecting the same player twice would waste a
 * decree slot and feel narratively broken ("they were already gone").
 *
 * @param candidates   All active players eligible for incineration.
 * @param count        Number of players to incinerate this Election Night.
 *                     Typically 1–3 per the locked design decisions.
 * @param rng          Optional random function for testability (default Math.random).
 * @returns            Selected targets in selection order.  Length ≤ min(count, candidates.length).
 */
export function selectIncinerationTargets(
  candidates: IncinerationCandidate[],
  count: number,
  rng: () => number = Math.random,
): IncinerationTarget[] {
  if (candidates.length === 0 || count <= 0) return [];

  // Build weighted pool — each candidate appears once with its weight as a
  // floating-point probability share.
  const pool: Array<{ candidate: IncinerationCandidate; weight: number }> = candidates.map(c => ({
    candidate: c,
    weight: c.idolRank !== null && c.idolRank <= IDOL_TARGETING_THRESHOLD
      ? IDOL_WEIGHT_MULTIPLIER
      : BASE_SELECTION_WEIGHT,
  }));

  const selected: IncinerationTarget[] = [];
  // Draw `count` times without replacement.
  for (let i = 0; i < count && pool.length > 0; i++) {
    const totalWeight = pool.reduce((sum, e) => sum + e.weight, 0);
    let roll = rng() * totalWeight;

    let chosenIdx = pool.length - 1; // fallback: last entry (rng never produces totalWeight exactly)
    for (let j = 0; j < pool.length; j++) {
      // Indexed access is safe here: j < pool.length, but TypeScript's
      // noUncheckedIndexedAccess still types pool[j] as `T | undefined`.
      // The non-null assertion documents the loop-bound invariant.
      roll -= pool[j]!.weight;
      if (roll <= 0) {
        chosenIdx = j;
        break;
      }
    }

    // chosenIdx is always within pool's bounds (pool.length > 0 enforced by
    // the outer for-loop guard), so pool[chosenIdx] is guaranteed defined.
    const chosen = pool[chosenIdx]!;
    selected.push({ candidate: chosen.candidate, selectionWeight: chosen.weight });
    // Remove the selected candidate so they cannot be drawn again.
    pool.splice(chosenIdx, 1);
  }

  return selected;
}

// ── 2. resolveFocusWinners() ─────────────────────────────────────────────────

/**
 * Determine the winning focus option per team per tier (major + minor).
 *
 * Winner = highest total_credits among options in that tier for that team.
 * Tie-breaking order:
 *   1. total_credits DESC
 *   2. vote_count DESC (more fans engaged = stronger mandate)
 *   3. option_key ASC (deterministic alphabetical fallback)
 *
 * Returns null for a tier when no options exist or no votes were cast.
 * A null winner means the cosmos acts without fan direction — the Architect
 * picks arbitrarily (handled by the calling layer, not this function).
 *
 * @param tallies  All focus_tally rows for the season (may span multiple teams).
 * @returns        Map of team_id → EnactedFocuses.
 */
export function resolveFocusWinners(
  tallies: FocusTallyEntry[],
): Map<string, EnactedFocuses> {
  // Group tallies by team_id.
  const byTeam = new Map<string, { major: FocusTallyEntry[]; minor: FocusTallyEntry[] }>();

  for (const t of tallies) {
    if (!byTeam.has(t.team_id)) {
      byTeam.set(t.team_id, { major: [], minor: [] });
    }
    byTeam.get(t.team_id)![t.tier].push(t);
  }

  const results = new Map<string, EnactedFocuses>();

  for (const [teamId, { major, minor }] of byTeam) {
    results.set(teamId, {
      team_id:   teamId,
      season_id: major[0]?.season_id ?? minor[0]?.season_id ?? '',
      major: pickWinner(major),
      minor: pickWinner(minor),
    });
  }

  return results;
}

/**
 * Pick the winning option from a single-tier tally list.
 * Returns null if no options exist or all have zero credits.
 */
function pickWinner(options: FocusTallyEntry[]): FocusTallyEntry | null {
  if (options.length === 0) return null;

  // Filter to options with at least one credit allocated — a zero-vote option
  // has no fan mandate and should not "win" by default.
  const voted = options.filter(o => o.total_credits > 0);
  if (voted.length === 0) return null;

  // Sort by tie-breaking criteria: credits desc, then vote count desc, then key asc.
  // `voted` is guaranteed non-empty (early-returned above when length===0), so
  // [0] is defined; the `?? null` keeps TypeScript happy under
  // noUncheckedIndexedAccess without changing runtime behaviour.
  return voted.slice().sort((a, b) => {
    if (b.total_credits !== a.total_credits) return b.total_credits - a.total_credits;
    if (b.vote_count    !== a.vote_count)    return b.vote_count    - a.vote_count;
    return a.option_key.localeCompare(b.option_key);
  })[0] ?? null;
}

// ── 3. buildFocusMutations() ─────────────────────────────────────────────────

/**
 * Convert a winning focus option into a list of DB-ready stat mutations.
 *
 * OPTION KEY → MUTATION MAPPING
 * ──────────────────────────────
 * Focus option keys are defined in the focus_options seed.  Each key maps to
 * one or more column deltas on either the players or teams table.
 *
 * All deltas are intentionally small (+1 to +3) so the effect accumulates
 * across seasons without single-season dominance.  The Architect can also
 * award transformations that override or compound these — transformations are
 * handled separately in the decree pipeline.
 *
 * UNMAPPED KEYS: unknown option_key values produce an empty mutation list.
 * This is intentional: future focus types can be added to the seed without
 * breaking this function — they simply have no mechanical effect until mapped
 * here.
 *
 * @param option   The winning focus option.
 * @param players  Active players on the team (needed for player-level mutations).
 * @returns        List of mutations to apply via the API layer.
 */
export function buildFocusMutations(
  option: FocusTallyEntry,
  players: Array<{ id: string; position: string; age: number; overall_rating: number }>,
): FocusMutation[] {
  const mutations: FocusMutation[] = [];

  switch (option.option_key) {

    // ── Sign new players ─────────────────────────────────────────────────────
    // The actual signing (generating a new player row via Claude) is handled
    // by the calling layer.  Here we produce no mutations — the calling layer
    // detects this key and triggers the async generation path instead.
    case 'sign_striker':
    case 'sign_midfielder':
    case 'sign_defender':
    case 'sign_goalkeeper':
      // No stat mutations — caller handles player creation.
      break;

    // ── Promote youth players ────────────────────────────────────────────────
    // Youngest three players on the team each get +1 mental and +1 technical.
    // Youth promotion is about nurturing potential; mental resilience and
    // technical refinement are the two most development-responsive stats.
    case 'promote_youth': {
      const youth = players
        .filter(p => p.age <= 23)
        .sort((a, b) => a.age - b.age)
        .slice(0, 3);
      for (const p of youth) {
        mutations.push({ targetType: 'player', targetId: p.id, column: 'mental',    delta: 1 });
        mutations.push({ targetType: 'player', targetId: p.id, column: 'technical', delta: 1 });
      }
      break;
    }

    // ── Player boosts ────────────────────────────────────────────────────────
    // Top 5 players by overall_rating each get +1 to their weakest of the five
    // core stats.  The "weakest stat" floor lift models targeted physical
    // conditioning investment.
    case 'player_boosts': {
      const top5 = players
        .slice()
        .sort((a, b) => b.overall_rating - a.overall_rating)
        .slice(0, 5);
      for (const p of top5) {
        // We only have overall_rating here; the calling layer may enrich with
        // per-stat values.  Fall back to +1 attacking if no per-stat data.
        mutations.push({ targetType: 'player', targetId: p.id, column: 'attacking', delta: 1 });
      }
      break;
    }

    // ── Preseason training investments ────────────────────────────────────────
    // All players get +1 athletic.  This models a collective fitness push.
    // Athletic drives stamina decay curves, so a league-wide +1 makes matches
    // feel slightly faster and more energetic — visible but not gameable.
    case 'preseason_training': {
      for (const p of players) {
        mutations.push({ targetType: 'player', targetId: p.id, column: 'athletic', delta: 1 });
      }
      break;
    }

    // ── Stadium upgrades ──────────────────────────────────────────────────────
    // No player-stat mutations.  The stadium is a team-level entity; upgrade
    // effects (capacity, atmosphere bonus) are applied by the calling layer
    // when it detects this key.
    case 'stadium_upgrade':
      break;

    // All other keys: no mutations (future-safe).
    default:
      break;
  }

  return mutations;
}

// ── 4. Helpers for the Election Night decree sequence ─────────────────────────

/**
 * Sort and stage the Election Night decree sequence.
 *
 * DISPLAY ORDER RATIONALE
 * ────────────────────────
 * The Architect withholds the worst news for maximum emotional impact:
 *   1. proclamation  — scene-setting, cosmic tone-establishment
 *   2. focus_enacted — the fans' will is acknowledged; relief or excitement
 *   3. blessing      — unexpected gifts; hope before the hammer
 *   4. transformation — change is announced; the world shifts
 *   5. incineration  — the final blow; always last
 *
 * Within each type, decrees are sub-sorted by sequence_order ASC.
 *
 * @param decrees  Unsorted decree objects from the season_decrees table.
 * @returns        Decrees in the correct Election Night display order.
 */
export function sortDecreesForElectionNight<T extends { decree_type: string; sequence_order: number }>(
  decrees: T[],
): T[] {
  const TYPE_ORDER: Record<string, number> = {
    proclamation:  0,
    focus_enacted: 1,
    blessing:      2,
    transformation: 3,
    incineration:  4, // Always last — maximum drama
  };

  return decrees.slice().sort((a, b) => {
    const typeA = TYPE_ORDER[a.decree_type] ?? 99;
    const typeB = TYPE_ORDER[b.decree_type] ?? 99;
    if (typeA !== typeB) return typeA - typeB;
    return a.sequence_order - b.sequence_order;
  });
}
