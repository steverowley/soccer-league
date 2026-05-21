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
 * MECHANICAL EFFECT: 'proclamation' is one of the 5 values allowed by the
 * season_decrees.decree_type CHECK constraint (see migration 0021).  Per
 * its documentation it carries NO mechanical effect — it lives as a
 * permanent lore row on the Election Night page and the news feed.  A
 * future migration can introduce a 'political_decree' type with simulator
 * hooks (cadence shift, ticket multiplier, ref-strictness modifier, etc.);
 * for v1 the lore-only commitment is enough to make the decree feel real.
 */
const POLITICAL_DECREE_DECREE_TYPE = 'proclamation';

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
 * Apply a manager_resignation consequence by detaching the resigning
 * manager from their team.  v1 sets managers.team_id = NULL; the team is
 * temporarily managerless until a future "appoint replacement" step (or
 * a manual admin action) fills the seat.
 *
 * STEPS
 *   1. Resolve the manager row by entity_id.
 *   2. Capture the team_id for logging.
 *   3. UPDATE managers SET team_id = NULL.
 *
 * @param db        Service-role Supabase client.
 * @param entityId  Entity ID of the drama subject.
 * @returns         Outcome summary.
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

  const { error: updateErr } = await db
    .from('managers')
    .update({ team_id: null })
    .eq('id', manager.id);

  if (updateErr) {
    return {
      applied: false,
      reason: 'update_failed',
      meta: { entityId, message: updateErr.message },
    };
  }

  return {
    applied: true,
    reason: 'resigned',
    meta: { entityId, formerTeam: manager.team_id },
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

  // STEP 3: insert.  No player_id / team_id targets — political decrees
  // address the league as a whole at this layer.
  const { error: insertErr } = await db.from('season_decrees').insert({
    season_id: seasonId,
    decree_type: POLITICAL_DECREE_DECREE_TYPE,
    text: narrativeText,
    sequence_order: nextOrder,
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
    meta: { entityId, seasonId, sequenceOrder: nextOrder },
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
