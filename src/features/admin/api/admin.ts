// ── features/admin/api/admin.ts ──────────────────────────────────────────────
// Supabase queries + mutations powering the /admin testing tooling.
//
// WHAT THIS MODULE OWNS
//   • `getActiveSeason`             — current season row + config.
//   • `getAdminFixtures`            — paginated match rows for the fixture browser.
//   • `getArchitectInterventions`   — recent architect_interventions rows.
//   • `fastForwardScheduledMatches` — bumps the worker's effective clock.
//   • `triggerSeasonEnactment`      — fires the enactment pipeline manually.
//
// WHAT IT DOES NOT DO
//   • No business logic — the season-completion rule lives in
//     features/match/logic/seasonLifecycle.ts.
//   • No allowlist enforcement — the route + UI gate that.  Server-side
//     enforcement still relies on RLS at the matches/seasons tables.

import type { IslSupabaseClient } from '@shared/supabase/client';

// TYPE ESCAPE HATCH — same pattern as betting/api/oddsRepo.ts (CAST:*).
// The `seasons.status` column from migration 0014 isn't yet in
// src/types/database.ts; the cast removes it from the strict typing path
// without disabling type-checks on the rest of the file.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Milliseconds in one hour.  Centralised so the fast-forward arithmetic
 * uses a named constant instead of an inline `3_600_000` magic number.
 */
const MS_PER_HOUR = 3_600_000;

// ── Public types ─────────────────────────────────────────────────────────────

/**
 * Summary returned by `fastForwardScheduledMatches`.  Surfaces the matched
 * row count so the admin UI can confirm the action did something rather
 * than silently no-op when no scheduled matches exist.
 */
export interface FastForwardResult {
  /** How many scheduled rows had their `scheduled_at` shifted backwards. */
  matchesShifted: number;
  /** The hour offset applied — echoed back so the UI can label the toast. */
  hoursShifted:   number;
}

/**
 * Summary returned by `triggerSeasonEnactment`.  Mirrors the upstream
 * `SeasonEnactmentResult` shape but kept narrow here so admin UI doesn't
 * have to reach into the voting feature's internal types.
 */
export interface TriggerEnactmentResult {
  /** Number of (team, tier) focuses successfully enacted. */
  enacted:  number;
  /** Number of (team, tier) focuses skipped (already enacted, no votes, …). */
  skipped:  number;
}

// ── Fast-forward ─────────────────────────────────────────────────────────────

/**
 * Shift every scheduled match's `scheduled_at` backward by `hours`.
 *
 * The match worker already polls for `status='scheduled' AND scheduled_at <=
 * now()`, so subtracting from `scheduled_at` is functionally identical to
 * advancing the worker's wall clock — without any worker-side changes.
 *
 * Negative or zero `hours` is a no-op (safer than throwing): an admin who
 * accidentally types `-5` doesn't push fixtures into the future where they
 * disappear from the queue.
 *
 * @param db     Service-role client (RLS denies anon updates to matches).
 * @param hours  Positive number of hours to roll back.
 * @returns      The number of rows shifted plus the hours used.
 */
export async function fastForwardScheduledMatches(
  db:    IslSupabaseClient,
  hours: number,
): Promise<FastForwardResult> {
  if (!Number.isFinite(hours) || hours <= 0) {
    return { matchesShifted: 0, hoursShifted: 0 };
  }

  // ── Step 1: pull every scheduled row with a non-null scheduled_at ───────
  // We need the existing values to compute new timestamps client-side —
  // PostgREST has no `UPDATE … SET col = col - interval` shortcut without
  // an SQL function.  At ~250 rows per season the round trip is cheap.
  const { data: rows, error: readErr } = await (db as AnyDb)
    .from('matches')
    .select('id, scheduled_at')
    .eq('status', 'scheduled')
    .not('scheduled_at', 'is', null);

  if (readErr) {
    console.warn('[fastForwardScheduledMatches] read failed:', readErr.message);
    return { matchesShifted: 0, hoursShifted: hours };
  }

  const matches = (rows ?? []) as Array<{ id: string; scheduled_at: string }>;
  if (matches.length === 0) return { matchesShifted: 0, hoursShifted: hours };

  // ── Step 2: write each new value ───────────────────────────────────────
  // Per-row UPDATEs not a bulk one because PostgREST cannot `UPDATE …
  // FROM (VALUES …)` without an RPC.  At 250 fixtures × ~50 ms = 12.5 s
  // worst case — acceptable for a hand-fired admin button.
  const offsetMs = hours * MS_PER_HOUR;
  let shifted = 0;
  for (const m of matches) {
    const ts = Date.parse(m.scheduled_at);
    if (!Number.isFinite(ts)) continue;
    const next = new Date(ts - offsetMs).toISOString();
    const { error: writeErr } = await (db as AnyDb)
      .from('matches')
      .update({ scheduled_at: next })
      .eq('id', m.id);
    if (!writeErr) shifted++;
  }

  return { matchesShifted: shifted, hoursShifted: hours };
}

// ── Manual enactment ─────────────────────────────────────────────────────────

/**
 * Force-fire `enactSeasonFocuses` for the given season.
 *
 * The worker runs this automatically when a season's league phase finishes
 * (Package 13).  This admin-fired path is for two cases:
 *   1. Dev / test setups where the worker hasn't simulated all matches yet.
 *   2. Recovery from a transient failure that left a season stuck in
 *      `voting` after the worker's automatic transition succeeded but the
 *      enactment call itself errored.
 *
 * The function dynamically imports the voting feature's enactment API to
 * avoid a static cross-feature dependency at the barrel level — the admin
 * feature should never be a load-time blocker for the rest of the app.
 *
 * @param db        Service-role Supabase client.
 * @param seasonId  UUID of the season whose focuses should be enacted.
 * @returns         Counts of enacted vs skipped focuses.
 */
export async function triggerSeasonEnactment(
  db:        IslSupabaseClient,
  seasonId:  string,
): Promise<TriggerEnactmentResult> {
  // Lazy import: the admin feature is rarely used so we avoid pulling the
  // voting feature's full enactment graph into the main bundle on every
  // page load.  (Vite will still tree-shake unused enactment branches.)
  const { enactSeasonFocuses } = await import('@features/voting');
  const result = await enactSeasonFocuses(db, seasonId);
  return { enacted: result.enacted, skipped: result.skipped };
}

// ── Read queries ──────────────────────────────────────────────────────────────

/**
 * Shape of the active-season row returned by `getActiveSeason`.
 *
 * Intentionally narrow — the admin UI only needs the fields listed here.
 * Extending later is additive and does not break existing call sites.
 */
export interface AdminSeason {
  id:                  string;
  name:                string;
  year:                number;
  /** Lifecycle status: 'active' | 'voting' | 'completed' | 'upcoming'. */
  status:              string;
  /** ISO timestamp when league play started; null when still upcoming. */
  started_at:          string | null;
  /** ISO timestamp when league play ended; null when still in progress. */
  ended_at:            string | null;
  /** ISO timestamp when election opens; null when not yet scheduled. */
  election_opens_at:   string | null;
  /** ISO timestamp when election closes; null when not yet scheduled. */
  election_closes_at:  string | null;
  /** Real-world seconds mapped to one 90-minute game. 600 = 10 min/match. */
  match_duration_seconds: number | null;
  /** Minutes between consecutive match kickoffs in the automated schedule. */
  match_cadence_minutes:  number | null;
  /** Minimum bet allowed during this season, in Intergalactic Credits. */
  min_bet:                number | null;
}

/**
 * Fetch the currently active season together with its season_config row.
 *
 * Returns `null` when no row has `is_active = true` — callers should
 * treat null as "season not yet seeded" and show a placeholder rather
 * than throwing.
 *
 * The join to `season_config` is a left-join (PostgREST `!left`) so the
 * season row is always returned even when the config row is missing; in
 * that case the config fields arrive as null.
 *
 * @param db  Any authenticated Supabase client (public-read RLS on seasons).
 * @returns   Active season + config, or null.
 */
export async function getActiveSeason(
  db: IslSupabaseClient,
): Promise<AdminSeason | null> {
  // ── Join season_config ────────────────────────────────────────────────────
  // PostgREST expresses a left join by suffixing the FK relationship with
  // `!left`.  The config columns land in a nested object under `season_config`;
  // we spread them to flatten the shape for callers.
  const { data, error } = await (db as AnyDb)
    .from('seasons')
    .select(`
      id, name, year, status, started_at, ended_at,
      election_opens_at, election_closes_at,
      season_config!left (
        match_duration_seconds,
        match_cadence_minutes,
        min_bet
      )
    `)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    console.warn('[getActiveSeason] query failed:', error.message);
    return null;
  }
  if (!data) return null;

  // Flatten the nested season_config object so callers work with a flat row.
  const cfg = data.season_config ?? {};
  return {
    id:                  data.id,
    name:                data.name,
    year:                data.year,
    status:              data.status,
    started_at:          data.started_at,
    ended_at:            data.ended_at,
    election_opens_at:   data.election_opens_at,
    election_closes_at:  data.election_closes_at,
    match_duration_seconds: cfg.match_duration_seconds ?? null,
    match_cadence_minutes:  cfg.match_cadence_minutes  ?? null,
    min_bet:                cfg.min_bet                ?? null,
  };
}

/**
 * A single match row in the fixture browser.
 *
 * The join pulls minimal team name data so the table can display
 * "Home FC vs Away SC" without a second fetch.
 */
export interface AdminFixture {
  id:           string;
  status:       string;
  round:        string | null;
  scheduled_at: string | null;
  played_at:    string | null;
  home_score:   number | null;
  away_score:   number | null;
  home_team:    string;
  away_team:    string;
  competition:  string | null;
}

/**
 * Maximum fixtures fetched per `getAdminFixtures` call.
 *
 * 100 covers a full matchday (32 teams = 16 simultaneous matches × a few
 * rounds) without hammering the network.  The admin browser paginates by
 * status rather than by offset, so 100 is a practical ceiling rather than
 * a hard page size.
 */
const FIXTURE_FETCH_LIMIT = 100;

/**
 * Fetch the most recent / upcoming fixtures for the admin fixture browser.
 *
 * Returns up to `FIXTURE_FETCH_LIMIT` rows across all statuses, ordered
 * by `scheduled_at` ascending so the next kick-off appears first.
 * Passing `statusFilter` narrows to one status bucket (e.g. 'scheduled')
 * for the admin's status-filter chip strip.
 *
 * @param db            Any authenticated Supabase client.
 * @param statusFilter  Optional status to filter by; omit for all statuses.
 * @returns             Flat fixture list with team names inlined.
 */
export async function getAdminFixtures(
  db:            IslSupabaseClient,
  statusFilter?: string,
): Promise<AdminFixture[]> {
  // ── Build base query ──────────────────────────────────────────────────────
  // home_team and away_team arrive as nested objects from PostgREST's FK
  // resolution; we flatten them to strings in the mapping step below.
  let query = (db as AnyDb)
    .from('matches')
    .select(`
      id, status, round, scheduled_at, played_at, home_score, away_score,
      home_team:teams!matches_home_team_id_fkey ( name ),
      away_team:teams!matches_away_team_id_fkey ( name ),
      competition:competitions!matches_competition_id_fkey ( name )
    `)
    .order('scheduled_at', { ascending: true })
    .limit(FIXTURE_FETCH_LIMIT);

  if (statusFilter) {
    query = query.eq('status', statusFilter);
  }

  const { data, error } = await query;
  if (error) {
    console.warn('[getAdminFixtures] query failed:', error.message);
    return [];
  }

  return (data ?? []).map((row: {
    id: string;
    status: string;
    round: string | null;
    scheduled_at: string | null;
    played_at: string | null;
    home_score: number | null;
    away_score: number | null;
    home_team: { name: string } | null;
    away_team: { name: string } | null;
    competition: { name: string } | null;
  }) => ({
    id:           row.id,
    status:       row.status,
    round:        row.round,
    scheduled_at: row.scheduled_at,
    played_at:    row.played_at,
    home_score:   row.home_score,
    away_score:   row.away_score,
    home_team:    row.home_team?.name  ?? 'Unknown',
    away_team:    row.away_team?.name  ?? 'Unknown',
    competition:  row.competition?.name ?? null,
  }));
}

/**
 * A single row from the architect_interventions log.
 *
 * Each intervention records a mutation the Cosmic Architect made to a
 * database entity (player stat bump, referee strictness change, etc.) so
 * the admin can audit the chaos director's activity.
 */
export interface ArchitectIntervention {
  id:           string;
  /** Which table was mutated, e.g. 'players', 'matches'. */
  target_table: string;
  /** UUID of the mutated row. */
  target_id:    string;
  /** Column name that was changed; null for row-level interventions. */
  field:        string | null;
  /** Human-readable rationale the Architect emitted with the intervention. */
  reason:       string;
  /** Value before the Architect changed it (jsonb — any scalar or object). */
  old_value:    unknown;
  /** Value after the change. */
  new_value:    unknown;
  created_at:   string;
}

/**
 * How many intervention rows to fetch per page of the log viewer.
 *
 * 50 covers several rounds of matches without making the table unwieldy
 * on a single page.  The log is append-only so the most recent 50 rows
 * represent the Architect's latest activity, which is what admins care about.
 */
const INTERVENTION_FETCH_LIMIT = 50;

/**
 * Fetch the most recent Architect interventions for the admin log viewer.
 *
 * Ordered newest-first so the most dramatic recent interference appears at
 * the top of the table.  Returns an empty array (not an error) when the
 * table has no rows — new seasons always start with a clean log.
 *
 * @param db  Any authenticated Supabase client (public-read RLS applies).
 * @returns   Up to `INTERVENTION_FETCH_LIMIT` interventions, newest first.
 */
export async function getArchitectInterventions(
  db: IslSupabaseClient,
): Promise<ArchitectIntervention[]> {
  const { data, error } = await (db as AnyDb)
    .from('architect_interventions')
    .select('id, target_table, target_id, field, reason, old_value, new_value, created_at')
    .order('created_at', { ascending: false })
    .limit(INTERVENTION_FETCH_LIMIT);

  if (error) {
    console.warn('[getArchitectInterventions] query failed:', error.message);
    return [];
  }

  return (data ?? []) as ArchitectIntervention[];
}
