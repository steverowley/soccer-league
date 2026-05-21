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
import { bus, type IslEventBus } from '@shared/events/bus';

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
    (db as AnyDb).from('profiles').select('id', { count: 'exact', head: true }),
    (db as AnyDb).from('profiles').select('credits'),
    (db as AnyDb).from('wagers').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    (db as AnyDb).from('matches').select('id', { count: 'exact', head: true }).eq('status', 'completed'),
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
 * Side effects:
 *   - `voting`    → stamps `election_opens_at`  with now().
 *   - `completed` → stamps `election_closes_at` with now().
 *
 * @param db        Any authenticated Supabase client (service-role for RLS bypass).
 * @param seasonId  UUID of the target season.
 * @param status    New status value.
 */
export async function setSeasonStatus(
  db:       IslSupabaseClient,
  seasonId: string,
  status:   'active' | 'voting' | 'completed',
): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (status === 'voting')    patch.election_opens_at  = new Date().toISOString();
  if (status === 'completed') patch.election_closes_at = new Date().toISOString();
  const { error } = await (db as AnyDb).from('seasons').update(patch).eq('id', seasonId);
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
  const { data, error } = await (db as AnyDb).rpc('admin_reset_season');
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
 * @param db      Service-role client (anon INSERT is blocked by RLS).
 * @param kind    One of the five narrative kinds recognised by the Dispatch feed.
 * @param summary Human-readable narrative text.
 */
export async function injectNarrative(
  db:      IslSupabaseClient,
  kind:    string,
  summary: string,
): Promise<void> {
  const { error } = await (db as AnyDb).from('narratives').insert({
    kind,
    summary,
    source: 'admin',
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
 * Derived stat columns (attacking, defending, mental, athletic, technical) are
 * seeded from `overallRating` so the match engine has a consistent starting
 * point.  The coaching staff can refine via the training facility afterwards.
 *
 * @param db     Service-role client (RLS blocks anon INSERT on players).
 * @param input  Form-sourced player data.
 */
export async function addPlayer(
  db:    IslSupabaseClient,
  input: AddPlayerInput,
): Promise<void> {
  const { error } = await (db as AnyDb).from('players').insert({
    team_id:        input.teamId,
    name:           input.name,
    position:       input.position,
    overall_rating: input.overallRating,
    starter:        input.starter,
    jersey_number:  input.jerseyNumber,
    // Minimal stat defaults — match engine derives from overall_rating
    attacking:  input.overallRating,
    defending:  input.overallRating,
    mental:     input.overallRating,
    athletic:   input.overallRating,
    technical:  input.overallRating,
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
 * BUS PAYLOAD
 *   We fetch the match row before the update so we can populate the full
 *   {@link MatchCompletedPayload} (team ids + competition id) rather than a
 *   stripped-down `{ matchId }`.  The standard listeners destructure the
 *   richer fields (`homeTeamId`, `awayTeamId`, `competitionId`), so emitting
 *   a partial payload would silently break cup-advancement and other flows.
 *
 * EXACTLY-ONCE EMISSION
 *   The function emits exactly one bus event per successful invocation, only
 *   after the DB UPDATE returns without error.  A failed read or failed
 *   update throws before reaching the emit — no event is fired.  This keeps
 *   downstream listeners from settling wagers against a row whose update
 *   was rolled back.
 *
 * ERRORS
 *   - Throws when `matchId` is empty / non-string.
 *   - Throws when either score is non-integer or outside `[MIN_SCORE, MAX_SCORE]`.
 *   - Throws when the match row does not exist.
 *   - Throws `"Cup matches cannot end in a draw — enter a tiebreak winner"`
 *     when the match belongs to a single-elimination cup competition
 *     (`competitions.type='cup'`) and the scoreline is tied.  Knockout
 *     brackets require a decisive winner; `CupRoundAdvancerListener` would
 *     otherwise refuse to advance and the row would be `completed` while
 *     the bracket stays stuck.
 *   - Throws `"Match is no longer scheduled — refresh and try again"` when
 *     the optimistic-concurrency guard (`status='scheduled'`) misses,
 *     meaning the worker or another admin already moved the row.  No bus
 *     event is emitted in this case — preserves the exactly-once invariant
 *     for `WagerSettlementListener` + `CupRoundAdvancerListener`.
 *   - Throws when the UPDATE returns an error (RLS denial, network blip…).
 *
 * @param db          Supabase client.  Needs UPDATE rights on `matches`
 *                    (admin RLS policy or service-role).
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
  // ── Input validation ──────────────────────────────────────────────────────
  // Cheap synchronous checks fire BEFORE any DB call — a malformed call
  // shouldn't cost a network round-trip just to fail at the row level.
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

  // ── Step 1: fetch the row for the bus payload ────────────────────────────
  // We need home_team_id, away_team_id, and competition_id to populate the
  // full MatchCompletedPayload.  Using `.maybeSingle()` so a missing row
  // surfaces as `data === null` rather than a PostgREST error.
  const { data: matchRow, error: readErr } = await (db as AnyDb)
    .from('matches')
    .select('id, home_team_id, away_team_id, competition_id')
    .eq('id', matchId)
    .maybeSingle();

  if (readErr) {
    throw new Error(`completeMatchManually: read failed: ${readErr.message}`);
  }
  if (!matchRow) {
    throw new Error(`completeMatchManually: match ${matchId} not found`);
  }

  // ── Step 2: cup-match draw guard ─────────────────────────────────────────
  // `CupRoundAdvancerListener` refuses to advance the bracket on a tied
  // scoreline (knockouts need a decisive winner).  If we allowed a draw
  // through here, the match would flip to `completed` but the bracket would
  // remain stuck — a silently broken cup.  Resolve the discriminator by
  // looking up the competition's `type` column ('cup' = single-elimination).
  if (homeScore === awayScore && matchRow.competition_id) {
    const { data: comp, error: compErr } = await (db as AnyDb)
      .from('competitions')
      .select('type')
      .eq('id', matchRow.competition_id)
      .maybeSingle();
    if (compErr) {
      throw new Error(
        `completeMatchManually: competition lookup failed: ${compErr.message}`,
      );
    }
    if (comp?.type === 'cup') {
      throw new Error(
        'Cup matches cannot end in a draw — enter a tiebreak winner',
      );
    }
  }

  // ── Step 3: persist the result with optimistic-concurrency guard ─────────
  // played_at is stamped with the wall-clock so downstream readers that
  // sort by played_at order this row exactly like a worker-simulated one.
  //
  // The extra `.eq('status', 'scheduled')` clause makes the UPDATE a no-op
  // when the worker (or another admin) has already moved the row to
  // `in_progress` / `completed`.  Without it, a stale Fixture Browser tab
  // could overwrite a freshly-completed simulation and re-emit
  // `match.completed`, double-settling wagers and double-advancing cups.
  // We use `.select()` to make PostgREST return the affected rows; an empty
  // array means the guard skipped the write and we throw before emitting.
  const { data: updatedRows, error: updateErr } = await (db as AnyDb)
    .from('matches')
    .update({
      status:     'completed',
      home_score: homeScore,
      away_score: awayScore,
      played_at:  new Date().toISOString(),
    })
    .eq('id', matchId)
    .eq('status', 'scheduled')
    .select();

  if (updateErr) {
    throw new Error(`completeMatchManually: update failed: ${updateErr.message}`);
  }
  if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
    throw new Error(
      'Match is no longer scheduled — refresh and try again',
    );
  }

  // ── Step 4: emit the bus event ───────────────────────────────────────────
  // Reaches all four cross-feature listeners.  Synchronous — listeners run
  // inline on this microtask; their async DB work is handled inside the
  // listener bodies themselves and intentionally not awaited here.
  busOverride.emit('match.completed', {
    matchId,
    homeTeamId:    matchRow.home_team_id,
    awayTeamId:    matchRow.away_team_id,
    homeScore,
    awayScore,
    competitionId: matchRow.competition_id ?? '',
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
  const { data, error } = await (db as AnyDb)
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
