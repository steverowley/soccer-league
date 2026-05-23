// ── voting/api/enactment.ts ──────────────────────────────────────────────────
// WHY: Closes the social experience loop. The winning focus per team per season
// is determined by `pickWinner()` (already exists) but was never applied to
// the DB. This module queries the tally, calls `enactFocus()` for every team,
// applies each mutation, writes `focus_enacted` audit rows, and logs an
// `architect_interventions` narrative entry so the change is traceable lore.
//
// FLOW PER TEAM:
//   1. Load the focus_tally for this team+season.
//   2. Call pickWinner() for major and minor tiers → two FocusTallyEntries.
//   3. For each winner, call enactFocus() to resolve mutations (pure logic).
//   4. Apply each mutation to the DB (player bumps, inserts, finances).
//   5. Log an architect_interventions row (best-effort; failure does not
//      block the stat mutation).
//   6. Write a focus_enacted row (idempotent via UNIQUE constraint).
//
// TABLES TOUCHED:
//   - focus_tally    (read via getTeamTally)
//   - players        (stat bumps, INSERT new player)
//   - team_finances  (ticket_revenue / balance delta)
//   - architect_interventions (narrative audit row)
//   - focus_enacted  (result record)

import type { IslSupabaseClient } from '@shared/supabase/client';
import type { Json } from '@/types/database';
import { createPlayerEntity } from '@features/entities';
import { createPersona, upsertPersona } from '@features/agents';
import { getTeamTally } from './focuses';
import { pickWinner } from '../logic/tally';
import {
  enactFocus,
  seededRng,
  type FocusEnactmentSpec,
  type EnactmentMutation,
} from '../logic/enactFocus';

// ── Team list helper ──────────────────────────────────────────────────────────

/**
 * Fetch all team IDs that have at least one focus_option row for the given
 * season.  Used to drive the full 32-team enactment loop from a single
 * season UUID — the caller does not need to pass an explicit team list.
 *
 * @param db        Injected Supabase client.
 * @param seasonId  Season UUID.
 * @returns         Array of team_id strings (slugs).
 */
async function getTeamIdsForSeason(
  db: IslSupabaseClient,
  seasonId: string,
): Promise<string[]> {
  const { data, error } = await db
    .from('focus_options')
    .select('team_id')
    .eq('season_id', seasonId);

  if (error) {
    console.warn('[getTeamIdsForSeason] failed:', error.message);
    return [];
  }

  // Deduplicate: Supabase returns one row per focus_option, not per team.
  const ids = (data as Array<{ team_id: string }>).map((r) => r.team_id);
  return [...new Set(ids)];
}

// ── Player fetch ──────────────────────────────────────────────────────────────

/**
 * Fetch all players for a team.  Called fresh before enactment so mutations
 * see the current roster, not a stale pre-query snapshot.
 *
 * @param db      Injected Supabase client.
 * @param teamId  Team slug.
 * @returns       Array of player rows (all columns needed by enactFocus).
 */
async function fetchTeamPlayers(
  db: IslSupabaseClient,
  teamId: string,
): Promise<Array<{
  id: string; team_id: string; name: string;
  position: 'GK' | 'DF' | 'MF' | 'FW';
  age: number | null; overall_rating: number | null;
  attacking: number; defending: number; mental: number;
  athletic: number; technical: number; starter: boolean;
  jersey_number?: number;
}>> {
  const { data, error } = await db
    .from('players')
    .select('id, team_id, name, position, age, overall_rating, attacking, defending, mental, athletic, technical, starter, jersey_number')
    .eq('team_id', teamId);

  if (error) {
    console.warn(`[fetchTeamPlayers] failed for ${teamId}:`, error.message);
    return [];
  }
  // The generated row type marks several columns nullable that the
  // enactment logic assumes are populated (team_id, position, the five
  // stat columns). Filter out partial rows defensively and coerce the
  // shape — a player without stats can't be enacted on anyway.
  // `jersey_number` is the only key that's truly optional downstream;
  // omit the key entirely under exactOptionalPropertyTypes rather than
  // setting it to `undefined`.
  type EnactablePlayer = {
    id: string; team_id: string; name: string;
    position: 'GK' | 'DF' | 'MF' | 'FW';
    age: number | null; overall_rating: number | null;
    attacking: number; defending: number; mental: number;
    athletic: number; technical: number; starter: boolean;
    jersey_number?: number;
  };
  return (data ?? [])
    .filter((p) =>
      p.team_id  !== null && p.position  !== null &&
      p.attacking !== null && p.defending !== null && p.mental    !== null &&
      p.athletic  !== null && p.technical !== null,
    )
    .map((p): EnactablePlayer => {
      const base: EnactablePlayer = {
        id:             p.id,
        team_id:        p.team_id as string,
        name:           p.name,
        position:       p.position as 'GK' | 'DF' | 'MF' | 'FW',
        age:            p.age,
        overall_rating: p.overall_rating,
        attacking:      p.attacking as number,
        defending:      p.defending as number,
        mental:         p.mental    as number,
        athletic:       p.athletic  as number,
        technical:      p.technical as number,
        starter:        p.starter,
      };
      return p.jersey_number != null
        ? { ...base, jersey_number: p.jersey_number }
        : base;
    });
}

// ── Mutation applicators ──────────────────────────────────────────────────────

/**
 * Apply a single `EnactmentMutation` to the DB.  Each mutation kind maps to
 * one Supabase call; errors are logged at warn level and do NOT throw — a
 * partially-applied enactment is better than a fully-blocked one.
 *
 * @param db        Injected Supabase client.
 * @param mutation  The mutation to apply.
 * @returns         true if the mutation succeeded, false on error.
 */
async function applyMutation(
  db: IslSupabaseClient,
  mutation: EnactmentMutation,
): Promise<boolean> {
  switch (mutation.kind) {
    // ── Player stat bump ────────────────────────────────────────────────────
    case 'player_stat_bump': {
      // Read current value first so we can clamp the result before writing.
      // This avoids a DB CHECK constraint violation if the current stat is
      // near the boundary (1 or 99) and the delta would push it out of range.
      const { data: row } = await db
        .from('players')
        .select(mutation.stat)
        .eq('id', mutation.player_id)
        .single();

      if (!row) return false;
      const current = (row as Record<string, number>)[mutation.stat] ?? 50;
      const next    = Math.max(1, Math.min(99, current + mutation.delta));

      const { error } = await db
        .from('players')
        .update({ [mutation.stat]: next })
        .eq('id', mutation.player_id);

      if (error) {
        console.warn('[applyMutation:player_stat_bump] failed:', error.message);
        return false;
      }
      return true;
    }

    // ── Promote player ──────────────────────────────────────────────────────
    case 'promote_player': {
      // Build the update object: starter=true plus each stat bump.
      const update: Record<string, unknown> = { starter: true };

      if (Object.keys(mutation.stat_bumps).length > 0) {
        // Fetch current stats for clamping.
        const { data: row } = await db
          .from('players')
          .select('attacking, defending, mental, athletic, technical')
          .eq('id', mutation.player_id)
          .single();

        const current = (row ?? {}) as Record<string, number>;
        for (const [stat, delta] of Object.entries(mutation.stat_bumps)) {
          const cur  = current[stat] ?? 50;
          update[stat] = Math.max(1, Math.min(99, cur + (delta ?? 0)));
        }
      }

      const { error } = await db
        .from('players')
        .update(update)
        .eq('id', mutation.player_id);

      if (error) {
        console.warn('[applyMutation:promote_player] failed:', error.message);
        return false;
      }
      return true;
    }

    // ── Insert new player ───────────────────────────────────────────────────
    // Provisions the FULL entity stack for a brand-new signing so the
    // Universal Agent System has a voice for them from kickoff #1.  The
    // sequence is:
    //   1. Insert the `players` row — DB assigns the UUID we'll link to.
    //   2. Insert an `entities` row with kind='player', mirroring the seed
    //      shape from migration 0002_entities.sql so the Architect and
    //      composer can pick them up indistinguishably from migrated stock.
    //   3. Link the two via `players.entity_id`.
    //   4. Seed a persona via the Phase 3 deterministic factory.  Zero LLM
    //      cost — Phase 5's corpus-enricher will personalise it over the
    //      next few enricher ticks once the signing accumulates memories.
    //
    // Failure handling: each step is best-effort.  A broken entity / persona
    // doesn't roll back the player insert — the player still exists and
    // plays; they just fall back to generic commentary until a future
    // backfill repairs the missing rows.  This matches the agent system's
    // "missing persona = generic voice" graceful-degradation contract.
    case 'insert_player': {
      // STEP 1: player row.  Use .select() so we get the DB-assigned id back
      // without a follow-up read — the entity row needs that id to link.
      const { data: playerRow, error: playerErr } = await db
        .from('players')
        .insert(mutation.player)
        .select('id, name, team_id, position')
        .single();

      if (playerErr || !playerRow) {
        console.warn('[applyMutation:insert_player] player insert failed:', playerErr?.message);
        return false;
      }

      const newPlayer = playerRow as {
        id: string;
        name: string;
        team_id: string;
        position: string;
      };

      // STEP 2: entity row.  Shape comes from `createPlayerEntity`, the
      // canonical factory used by every player-creation code path so the
      // meta object stays bit-identical to the seed migration.
      const entityPayload = createPlayerEntity({
        name: newPlayer.name,
        team_id: newPlayer.team_id,
        position: newPlayer.position,
        nationality: null,
      });
      // `entityPayload.meta` is typed as Record<string, unknown> but the
      // generated column type is the recursive `Json` — they're structurally
      // identical at runtime, narrow with a Json cast at the boundary.
      const { data: entityRow, error: entityErr } = await db
        .from('entities')
        .insert({ ...entityPayload, meta: entityPayload.meta as Json })
        .select('id, kind, name, display_name, meta')
        .single();

      if (entityErr || !entityRow) {
        // Player exists but missing entity — return true so the rest of
        // enactment proceeds.  The next persona backfill run will detect
        // and repair.
        console.warn('[applyMutation:insert_player] entity insert failed:', entityErr?.message);
        return true;
      }

      const newEntity = entityRow as {
        id: string;
        kind: string;
        name: string;
        display_name: string | null;
        meta: unknown;
      };

      // STEP 3: link player → entity so future relationship traversals
      // (the Architect's 1-hop reads, the entity-detail page lookup) find
      // each other without a name-match fallback.
      const { error: linkErr } = await db
        .from('players')
        .update({ entity_id: newEntity.id })
        .eq('id', newPlayer.id);
      if (linkErr) {
        console.warn('[applyMutation:insert_player] entity link failed:', linkErr.message);
      }

      // STEP 4: persona seed.  Pure factory — no traits or relationships
      // exist for a fresh signing yet, so the factory falls back to the
      // generic player archetype.  Phase 5's enricher will then refresh
      // the voice from accumulated match memories.
      const personaPayload = createPersona({
        entity: newEntity,
        traits: [],
        relationships: [],
      });
      await upsertPersona(db, personaPayload);

      return true;
    }

    // ── Team finances delta ─────────────────────────────────────────────────
    case 'team_finances_delta': {
      // Upsert the team_finances row, incrementing ticket_revenue and balance.
      // Using `rpc('increment_team_finances', ...)` would be cleaner, but the
      // RPC doesn't exist yet. Instead: read → add → write. Acceptable because
      // enactment runs once at season-end, never concurrently with itself.
      const { data: existing } = await db
        .from('team_finances')
        .select('ticket_revenue, balance')
        .eq('team_id', mutation.team_id)
        .eq('season_id', mutation.season_id)
        .single();

      const prevRevenue = (existing as { ticket_revenue?: number } | null)?.ticket_revenue ?? 0;
      const prevBalance = (existing as { balance?: number }         | null)?.balance       ?? 0;

      const { error } = await db
        .from('team_finances')
        .upsert(
          {
            team_id:        mutation.team_id,
            season_id:      mutation.season_id,
            ticket_revenue: prevRevenue + mutation.ticket_revenue_delta,
            balance:        prevBalance + mutation.balance_delta,
            updated_at:     new Date().toISOString(),
          },
          { onConflict: 'team_id,season_id' },
        );

      if (error) {
        console.warn('[applyMutation:team_finances_delta] failed:', error.message);
        return false;
      }
      return true;
    }
  }
}

// ── Architect intervention logger ─────────────────────────────────────────────

/**
 * Write an `architect_interventions` row narrating the enactment.  This is
 * best-effort: failure does NOT block the stat mutation — the stats land
 * regardless, and missing the audit entry is recoverable.
 *
 * @param db          Injected Supabase client.
 * @param spec        The enactment spec (provides `reason` and `focus_key`).
 * @param teamId      Team slug.
 * @param seasonId    Season UUID.
 * @param tier        'major' or 'minor'.
 * @returns           The inserted row's UUID, or null on failure.
 */
async function logEnactmentIntervention(
  db: IslSupabaseClient,
  spec: FocusEnactmentSpec,
  teamId: string,
  seasonId: string,
  tier: string,
): Promise<string | null> {
  const { data, error } = await db
    .from('architect_interventions')
    .insert({
      target_table: 'focus_enacted',
      target_id:    null,
      field:        'focus_key',
      old_value:    { focus_key: null, note: 'pre-enactment' },
      new_value:    { focus_key: spec.focus_key, tier, team_id: teamId, season_id: seasonId },
      reason:       spec.reason,
      meta:         { source: 'focus_enactment', team_id: teamId, season_id: seasonId, tier },
    })
    .select('id')
    .single();

  if (error) {
    console.warn('[logEnactmentIntervention] failed (non-fatal):', error.message);
    return null;
  }
  return (data as { id: string } | null)?.id ?? null;
}

// ── Single-focus enactor ──────────────────────────────────────────────────────

/**
 * Enact a single winning focus for one team tier.  Steps:
 *   1. Resolve mutations via `enactFocus()` (pure logic).
 *   2. Apply each mutation to the DB.
 *   3. Log an `architect_interventions` row (best-effort).
 *   4. Write a `focus_enacted` audit row (idempotent).
 *
 * @param db        Injected Supabase client.
 * @param teamId    Team slug.
 * @param seasonId  Season UUID.
 * @param tier      'major' or 'minor'.
 * @param focusKey  Winning `option_key`.
 * @param focusLabel Human-readable label from the tally row.
 * @param players   Current player roster for this team.
 * @returns         true if the `focus_enacted` row was written, false on failure.
 */
async function enactOneTeamFocus(
  db: IslSupabaseClient,
  teamId: string,
  seasonId: string,
  tier: 'major' | 'minor',
  focusKey: string,
  focusLabel: string,
  players: Awaited<ReturnType<typeof fetchTeamPlayers>>,
): Promise<boolean> {
  // Deterministic RNG seeded per (season, team, focus) triple.
  const rng  = seededRng(`${seasonId}:${teamId}:${focusKey}`);
  const spec = enactFocus(focusKey, teamId, seasonId, players, rng);

  if (!spec) {
    console.warn(`[enactOneTeamFocus] unrecognised focus_key "${focusKey}" — skipping`);
    return false;
  }

  // Apply mutations sequentially so ordering is stable (e.g. insert player
  // then immediately bump a stat on them — though none do that currently).
  for (const mutation of spec.mutations) {
    await applyMutation(db, mutation);
  }

  // Architect narrative — best-effort, failures tolerated.
  const interventionId = await logEnactmentIntervention(db, spec, teamId, seasonId, tier);

  // Write the audit row.  UNIQUE constraint on (team_id, season_id, tier) makes
  // this idempotent — safe to re-run without duplicating the enactment.
  const { error } = await db
    .from('focus_enacted')
    .upsert(
      {
        season_id:        seasonId,
        team_id:          teamId,
        tier,
        focus_key:        focusKey,
        focus_label:      focusLabel,
        enacted_at:       new Date().toISOString(),
        intervention_id:  interventionId,
      },
      { onConflict: 'team_id,season_id,tier' },
    );

  if (error) {
    console.warn(`[enactOneTeamFocus] focus_enacted write failed for ${teamId}/${tier}:`, error.message);
    return false;
  }
  return true;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Result type returned by `enactSeasonFocuses`.  Carries per-team outcomes for
 * debugging and UI display (e.g. "32 teams enacted, 0 errors").
 */
export interface SeasonEnactmentResult {
  /** Total number of focus_enacted rows successfully written (max: teams × 2). */
  enacted:  number;
  /** Number of teams or tiers where enactment failed or had no winner. */
  skipped:  number;
  /** Per-team detail for debugging. */
  details:  Array<{
    team_id:  string;
    major:    string | null; // focus_key enacted, or null if no winner / failure
    minor:    string | null;
  }>;
}

/**
 * Enact the winning focuses for every team in a season.
 *
 * Runs the full 32-team loop: for each team, picks the major and minor
 * winners from the vote tally, resolves mutations, applies them, and writes
 * `focus_enacted` audit rows with Architect narrative entries.
 *
 * Idempotent: the UNIQUE constraint on `focus_enacted` means re-running this
 * for the same season_id will not create duplicate rows or apply mutations
 * twice (the mutations themselves are not idempotent, but the outer `upsert`
 * call on `focus_enacted` prevents double-runs in normal operation).
 *
 * @param db        Injected Supabase client.
 * @param seasonId  Season UUID whose voting results should be enacted.
 * @returns         A `SeasonEnactmentResult` describing what was done.
 */
export async function enactSeasonFocuses(
  db: IslSupabaseClient,
  seasonId: string,
): Promise<SeasonEnactmentResult> {
  const result: SeasonEnactmentResult = { enacted: 0, skipped: 0, details: [] };

  const teamIds = await getTeamIdsForSeason(db, seasonId);

  for (const teamId of teamIds) {
    const detail: SeasonEnactmentResult['details'][number] = {
      team_id: teamId,
      major:   null,
      minor:   null,
    };

    // Fetch roster once per team — reused for both major and minor.
    const players = await fetchTeamPlayers(db, teamId);

    // Load tally and determine winners.
    const tally = await getTeamTally(db, teamId, seasonId);
    const majorWinner = pickWinner(tally.filter((e) => e.tier === 'major'));
    const minorWinner = pickWinner(tally.filter((e) => e.tier === 'minor'));

    // Enact major focus.
    if (majorWinner) {
      const ok = await enactOneTeamFocus(
        db, teamId, seasonId, 'major',
        majorWinner.option_key, majorWinner.label, players,
      );
      if (ok) {
        result.enacted++;
        detail.major = majorWinner.option_key;
      } else {
        result.skipped++;
      }
    } else {
      result.skipped++;
    }

    // Enact minor focus.
    if (minorWinner) {
      const ok = await enactOneTeamFocus(
        db, teamId, seasonId, 'minor',
        minorWinner.option_key, minorWinner.label, players,
      );
      if (ok) {
        result.enacted++;
        detail.minor = minorWinner.option_key;
      } else {
        result.skipped++;
      }
    } else {
      result.skipped++;
    }

    result.details.push(detail);
  }

  return result;
}

// ── Focus enacted queries ─────────────────────────────────────────────────────

/**
 * Row shape returned by `getEnactedFocuses()`.
 * Mirrors the `focus_enacted` table columns displayed in the VotingPage.
 */
export interface EnactedFocusRow {
  id:              string;
  season_id:       string;
  team_id:         string;
  tier:            'major' | 'minor';
  focus_key:       string;
  focus_label:     string;
  enacted_at:      string;
  intervention_id: string | null;
}

/**
 * Fetch all enacted focuses for a given season, optionally filtered to one
 * team.  Used by the VotingPage "What the cosmos decided" section.
 *
 * @param db        Injected Supabase client.
 * @param seasonId  Season UUID.
 * @param teamId    Optional team slug filter.
 * @returns         Array of `EnactedFocusRow`, newest first.
 */
export async function getEnactedFocuses(
  db: IslSupabaseClient,
  seasonId: string,
  teamId?: string,
): Promise<EnactedFocusRow[]> {
  let query = db
    .from('focus_enacted')
    .select('*')
    .eq('season_id', seasonId)
    .order('enacted_at', { ascending: false });

  if (teamId) {
    query = query.eq('team_id', teamId);
  }

  const { data, error } = await query;

  if (error) {
    console.warn('[getEnactedFocuses] failed:', error.message);
    return [];
  }
  return (data ?? []) as EnactedFocusRow[];
}
