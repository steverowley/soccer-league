// ── drama-tick / applyConsequence.ts ───────────────────────────────────────
// Structural side-effects fired AFTER a drama narrative is written.  Phase 9
// shipped narrative-only — Phase 9.1 (this module) lets the writer mutate
// the world the drama announces.
//
// WHY THIS LIVES HERE (NOT IN /supabase/functions/drama-applier/)
//   The cadence is the same as the writer (daily) and the consequence is
//   in 1:1 correspondence with the narrative emit.  Splitting them across
//   functions would force a second cron + a coordination table for no
//   benefit at v1 volumes (≤2 dramas/day).  When we later want a "cooloff
//   period" between narrative and consequence — so fans see the news a day
//   before the world shifts — a small `drama_consequences` table can be
//   added without changing this module's interface.
//
// SAFETY
//   Every applier is best-effort, swallows errors, and returns a small
//   summary the caller logs.  A failed mutation NEVER reverts the
//   narrative — fans already saw it; we'll backfill the structural change
//   manually if it matters.

// deno-lint-ignore-file no-explicit-any
// ^ Edge function context: Supabase JS lacks Deno-native types here.

// ── Tuning constants ───────────────────────────────────────────────────────

/**
 * Decree type used for drama-tier political_decree consequences.
 *
 * MECHANICAL EFFECT: migration 0046 extended the season_decrees
 * CHECK constraint to admit 'political_decree' alongside the
 * pre-existing lore types.  Rows of this type carry a structured
 * `payload` JSONB that the match-worker reads pre-match to bend
 * three simulator inputs:
 *   • cadence_mult         — multiplier on match_duration_seconds
 *   • ref_strictness_delta — added to base referee strictness
 *   • ticket_multiplier    — multiplier on team_finances ticket revenue
 * See `derivePoliticalDecreePayload` below for how a given drama
 * narrative is deterministically mapped to a payload.
 */
const POLITICAL_DECREE_DECREE_TYPE = 'political_decree';

// ── Political-decree payload bounds ─────────────────────────────────────────
// The payload values are intentionally modest — strong enough to feel
// distinct in the match-worker's read but bounded so a single
// political decree never warps the season beyond recognition.  Adjust
// these if playtesting reveals the effects are too subtle or too
// dominant.

/**
 * Min / max multiplier on `match_duration_seconds`.  0.6 = the match
 * paces ~40% faster (read: a "rapid-fire week"); 1.4 = ~40% slower
 * ("ceremonial week").  Centred on 1.0 so a neutral-leaning decree
 * is essentially a no-op.
 */
const POLITICAL_CADENCE_MIN = 0.6;
const POLITICAL_CADENCE_MAX = 1.4;

/**
 * Min / max integer added to the base referee strictness (0..100).
 * ±10 ≈ one tactical-style band on the engine's strictness scale,
 * enough to bend card-issue rates without invalidating the
 * underlying ref-pool diversity.
 */
const POLITICAL_REF_DELTA_MIN = -10;
const POLITICAL_REF_DELTA_MAX = 10;

/**
 * Min / max multiplier on team_finances ticket revenue.  0.8 = a
 * crowd boycott (~20% gate loss); 1.2 = a celebratory uplift.
 * Symmetric so decrees that hurt and decrees that bless balance
 * over a long season.
 */
const POLITICAL_TICKET_MIN = 0.8;
const POLITICAL_TICKET_MAX = 1.2;

// ── Shared result type ─────────────────────────────────────────────────────

/**
 * Outcome summary returned by every applier.  Caller logs the JSON.
 */
export interface ConsequenceResult {
  /** True when the structural mutation landed; false on no-op or failure. */
  applied: boolean;
  /** Short human reason for the outcome — used in worker log lines. */
  reason: string;
  /** Optional context bag for diagnostics. */
  meta?: Record<string, unknown>;
}

// ── transfer_demand → player.team_id mutation ──────────────────────────────

/**
 * Apply a transfer_demand consequence by moving the player to a different
 * team in the SAME league.  Cross-league transfers are deferred — they'd
 * require fixture re-balancing.
 *
 * STEPS
 *   1. Resolve the player row by entity_id (the entity must already be
 *      linked via players.entity_id — see migration 0002 backfill).
 *   2. Read the player's current team_id + league_id.
 *   3. Pick a random OTHER team in the same league.  Service-role read
 *      means RLS doesn't filter us.
 *   4. UPDATE players SET team_id = chosen.  No persona / entity rewrite
 *      because the player keeps their identity — only the affiliation
 *      flips.
 *
 * @param db          Service-role Supabase client.
 * @param entityId    Entity ID of the drama subject.
 * @returns           Outcome summary.
 */
export async function applyTransferDemand(
  db: any,
  entityId: string,
): Promise<ConsequenceResult> {
  // STEP 1: player row.
  const playerQ = await db
    .from('players')
    .select('id, team_id, teams(league_id)')
    .eq('entity_id', entityId)
    .maybeSingle();

  if (playerQ.error || !playerQ.data) {
    return { applied: false, reason: 'player_not_found', meta: { entityId } };
  }
  const player = playerQ.data as {
    id: string;
    team_id: string;
    teams: { league_id: string } | null;
  };
  const leagueId = player.teams?.league_id;
  if (!leagueId) {
    return { applied: false, reason: 'no_league_id', meta: { entityId } };
  }

  // STEP 2: pick a destination team — same league, not the current one.
  const teamsQ = await db
    .from('teams')
    .select('id')
    .eq('league_id', leagueId)
    .neq('id', player.team_id);

  if (teamsQ.error || !teamsQ.data || teamsQ.data.length === 0) {
    return {
      applied: false,
      reason: 'no_destination_teams',
      meta: { entityId, leagueId },
    };
  }
  const destinations = teamsQ.data as Array<{ id: string }>;
  const target = destinations[Math.floor(Math.random() * destinations.length)]!;

  // STEP 3: flip the affiliation.
  const { error: updateErr } = await db
    .from('players')
    .update({ team_id: target.id })
    .eq('id', player.id);

  if (updateErr) {
    return {
      applied: false,
      reason: 'update_failed',
      meta: { entityId, message: updateErr.message },
    };
  }

  return {
    applied: true,
    reason: 'transferred',
    meta: { entityId, from: player.team_id, to: target.id },
  };
}

// ── manager_resignation → manager swap ─────────────────────────────────────

/**
 * Hard-coded name pools used by `generateManagerName` to mint a fresh
 * persona when a resignation vacates a team.  Two parallel lists keep
 * the variation space at 100 unique first-last combinations — enough
 * that successive resignations rarely collide while staying small
 * enough to be hand-tuned for the league's space-opera aesthetic
 * (Mars derbies, asteroid-belt squads).  Replace with a Markov-chain
 * generator if/when the pool feels exhausted.
 */
const FRESH_MANAGER_FIRSTS: ReadonlyArray<string> = [
  'Arundel', 'Voren', 'Cassidy', 'Mira', 'Lex',
  'Thorne',  'Beck',  'Halan',   'Yara', 'Nox',
];
const FRESH_MANAGER_LASTS: ReadonlyArray<string> = [
  'Brava',     'Calverley', 'Drake',   'Ehrlich',  'Fortis',
  'Gilan',     'Holloway',  'Ivani',   'Joren',    'Karras',
];

/**
 * Hash a string to a 32-bit unsigned integer via FNV-1a.  Used to
 * deterministically derive a fresh manager name from the resigning
 * manager's entity id + the team id — so re-running the consequence
 * applier on the same row always produces the same replacement
 * (handy for testing + recovery flows).
 */
function hashString(s: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Mint a deterministic "First Last" name from a seed string.  The
 * seed combines the resigning entity id + the vacated team id so two
 * different resignations on the same team produce different
 * successors (and the same resignation re-applied produces the same
 * name).
 *
 * @param seed  Concatenation of the resigning entity_id + team_id.
 * @returns     A two-word name suitable for managers.name + entities.name.
 */
function generateManagerName(seed: string): string {
  const h = hashString(seed);
  const first = FRESH_MANAGER_FIRSTS[h % FRESH_MANAGER_FIRSTS.length]!;
  // Right-shift by 7 so the second index isn't perfectly correlated
  // with the first — keeps the variation high across short seeds.
  const last  = FRESH_MANAGER_LASTS[(h >>> 7) % FRESH_MANAGER_LASTS.length]!;
  return `${first} ${last}`;
}

/**
 * Apply a manager_resignation consequence by detaching the resigning
 * manager AND spinning up a fresh replacement (isl-cdj).  When the
 * resigning manager has no `team_id`, the consequence falls back to
 * a pure detach — there's no seat to fill.
 *
 * STEPS
 *   1. Resolve the manager row by entity_id.
 *   2. Capture team_id; detach via UPDATE managers SET team_id=NULL.
 *   3. (when team_id was non-null) Generate a deterministic name from
 *      the entity_id + team_id seed.  INSERT a new entities row
 *      (kind='manager').  INSERT a new managers row linked via
 *      entity_id.  Both inserts use best-effort error handling: a
 *      partial failure leaves the team managerless but the
 *      resignation itself is still considered applied (matches the
 *      existing "graceful degradation" contract on enactment).
 *
 * @param db        Service-role Supabase client.
 * @param entityId  Entity ID of the drama subject.
 * @returns         Outcome summary.  `reason` may be:
 *                  • 'manager_not_found'           — entity has no manager
 *                  • 'update_failed'                — detach UPDATE errored
 *                  • 'resigned'                     — detached, no team to refill
 *                  • 'resigned_and_replaced'        — full happy path
 *                  • 'resigned_no_replacement'      — detached but new manager
 *                                                     insert failed; team is
 *                                                     temporarily managerless
 */
export async function applyManagerResignation(
  db: any,
  entityId: string,
): Promise<ConsequenceResult> {
  const managerQ = await db
    .from('managers')
    .select('id, team_id')
    .eq('entity_id', entityId)
    .maybeSingle();

  if (managerQ.error || !managerQ.data) {
    return { applied: false, reason: 'manager_not_found', meta: { entityId } };
  }
  const manager = managerQ.data as { id: string; team_id: string | null };
  const formerTeamId = manager.team_id;

  // STEP 1: detach the resigning manager.  Independent of the
  // replacement step so a failed replacement still leaves the
  // resignation committed (better than rolling back the whole drama
  // beat).
  const { error: detachErr } = await db
    .from('managers')
    .update({ team_id: null })
    .eq('id', manager.id);

  if (detachErr) {
    return {
      applied: false,
      reason: 'update_failed',
      meta: { entityId, message: detachErr.message },
    };
  }

  // STEP 2: no team to fill?  Done.  This covers the rare case where
  // the resigning manager was already detached by an earlier drama
  // beat — the resignation still completes successfully.
  if (!formerTeamId) {
    return {
      applied: true,
      reason: 'resigned',
      meta: { entityId, formerTeam: null },
    };
  }

  // STEP 3: mint a fresh manager.  Two best-effort inserts: entity
  // first (so the manager row can link via entity_id), then the
  // manager row.  Each failure short-circuits to a partial-success
  // result so the caller sees what actually happened.
  const newName = generateManagerName(`${entityId}:${formerTeamId}`);

  // entities row — kind='manager' with the canonical meta shape used
  // elsewhere (mirrors createManagerEntity from src/features/entities).
  const { data: entityRow, error: entityErr } = await db
    .from('entities')
    .insert({
      kind:         'manager',
      name:         newName,
      display_name: newName,
      meta:         { team_id: formerTeamId, nationality: null },
    })
    .select('id')
    .single();

  if (entityErr || !entityRow) {
    return {
      applied: true,
      reason:  'resigned_no_replacement',
      meta:    {
        entityId,
        formerTeam:       formerTeamId,
        replacementError: entityErr?.message ?? 'entity insert returned no row',
      },
    };
  }
  const newEntityId = (entityRow as { id: string }).id;

  // managers row — links to the entity + the freshly-vacated team.
  // `style` and `nationality` left null; the persona enricher will
  // fill in flavour on its next pass.
  const { data: newManagerRow, error: managerErr } = await db
    .from('managers')
    .insert({
      name:      newName,
      team_id:   formerTeamId,
      entity_id: newEntityId,
    })
    .select('id')
    .single();

  if (managerErr || !newManagerRow) {
    // Entity exists but no manager — partial state.  Log the cause so
    // an admin can repair manually if the next drama tick doesn't.
    return {
      applied: true,
      reason:  'resigned_no_replacement',
      meta:    {
        entityId,
        formerTeam:        formerTeamId,
        replacementEntity: newEntityId,
        replacementError:  managerErr?.message ?? 'manager insert returned no row',
      },
    };
  }

  return {
    applied: true,
    reason:  'resigned_and_replaced',
    meta:    {
      entityId,
      formerTeam:         formerTeamId,
      replacementManager: (newManagerRow as { id: string }).id,
      replacementEntity:  newEntityId,
      replacementName:    newName,
    },
  };
}

// ── political_decree payload derivation (isl-azz) ──────────────────────────

/**
 * Shape of a political_decree's structured payload.  Persisted to
 * `season_decrees.payload` and consumed by the match-worker before
 * each simulation to bend three simulator inputs (cadence, referee
 * strictness, ticket revenue).
 *
 * All keys optional — the worker treats a missing key as a no-op
 * for that effect.  Multipliers default to 1.0 (identity), the
 * delta defaults to 0 (identity).
 */
export interface PoliticalDecreePayload {
  /** Multiplier on `match_duration_seconds`.  Clamped to the bounds above. */
  cadence_mult?:         number;
  /** Integer added to base referee strictness (then clamped 0..100). */
  ref_strictness_delta?: number;
  /** Multiplier on team_finances ticket revenue.  Clamped to the bounds above. */
  ticket_multiplier?:    number;
}

/**
 * Deterministic FNV-1a hash of an arbitrary string to a 32-bit
 * unsigned integer.  Used here to fingerprint a drama narrative so
 * the same political_decree narrative always produces the same
 * payload (testability + recovery flows).
 */
function fnv1aHash(s: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Map a [0..1) ratio into a [min..max] range with the chosen number
 * of decimal places.  Centralised so the three payload axes share
 * the same rounding contract — handy when comparing recorded
 * payloads across decrees.
 *
 * @param ratio    Value in [0..1).
 * @param min      Lower bound (inclusive).
 * @param max      Upper bound (inclusive).
 * @param decimals Decimal places for rounding (2 for multipliers).
 * @returns        Rounded number in [min..max].
 */
function scale(ratio: number, min: number, max: number, decimals = 2): number {
  const raw = min + ratio * (max - min);
  const k   = Math.pow(10, decimals);
  return Math.round(raw * k) / k;
}

/**
 * Derive a structured payload from a political-decree narrative.
 *
 * Strategy: hash the narrative text into three independent ratios
 * (one per axis) using different shift amounts so the three effects
 * don't correlate.  Then scale each ratio into its target range.
 *
 * Why a hash-derived payload (rather than an LLM call): keeps the
 * drama-tick function pure + cheap + idempotent.  The same narrative
 * always lands the same effect, so a re-applied decree (recovery
 * after a failed insert, test harness replays) reproduces exactly.
 *
 * @param narrativeText  The drama narrative — typically a short
 *                       sentence written by the Architect.
 * @returns              Validated PoliticalDecreePayload — every
 *                       key set, every value inside its documented
 *                       bound.
 */
export function derivePoliticalDecreePayload(
  narrativeText: string,
): PoliticalDecreePayload {
  const h = fnv1aHash(narrativeText);
  // Three independent ratios from disjoint bit windows so the axes
  // vary independently.  >>> 0 keeps each window an unsigned int;
  // / 0xffffffff normalises to a tight [0..1) ratio.
  const r1 = ((h         >>> 0) / 0xffffffff);
  const r2 = (((h >>> 11) >>> 0) / 0x001fffff);
  const r3 = (((h >>> 21) >>> 0) / 0x000007ff);
  return {
    cadence_mult:         scale(r1, POLITICAL_CADENCE_MIN, POLITICAL_CADENCE_MAX, 2),
    ref_strictness_delta: Math.round(scale(r2, POLITICAL_REF_DELTA_MIN, POLITICAL_REF_DELTA_MAX, 0)),
    ticket_multiplier:    scale(r3, POLITICAL_TICKET_MIN,  POLITICAL_TICKET_MAX,  2),
  };
}

// ── political_decree → season decree row ───────────────────────────────────

/**
 * Apply a political_decree consequence by committing the decree text to
 * the active season's `season_decrees` table as a `proclamation`.  The
 * row is rendered on the Election Night page and feeds the news ticker.
 *
 * Why proclamation (not a new decree_type): the existing CHECK constraint
 * accepts 5 values; `proclamation` is the lore-only variant.  Adding a
 * mechanically-active `political_decree` type requires a migration which
 * is deferred until we know what mechanical effect we actually want.
 *
 * @param db              Service-role Supabase client.
 * @param entityId        Entity ID of the political body issuing the decree.
 * @param narrativeText   Full text of the drama narrative — becomes the
 *                        decree's ticker line.
 * @returns               Outcome summary.
 */
export async function applyPoliticalDecree(
  db: any,
  entityId: string,
  narrativeText: string,
): Promise<ConsequenceResult> {
  // STEP 1: find the active season.  Falls back to the most recent
  // is_active row; the same logic the rest of the codebase uses.
  const seasonQ = await db
    .from('seasons')
    .select('id')
    .eq('is_active', true)
    .order('year', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (seasonQ.error || !seasonQ.data) {
    return { applied: false, reason: 'no_active_season', meta: { entityId } };
  }
  const seasonId = (seasonQ.data as { id: string }).id;

  // STEP 2: compute the next sequence_order in the season so the new
  // decree appends below any existing entries.  Best-effort — if the read
  // fails we default to 999 (likely above anything else).
  const orderQ = await db
    .from('season_decrees')
    .select('sequence_order')
    .eq('season_id', seasonId)
    .order('sequence_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder =
    ((orderQ.data as { sequence_order: number } | null)?.sequence_order ?? -1) + 1;

  // STEP 3: derive the structured payload from the narrative text.
  // Deterministic — same narrative produces same effect — so a re-
  // applied decree (recovery after a failed insert, test replays)
  // reproduces exactly.  See derivePoliticalDecreePayload above.
  const payload = derivePoliticalDecreePayload(narrativeText);

  // STEP 4: insert.  No player_id / team_id targets — political decrees
  // address the league as a whole at this layer.  decree_type is now
  // 'political_decree' (per migration 0046) so the worker reader can
  // filter by type rather than parse payload presence.
  const { error: insertErr } = await db.from('season_decrees').insert({
    season_id: seasonId,
    decree_type: POLITICAL_DECREE_DECREE_TYPE,
    text: narrativeText,
    sequence_order: nextOrder,
    payload,
  });

  if (insertErr) {
    return {
      applied: false,
      reason: 'insert_failed',
      meta: { entityId, seasonId, message: insertErr.message },
    };
  }

  return {
    applied: true,
    reason: 'decreed',
    meta: { entityId, seasonId, sequenceOrder: nextOrder, payload },
  };
}

// ── Public dispatcher ──────────────────────────────────────────────────────

/**
 * Dispatch a drama consequence by kind.  Returns a no-op `applied: false`
 * outcome for non-structural drama kinds (retirement_announcement,
 * feud_declaration) so the caller can log every dispatch uniformly.
 *
 * @param db              Service-role Supabase client.
 * @param dramaKind       The narrative `kind` just emitted.
 * @param entityId        Subject entity ID.
 * @param narrativeText   Narrative summary (used by political_decree).
 * @returns               Per-kind outcome summary.
 */
export async function applyDramaConsequence(
  db: any,
  dramaKind: string,
  entityId: string,
  narrativeText: string,
): Promise<ConsequenceResult> {
  switch (dramaKind) {
    case 'transfer_demand':
      return await applyTransferDemand(db, entityId);
    case 'manager_resignation':
      return await applyManagerResignation(db, entityId);
    case 'political_decree':
      return await applyPoliticalDecree(db, entityId, narrativeText);
    default:
      // retirement_announcement + feud_declaration are narrative-only by
      // design — no structural mutation in v1.
      return {
        applied: false,
        reason: 'no_structural_consequence_for_kind',
        meta: { dramaKind },
      };
  }
}
