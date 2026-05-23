// ── features/admin/api/admin.ts ──────────────────────────────────────────────
// Supabase queries + mutations powering the /admin testing tooling.
//
// SERVER-SIDE GATING (migration 0042)
//   Every mutating call below routes through a SECURITY DEFINER RPC whose
//   first action is to RAISE EXCEPTION when the caller's `profiles.is_admin`
//   is not true.  The AdminAccessGate component is a UX convenience — the
//   DB is the real boundary.  A non-admin who calls these wrappers (or hits
//   the RPCs directly via supabase-js) gets SQLSTATE 28000 / HTTP 403.

import type { IslSupabaseClient } from '@shared/supabase/client';
import { bus, type IslEventBus } from '@shared/events/bus';

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
 * The match worker polls for `status='scheduled' AND scheduled_at <= now()`,
 * so subtracting from `scheduled_at` is functionally identical to advancing
 * the worker's wall clock — without any worker-side changes.
 *
 * IMPLEMENTATION (post-migration 0042)
 *   Calls the `admin_fast_forward_matches(p_hours)` SECURITY DEFINER RPC.
 *   The RPC re-checks `profiles.is_admin = true` (so a non-admin who hits
 *   the endpoint directly gets SQLSTATE 28000), then runs a single bulk
 *   UPDATE with native interval arithmetic — eliminating the per-row N+1
 *   that the previous client-side implementation needed.
 *
 * Negative or zero `hours` is treated as a no-op locally (the RPC would
 * RAISE), keeping the toast-friendly result shape for the admin UI.
 *
 * @param db     Authenticated Supabase client.  Caller must be an admin —
 *               the RPC enforces this, the UI does not.
 * @param hours  Positive number of hours to roll back.
 * @returns      `{ matchesShifted, hoursShifted }` so the admin toast can
 *               distinguish a successful zero-row shift ("nothing to do")
 *               from a real workload.
 */
export async function fastForwardScheduledMatches(
  db:    IslSupabaseClient,
  hours: number,
): Promise<FastForwardResult> {
  // Local guard: keep the no-op semantics from the prior implementation so
  // an admin typo (`0` or `-5`) reports "nothing shifted" instead of an
  // SQLSTATE 22023 error toast.
  if (!Number.isFinite(hours) || hours <= 0) {
    return { matchesShifted: 0, hoursShifted: 0 };
  }

  const { data, error } = await db.rpc('admin_fast_forward_matches', {
    p_hours: hours,
  });
  if (error) throw new Error(error.message);

  // The RPC returns the bulk UPDATE's ROW_COUNT as a single integer.
  return { matchesShifted: (data as number) ?? 0, hoursShifted: hours };
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

/**
 * Result returned by triggerElectionNight — counts for the admin UI.
 *
 * `incinerated` is the realised count from idol-weighted permadeath; the
 * intended count is computed inside runElectionNight from the active
 * roster and not exposed here. `decrees` is the total written, including
 * arrival narratives for the replacement players.
 */
export interface TriggerElectionNightResult {
  /** Number of players actually incinerated this election. */
  incinerated: number;
  /** Number of decree rows written (focus + incineration + arrival). */
  decrees:     number;
}

/**
 * Run the full Election Night ritual for a season (#372).
 *
 * Previously `runElectionNight` was exported from the voting barrel but
 * had no caller — Election Night was dark code. The fan-facing experience
 * was identical regardless of whether the cosmos had executed its idol-
 * weighted incinerations, written its decrees, or filed its arrivals.
 * This admin path is the single legitimate entry point.
 *
 * Idempotency: caller MUST guard via `seasons.status` before invoking —
 * runElectionNight is NOT itself idempotent. The Admin UI's "Close Season"
 * action checks status='voting' before calling. Subsequent calls on a
 * season already at status='completed' are a programming error.
 *
 * @param db          Service-role / admin Supabase client.
 * @param seasonId    UUID of the season being closed.
 * @param seasonName  Human-readable label (e.g. "Season 4 — 2603").
 * @returns           Realised counts for the admin UI's toast.
 */
export async function triggerElectionNight(
  db:         IslSupabaseClient,
  seasonId:   string,
  seasonName: string,
): Promise<TriggerElectionNightResult> {
  // Lazy import for the same reason as triggerSeasonEnactment above —
  // the orchestrator pulls in heavy enactment + decree logic that the
  // public app shouldn't pay for in its initial bundle.
  const { runElectionNight } = await import('@features/voting');
  const result = await runElectionNight(db, seasonId, seasonName);
  return {
    incinerated: result.incinerationsCount ?? 0,
    decrees:     result.decreesWritten     ?? 0,
  };
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
  const { data, error } = await db
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

  // Flatten the nested season_config object so callers work with a flat
  // row. PostgREST left-joins return the nested object as null when no
  // matching config row exists; treat that as "all knobs unset" rather
  // than crashing.
  const cfg = data.season_config;
  return {
    id:                  data.id,
    name:                data.name,
    year:                data.year,
    status:              data.status,
    started_at:          data.started_at,
    ended_at:            data.ended_at,
    election_opens_at:   data.election_opens_at,
    election_closes_at:  data.election_closes_at,
    match_duration_seconds: cfg?.match_duration_seconds ?? null,
    match_cadence_minutes:  cfg?.match_cadence_minutes  ?? null,
    min_bet:                cfg?.min_bet                ?? null,
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
  let query = db
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
  const { data, error } = await db
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

// ── System stats ──────────────────────────────────────────────────────────────

/** Aggregate metrics shown in the System Stats bar at the top of the admin page. */
export interface SystemStats {
  totalUsers:       number;
  totalCredits:     number;
  openWagers:       number;
  completedMatches: number;
}

/**
 * Fetch four cross-table aggregate metrics in parallel.
 *
 * Uses `count: 'exact'` + `head: true` (HTTP HEAD) for the count-only
 * queries so Supabase doesn't stream row data we don't need.
 *
 * @param db  Any authenticated Supabase client.
 */
export async function getSystemStats(db: IslSupabaseClient): Promise<SystemStats> {
  const [usersRes, creditsRes, wagersRes, matchesRes] = await Promise.all([
    db.from('profiles').select('id', { count: 'exact', head: true }),
    db.from('profiles').select('credits'),
    db.from('wagers').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    db.from('matches').select('id', { count: 'exact', head: true }).eq('status', 'completed'),
  ]);
  const credits = (creditsRes.data ?? []).reduce(
    (sum: number, r: { credits: number }) => sum + (r.credits ?? 0),
    0,
  );
  return {
    totalUsers:       usersRes.count        ?? 0,
    totalCredits:     credits,
    openWagers:       wagersRes.count        ?? 0,
    completedMatches: matchesRes.count       ?? 0,
  };
}

// ── Season status mutations ───────────────────────────────────────────────────

/**
 * Set the active season's lifecycle status.
 *
 * Side effects (applied inside the RPC, not here):
 *   - `voting`    → stamps `election_opens_at`  with now().
 *   - `completed` → stamps `election_closes_at` with now().
 *
 * IMPLEMENTATION (post-migration 0042)
 *   Calls `admin_set_season_status(p_season_id, p_status)`.  The RPC
 *   enforces `profiles.is_admin = true` server-side; a non-admin caller
 *   sees SQLSTATE 28000 (HTTP 403) regardless of UI gating.
 *
 * @param db        Authenticated Supabase client.  Caller must be admin.
 * @param seasonId  UUID of the target season.
 * @param status    New status value.  Validated against the three legal
 *                  transitions inside the RPC (anything else → SQLSTATE 22023).
 */
export async function setSeasonStatus(
  db:       IslSupabaseClient,
  seasonId: string,
  status:   'active' | 'voting' | 'completed',
): Promise<void> {
  const { error } = await db.rpc('admin_set_season_status', {
    p_season_id: seasonId,
    p_status:    status,
  });
  if (error) throw new Error(error.message);
}

// ── Season reset RPC ──────────────────────────────────────────────────────────

/**
 * Call the `admin_reset_season` SQL function (migration 0023).
 *
 * The function wipes all transient/result data (events, wagers, narratives,
 * etc.) and reschedules every match starting 5 minutes from now, preserving
 * relative spacing.
 *
 * @param db  Service-role client (the function is SECURITY DEFINER but is still
 *            gated by the admin UI; anon callers hit RLS before reaching it).
 */
export async function resetSeasonResults(db: IslSupabaseClient): Promise<{ matchesReset: number }> {
  const { data, error } = await db.rpc('admin_reset_season');
  if (error) throw new Error(error.message);
  return { matchesReset: (data as { matches_reset: number }).matches_reset ?? 0 };
}

// ── Narrative injection ───────────────────────────────────────────────────────

/**
 * Insert a single narrative row into the `narratives` table with `source='admin'`.
 *
 * The row appears immediately in the Galaxy Dispatch feed.  There is no
 * undo — the admin must delete the row directly from the DB if they make a
 * mistake.
 *
 * IMPLEMENTATION (post-migration 0042)
 *   Calls `admin_inject_narrative(p_kind, p_summary)`.  Direct INSERT was
 *   removed by migration 0030 (`narratives_auth_write` dropped); the RPC
 *   is the only authenticated write path and enforces `is_admin = true`.
 *
 * @param db      Authenticated Supabase client.  Caller must be admin.
 * @param kind    One of the narrative kinds recognised by the Dispatch feed.
 *                Empty / null is rejected inside the RPC (SQLSTATE 22023).
 * @param summary Human-readable narrative text.  Empty / null is rejected.
 */
export async function injectNarrative(
  db:      IslSupabaseClient,
  kind:    string,
  summary: string,
): Promise<void> {
  const { error } = await db.rpc('admin_inject_narrative', {
    p_kind:    kind,
    p_summary: summary,
  });
  if (error) throw new Error(error.message);
}

// ── Player creation ───────────────────────────────────────────────────────────

/** Input shape for the Add Player form. */
export interface AddPlayerInput {
  teamId:        string;
  name:          string;
  position:      string;
  overallRating: number;
  starter:       boolean;
  jerseyNumber:  number | null;
}

/**
 * Insert a new player row into the `players` table.
 *
 * IMPLEMENTATION (post-migration 0042)
 *   Calls `admin_add_player(...)`.  The RPC is the only authenticated write
 *   path to `players` and enforces `is_admin = true` server-side.  Derived
 *   stat columns (attacking, defending, mental, athletic, technical) are
 *   seeded from `overallRating` inside the RPC body so the match engine has
 *   a consistent starting point regardless of which client path created the
 *   row.  Coaching can refine those five via the training facility later.
 *
 * @param db     Authenticated Supabase client.  Caller must be admin.
 * @param input  Form-sourced player data.  `overallRating` is range-checked
 *               inside the RPC (1..99); jerseyNumber may be null.
 */
export async function addPlayer(
  db:    IslSupabaseClient,
  input: AddPlayerInput,
): Promise<void> {
  // The RPC's `p_jersey_number INTEGER` accepts NULL at the Postgres
  // level (Supabase typegen forces it non-null in the generated `Args`
  // shape, which doesn't reflect SQL nullability). Cast the args literal
  // so a null jersey reaches the RPC as SQL NULL instead of being
  // silently coerced to 0.
  const { error } = await db.rpc('admin_add_player', {
    p_team_id:        input.teamId,
    p_name:           input.name,
    p_position:       input.position,
    p_overall_rating: input.overallRating,
    p_starter:        input.starter,
    p_jersey_number:  input.jerseyNumber as number,
  });
  if (error) throw new Error(error.message);
}

// ── Manual match completion ──────────────────────────────────────────────────

/**
 * Lower bound for a valid score input on the manual-completion form.
 *
 * Negative scores are not a real-world soccer concept — a typo of `-1` should
 * surface as a validation error rather than silently corrupt the fixture row.
 */
const MIN_SCORE = 0;

/**
 * Upper bound for a valid score input on the manual-completion form.
 *
 * 99 covers any realistic scoreline (record real-world wins land in the 30s)
 * while still trapping obvious typos like a stray `200` from a misclicked
 * number-stepper.  Picked generously rather than tightly because exotic
 * Architect-influenced scorelines are gameplay-legal — see
 * `gameEngine.smoke.test.ts` for the wider distribution the engine can emit.
 */
const MAX_SCORE = 99;

/**
 * Shape returned by {@link completeMatchManually} on success.  Echoes the
 * inputs back so the caller can keep its toast / UI state up to date without
 * re-deriving them.
 */
export interface CompleteMatchManuallyResult {
  /** UUID of the match row that was completed. */
  matchId:    string;
  /** Final home score written to the row. */
  homeScore:  number;
  /** Final away score written to the row. */
  awayScore:  number;
}

/**
 * Manually mark a match as `completed`, write the final scores, and emit
 * `match.completed` on the in-app event bus so the standard side-effect
 * listeners fire (`WagerSettlementListener`, `CupRoundAdvancerListener`,
 * `RefereeNarrativeListener`, `MemoryWriteListener`).
 *
 * Used by the admin Fixture Browser's per-row "Complete" affordance so an
 * operator can drive a dev/test season forward without waiting for the
 * worker to simulate every fixture in real time.  The match-worker takes
 * the same final step (`status='completed'` UPDATE) when a real simulation
 * finishes — this function is therefore a parallel, manually-triggered
 * shortcut that produces the same downstream state.
 *
 * IMPLEMENTATION (post-migration 0042)
 *   The DB write is now routed through the `admin_complete_match` SECURITY
 *   DEFINER RPC, which:
 *     1. Verifies `profiles.is_admin = true` (SQLSTATE 28000 if not).
 *     2. Re-runs the input range checks server-side (defence-in-depth so
 *        the client wrapper isn't the only validator).
 *     3. Looks up the match row and enforces the cup-draw guard inside the
 *        same transaction as the UPDATE (no read/write race possible).
 *     4. Applies the same `status='scheduled'` optimistic-concurrency guard
 *        and surfaces a 40001 SQLSTATE when another writer beat us to it.
 *     5. Returns the team ids + competition id alongside the input echo so
 *        the bus emission below has the full payload without an extra read.
 *
 * BUS PAYLOAD
 *   The RPC return value supplies `home_team_id`, `away_team_id`, and
 *   `competition_id`.  We emit the full {@link MatchCompletedPayload} so
 *   downstream listeners (cup advancement, referee narratives, memory
 *   writes) destructure the same shape they get from the worker-side
 *   emission path.
 *
 * EXACTLY-ONCE EMISSION
 *   We only emit the bus event after the RPC resolves successfully.  Any
 *   RAISE EXCEPTION inside the function (validation, missing row, cup-draw,
 *   stale row) surfaces as a thrown error and short-circuits the emit —
 *   keeping the WagerSettlementListener and CupRoundAdvancerListener from
 *   firing for a write that never committed.
 *
 * ERRORS
 *   - Throws synchronously when `matchId` is empty / non-string or scores
 *     are out of range (cheap client guard, RPC has its own copy).
 *   - Throws with the RPC's `message` for: missing match, cup-draw block,
 *     stale row (status no longer 'scheduled'), and non-admin caller.
 *
 * @param db          Authenticated Supabase client.  Caller must be admin.
 * @param matchId     UUID of the target match.
 * @param homeScore   Final home score in `[MIN_SCORE, MAX_SCORE]`.
 * @param awayScore   Final away score in `[MIN_SCORE, MAX_SCORE]`.
 * @param busOverride Optional bus instance for tests; defaults to the app
 *                    singleton.  Production callers should not pass this.
 * @returns           `{ matchId, homeScore, awayScore }` on success.
 */
export async function completeMatchManually(
  db:           IslSupabaseClient,
  matchId:      string,
  homeScore:    number,
  awayScore:    number,
  busOverride:  IslEventBus = bus,
): Promise<CompleteMatchManuallyResult> {
  // ── Step 1: client-side input validation ──────────────────────────────────
  // Cheap synchronous checks fail fast before round-tripping to PostgREST.
  // The RPC re-runs identical checks server-side so a programmatic caller
  // bypassing this wrapper still hits the same constraints.
  if (typeof matchId !== 'string' || matchId.length === 0) {
    throw new Error('completeMatchManually: matchId is required');
  }
  if (!Number.isInteger(homeScore) || homeScore < MIN_SCORE || homeScore > MAX_SCORE) {
    throw new Error(
      `completeMatchManually: homeScore must be an integer in [${MIN_SCORE}, ${MAX_SCORE}] (got ${homeScore})`,
    );
  }
  if (!Number.isInteger(awayScore) || awayScore < MIN_SCORE || awayScore > MAX_SCORE) {
    throw new Error(
      `completeMatchManually: awayScore must be an integer in [${MIN_SCORE}, ${MAX_SCORE}] (got ${awayScore})`,
    );
  }

  // ── Step 2: invoke the SECURITY DEFINER RPC ──────────────────────────────
  // Atomic: gate-check → score validation → cup-draw guard → UPDATE with
  // optimistic concurrency, all in one transaction.  The RPC's JSON return
  // carries the bus-payload fields we need to emit without a second read.
  const { data: rpcResult, error: rpcErr } = await db.rpc(
    'admin_complete_match',
    {
      p_match_id:   matchId,
      p_home_score: homeScore,
      p_away_score: awayScore,
    },
  );
  if (rpcErr) {
    // PostgREST surfaces the RAISE EXCEPTION message verbatim — pass it
    // through so the admin UI's toast shows the same copy the RPC body
    // chose ("Cup matches cannot end in a draw …", etc.).
    throw new Error(rpcErr.message);
  }

  // ── Step 3: emit the bus event ───────────────────────────────────────────
  // Reaches all cross-feature listeners.  Synchronous — listeners run
  // inline on this microtask; their async DB work is handled inside the
  // listener bodies themselves and intentionally not awaited here.
  //
  // The RPC declares Returns: Json so the generated type is untyped at the
  // field level; we narrow to the shape that the `json_build_object` call
  // in migration 0042 emits.
  const payload = rpcResult as unknown as {
    home_team_id:    string;
    away_team_id:    string;
    competition_id:  string | null;
  };

  busOverride.emit('match.completed', {
    matchId,
    homeTeamId:    payload.home_team_id,
    awayTeamId:    payload.away_team_id,
    homeScore,
    awayScore,
    competitionId: payload.competition_id ?? '',
  });

  return { matchId, homeScore, awayScore };
}

// ── Team list ─────────────────────────────────────────────────────────────────

/**
 * Fetch a flat list of all teams (id + name + league name) for the Add Player
 * team selector.  Ordered alphabetically by team name.
 *
 * Returns an empty array on error so the form renders (with no options) rather
 * than crashing.
 *
 * @param db  Any authenticated Supabase client.
 */
export async function getTeamList(
  db: IslSupabaseClient,
): Promise<Array<{ id: string; name: string; league: string }>> {
  const { data, error } = await db
    .from('teams')
    .select('id, name, league:leagues!teams_league_id_fkey(name)')
    .order('name');
  if (error) return [];
  return (data ?? []).map((r: { id: string; name: string; league: { name: string } | null }) => ({
    id:     r.id,
    name:   r.name,
    league: r.league?.name ?? '',
  }));
}
