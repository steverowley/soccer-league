// ── match-worker/index.ts ─────────────────────────────────────────────────
// Deno edge function scheduled by pg_cron to run every minute.
//
// RESPONSIBILITIES
// ────────────────
// 1. Poll for matches where status='scheduled' and scheduled_at <= now()
// 2. Claim each match via optimistic lock (UPDATE ... WHERE status='scheduled')
// 3. Fetch full team rosters + managers for home and away
// 4. Normalize DB rows to engine format
// 5. Run a complete 90-minute simulation (simulateFullMatch)
// 6. Batch-insert events into match_events (max 500 per batch)
// 7. Update match status to 'completed' with final score + MVP
// 8. Gracefully handle per-match errors without crashing the worker
//
// DISPATCHER / WORKER MODES
// ─────────────────────────
// The pg_cron tick hits this function in DISPATCHER mode (body {}): it does the
//   once-per-tick housekeeping (price odds, requeue orphans) then fans out one
//   self-invocation per due LEAGUE match — body {"mode":"one"} — in parallel
//   waves of FANOUT_CONCURRENCY.  Each WORKER-mode invocation simulates exactly
//   one match in its OWN isolate (own CPU budget), so a whole matchday's
//   simultaneous kickoffs all finish within seconds and are every one watchable
//   live, rather than draining ~1–2/min.  The CPU-heavy sims never stack up in
//   one isolate, which is what tripped the WORKER_LIMIT (HTTP 546) before.
// Cup ties are kept OFF the parallel path: they share their competition's single
//   `bracket` JSON, whose post-match read-modify-write isn't concurrency-safe.
//   They drain via the in-process backstop instead, one at a time.
// The in-process loop (processWithinBudget, CLAIM_TIME_BUDGET_MS) runs as the
//   dispatcher's backstop after fan-out: it drains cups + any league leftovers
//   sequentially, no-ops when the queue is empty, and guarantees progress if
//   self-invocation is disabled or a wave failed.
//
// CONCURRENCY & LOCKING
// ────────────────────
// Workers run in parallel but claim atomically: the optimistic lock
// (UPDATE ... WHERE status='scheduled') means only one worker can flip a given
// match to 'in_progress', so racing workers never double-simulate.  On error a
// match reverts to 'scheduled' for retry.
// requeueStaleInProgress() recovers any match a killed isolate still left
//   stranded in 'in_progress' (older than STALE_IN_PROGRESS_MS), requeuing it
//   so it completes on a later tick instead of staying stuck (and scoreless,
//   which silently breaks the league table) forever.
// EVENT_INSERT_BATCH_SIZE=500: insert up to 500 events in a single Supabase
//   call.  A typical 90-minute match generates 30–60 events, so one batch
//   usually handles the entire match.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.2';
import { normalizeTeamForEngine } from './normalizeTeam.ts';
import { settleMatchWagers, maybeTransitionSeasonForMatch, maybeAdvanceCupBracket, writeMatchCompletionMemories } from './postMatchEffects.ts';
import { prepareArchitectForMatch, type CosmicArchitect, type LoreStore } from './architect.ts';
import { generateInterferences } from './architectInterference.ts';
import {
  applyAnnulGoals,
  applyForceRedCards,
  reconcileStatsAfterInterference,
  resolveInterferenceStream,
  type AnnulGoalIntent,
  type ForceRedCardIntent,
  type InterferenceEffect,
} from './interferenceResolver.ts';
import { computeFanBoost } from './fanBoost.ts';
import { ensureOddsForUpcoming } from './oddsGenerator.ts';
import { simulateSpatialMatch } from './spatial/simulateSpatialMatch.ts';
import { adaptSpatialResult, buildPlayerIndex, toSpatialTeamInput, filterNotableEvents } from './spatial/spatialEventAdapter.ts';
import type { PositionFrame } from './spatial/types.ts';

// ── Configuration ──────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

/**
 * Anthropic API key for Architect LLM calls (pre-match omen + post-match
 * verdict).  Optional: when empty, the architect falls back to deterministic
 * templates and the post-match save only writes a match-ledger entry — no
 * verdict, no player-arc updates, no relationship mutations.  Match
 * completion is never blocked on this key being present.
 */
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';

const EVENT_INSERT_BATCH_SIZE = 500; // Insert up to 500 events per Supabase call

/**
 * Wall-clock budget (ms) for claiming + simulating matches in a single cron
 * invocation.  Matches are claimed and processed ONE AT A TIME (see
 * claimNextDueMatch), so when this budget is spent we simply stop claiming new
 * work and return — any remaining due matches stay `status='scheduled'` and are
 * picked up on the next minute's tick.
 *
 * WHY: the spatial sim is CPU-heavy and a run of several matches in one isolate
 * overruns Supabase's per-invocation CPU limit (the isolate is killed with HTTP
 * 546 WORKER_LIMIT).  When that happened mid-batch it orphaned every
 * already-claimed-but-unprocessed match in `in_progress` with no data.  10s
 * leaves comfortable headroom below the observed kill threshold (~16s+) while
 * still draining the queue across successive ticks.
 */
const CLAIM_TIME_BUDGET_MS = 10_000;

/**
 * How long a match may sit in `status='in_progress'` before it's treated as
 * orphaned and requeued (see requeueStaleInProgress).  A real simulation
 * completes inside a single short-lived isolate (seconds), so a match still
 * `in_progress` minutes later was abandoned by an isolate that was killed
 * mid-run.  2 minutes is far above any genuine processing time (a live isolate
 * is killed long before then), so an actively-simulating match is never reaped,
 * yet a stuck one rejoins the queue within a couple of ticks.
 */
const STALE_IN_PROGRESS_MS = 2 * 60_000;

/**
 * How many single-match worker invocations the dispatcher runs CONCURRENTLY per
 * fan-out wave.  Each one simulates exactly one match in its OWN isolate (its
 * own CPU budget), so a whole matchday's simultaneous kickoffs finish within
 * seconds — every match watchable live from minute 0 — instead of draining
 * ~1–2/min sequentially.  Kept conservative so the fan-out (dispatcher + this
 * many workers) stays well under Supabase's per-project concurrent-isolate cap;
 * raise it if the plan's concurrency limit comfortably allows more.
 */
const FANOUT_CONCURRENCY = 6;

/**
 * Hard cap on fan-out waves per dispatcher tick.  FANOUT_CONCURRENCY ×
 * FANOUT_MAX_WAVES is the most matches one tick drains via fan-out; 6 × 5 = 30
 * comfortably covers a full 16-match matchday in a single tick.  Also stops a
 * runaway loop if a match keeps failing back to 'scheduled' and re-qualifying.
 */
const FANOUT_MAX_WAVES = 5;

/**
 * How many due candidates each claim pulls before trying to lock one.  A
 * fan-out wave runs FANOUT_CONCURRENCY claims at once; if each only looked at
 * the single oldest row they'd all fight over it and the wave would process one
 * match instead of many.  Pulling a pool ≥ FANOUT_CONCURRENCY (with headroom for
 * a whole matchday) lets concurrent workers spread across distinct rows.
 */
const CLAIM_CANDIDATE_POOL = 32;

/**
 * Wall-clock ceiling (ms) on the dispatcher's whole fan-out phase, so it can
 * never approach the function's request timeout while awaiting waves.  45s
 * leaves generous room for ~3 waves of single-match sims (~8–10s each).
 */
const FANOUT_TIME_BUDGET_MS = 45_000;

/**
 * This function's own absolute URL, used for dispatcher → worker fan-out.
 * Derived from SUPABASE_URL so it tracks the project without a hard-coded host.
 * Empty only if SUPABASE_URL is unset, in which case fan-out is skipped and the
 * dispatcher falls back to its in-process loop (never worse than before).
 */
const SELF_INVOKE_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/match-worker` : '';

// ── Supabase client (service role — full access) ──────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ── Helper: Claim the next due match ───────────────────────────────────────

/** In-place Fisher–Yates shuffle; returns the same array for chaining. */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/**
 * Claim ONE due match (status='scheduled', scheduled_at <= now) by atomically
 * flipping it to 'in_progress', and return the claimed row — or null when
 * nothing claimable is left.
 *
 * DISTINCT CLAIMS UNDER FAN-OUT: a fan-out wave runs FANOUT_CONCURRENCY of these
 * concurrently.  If each only looked at the single oldest due row they'd all
 * contend on it — one wins, the rest come back empty, and the wave processes
 * just one match.  So we pull a POOL of due candidates, shuffle it (claim order
 * is irrelevant — the sim seed is the match UUID), and try to claim each until
 * one succeeds; concurrent workers therefore spread across distinct rows and a
 * lost race simply advances to the next candidate.
 *
 * CONCURRENCY: the `.eq('status','scheduled')` predicate on the UPDATE is the
 * optimistic lock — only the worker whose UPDATE matched the still-'scheduled'
 * row gets it back from `.select()`, so two workers can never both simulate the
 * same match or double-insert its events.
 *
 * @param opts.leagueOnly  Restrict to league matches (competitions.type =
 *   'league').  The dispatcher fans out league matches only — cup ties share
 *   their competition's single `bracket` JSON, whose post-match read-modify-
 *   write is not concurrency-safe, so cups are drained by the sequential
 *   backstop instead of in parallel.
 * @returns The claimed match row, or null if nothing claimable remains.
 */
async function claimNextDueMatch(opts?: { leagueOnly?: boolean }): Promise<any | null> {
  const now = new Date().toISOString();

  // Pull a pool of due candidates (oldest first) so concurrent claimers can
  // pick DISTINCT rows.  league-only uses an inner join on competitions so a
  // cup tie is never handed to a parallel worker.
  let query = supabase
    .from('matches')
    .select(opts?.leagueOnly ? 'id, competitions!inner(type)' : 'id')
    .eq('status', 'scheduled')
    .lte('scheduled_at', now)
    .order('scheduled_at', { ascending: true })
    .limit(CLAIM_CANDIDATE_POOL);
  if (opts?.leagueOnly) query = query.eq('competitions.type', 'league');

  const { data: candidates, error: selectError } = await query;
  if (selectError) {
    console.error('[match-worker] SELECT matches failed:', selectError);
    return null;
  }
  if (!candidates || candidates.length === 0) return null;

  // Shuffle so parallel workers don't all attempt the same first id, then try
  // to claim each candidate until one succeeds (or the pool is exhausted).
  for (const id of shuffle(candidates.map((c: { id: string }) => c.id))) {
    const { data: claimed, error: claimError } = await supabase
      .from('matches')
      .update({ status: 'in_progress', played_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'scheduled')
      // `round` is read post-match by postMatchLoreSave to surface the matchday
      // in the Architect verdict prompt (e.g. 'Matchday 7', 'Final').  Absent
      // matches still process — the field is treated as 0 downstream.
      .select('id, home_team_id, away_team_id, scheduled_at, competition_id, round');

    if (claimError) {
      console.error('[match-worker] UPDATE claim failed:', claimError);
      return null;
    }
    if (claimed && claimed.length > 0) return claimed[0];
    // Lost the race for this candidate — try the next one in the pool.
  }
  return null; // every candidate was claimed by someone else
}

// ── Helper: Recover orphaned matches ───────────────────────────────────────

/**
 * Requeue matches that a killed isolate left stranded in `status='in_progress'`.
 *
 * A healthy simulation runs to completion inside one short-lived isolate, so
 * any match still `in_progress` longer than STALE_IN_PROGRESS_MS was abandoned
 * when its isolate was killed mid-run (CPU/wall-clock limit).  Because claiming
 * only ever looks at `scheduled` rows, such a match would otherwise stay stuck
 * forever — never completing, never scoring, and silently leaving a hole in the
 * league table.  This reverts it to `scheduled` so a later tick re-simulates it.
 *
 * Before requeuing it deletes any partial rows the killed run may have written
 * (mirrors processMatch's error-path cleanup): `match_positions` has a
 * (match_id, minute, second) primary key and `match_events` has no per-event
 * unique index, so leftover rows would otherwise conflict or duplicate on the
 * re-simulation.  The `.eq('status','in_progress')` predicate on the UPDATE
 * guards against racing a worker that legitimately finished one between our
 * SELECT and UPDATE.
 *
 * Runs at the top of every cron tick; cheap (one indexed SELECT) when nothing
 * is stale.
 *
 * @returns Number of matches requeued.
 */
async function requeueStaleInProgress(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_IN_PROGRESS_MS).toISOString();

  const { data: stale, error: selectError } = await supabase
    .from('matches')
    .select('id')
    .eq('status', 'in_progress')
    .lt('played_at', cutoff);

  if (selectError) {
    console.error('[match-worker] SELECT stale in_progress failed:', selectError);
    return 0;
  }
  if (!stale || stale.length === 0) return 0;

  const ids = stale.map((m) => m.id);

  // Clear partial rows so the retry starts from a clean slate.
  await supabase.from('match_events').delete().in('match_id', ids);
  await supabase.from('match_player_stats').delete().in('match_id', ids);
  await supabase.from('match_positions').delete().in('match_id', ids);

  const { data: reverted, error: updateError } = await supabase
    .from('matches')
    .update({ status: 'scheduled', played_at: null })
    .in('id', ids)
    .eq('status', 'in_progress')
    .select('id');

  if (updateError) {
    console.error('[match-worker] Requeue stale in_progress failed:', updateError);
    return 0;
  }
  return reverted?.length ?? 0;
}

// ── Helper: Fetch teams with rosters ───────────────────────────────────────

/**
 * Fetch a single team by ID including all relations (manager, players).
 *
 * The select intentionally requests only the five canonical player stat
 * columns that exist in `public.players` (attacking, defending, mental,
 * technical, athletic) — see migration 0000_init.sql.  The engine's expanded
 * stat surface (passing, dribbling, speed, stamina, positioning, vision,
 * goalkeeping, aggression, strength) is *derived* at runtime by
 * normalizeTeamForEngine(), which defaults missing fields to 70.  Asking
 * PostgREST for columns that don't exist returns a 400 from the boundary,
 * causing fetchTeamForSimulation to return null and the whole batch to revert.
 *
 * @param teamId - Slug (text PK) of the team to load.
 * @returns      Team row with nested managers[] and players[], or null on error.
 */
async function fetchTeamForSimulation(teamId: string) {
  const { data, error } = await supabase
    .from('teams')
    // managers table stores only identity (id, name, nationality, style) —
    // the engine's coaching stat surface (attacking/defending/mental/athletic/
    // technical) is filled in by normalizeTeamForEngine at default 70.
    //
    // `color` and `capacity` feed the engine's per-event animation payload and
    // its stadium/weather selection.  Omitting them (as the worker did before
    // this commit) made gameEngine fall back to a *random* STADIUMS entry,
    // which in turn picked a random `planet` and therefore the wrong
    // PLANET_WX table — every weather-keyed mechanic was running off the
    // wrong distribution.
    // `preferred_formation` on the manager row is read by `toSpatialTeamInput`
    // to assign each player to their correct formation slot (e.g. '4-4-2').
    // The legacy `normalizeTeamForEngine` path ignores it safely.
    .select('id, name, short_name, color, location, home_ground, capacity, managers(id, name, entity_id, preferred_formation), players(id, entity_id, name, position, age, jersey_number, starter, attacking, defending, mental, technical, athletic, is_active)')
    .eq('id', teamId)
    .single();

  if (error) {
    console.error(`[match-worker] Failed to fetch team ${teamId}:`, error);
    return null;
  }

  return data;
}

// ── Helper: Post-match lore save ───────────────────────────────────────────

/**
 * Builds the match-state shape the Architect expects, calls saveMatchToLore
 * (LLM-driven verdict + lore mutations) and persists the mutated lore.
 *
 * Extracted so the post-match orchestration block in processMatch stays
 * focused on cron-level concerns (settlement, cup advance, season tx) and
 * the lore-specific marshalling/persistence logic lives in one place.
 *
 * @param architect  The CosmicArchitect from prepareArchitectForMatch.
 *                   `architect.lore` is mutated in place by saveMatchToLore.
 * @param loreStore  The LoreStore from prepareArchitectForMatch.  Used to
 *                   batch-upsert the mutated lore + drain pending writes.
 * @param match      The DB match row this worker just simulated; we use
 *                   `round` as the matchday hint in the verdict prompt.
 * @param result     Output of simulateFullMatch — events, score, MVP, stats.
 * @param homeData   Raw home team row (for the team shape + player roster
 *                   the verdict prompt references).
 * @param awayData   Raw away team row.
 */
async function postMatchLoreSave(
  architect: CosmicArchitect,
  loreStore: LoreStore,
  match: any,
  result: { events: any[]; finalScore: [number, number]; mvp: string; playerStats: any },
  homeData: any,
  awayData: any,
): Promise<void> {
  // The events array carries the minute-by-minute commentary; saveMatchToLore
  // inlines goals + red cards + injuries into the verdict prompt so the LLM
  // can reference specific moments.  We forward only the fields it reads.
  const matchState = {
    events:      result.events.map((ev: any) => ({
      minute:     ev.minute,
      type:       ev.type,
      commentary: ev.payload?.commentary,
      isGoal:     ev.payload?.isGoal,
      cardType:   ev.payload?.cardType,
      isInjury:   ev.payload?.isInjury,
    })),
    score:       result.finalScore,
    playerStats: result.playerStats,
    mvp:         result.mvp,
    homeTeam: {
      name:      homeData.name,
      shortName: homeData.short_name ?? homeData.name,
      players:   (homeData.players ?? []).map((p: any) => ({ name: p.name })),
    },
    awayTeam: {
      name:      awayData.name,
      shortName: awayData.short_name ?? awayData.name,
      players:   (awayData.players ?? []).map((p: any) => ({ name: p.name })),
    },
  };

  // leagueContext carries only what we can derive without another DB round-trip:
  //   - matchday: `match.round` is a free-form string ('Matchday 1', 'Final').
  //     We strip non-digits for the numeric ledger column; 0 when not parseable.
  //   - seasonId / season / league: would require a competitions JOIN that
  //     isn't worth the round-trip for v1; the architect just won't write a
  //     season-arc row when seasonId is absent (the rest of the verdict still lands).
  const matchdayDigits = String(match.round ?? '').replace(/\D/g, '');
  const leagueContext = {
    matchday: matchdayDigits ? Number(matchdayDigits) : 0,
  };

  await architect.saveMatchToLore(matchState, leagueContext);
  loreStore.persistAll(architect.lore);
  await loreStore.flush();
}

// ── Helper: Process a single match ─────────────────────────────────────────

/**
 * Simulate a single match and persist the result.
 *
 * On success: inserts events to match_events, updates match status to
 * 'completed' with final score + MVP.
 *
 * On error: logs the error, reverts match status to 'scheduled' for retry.
 *
 * @param match Match row from the database.
 * @returns     true if successful, false if error (match reverted to scheduled).
 */
async function processMatch(match: any): Promise<boolean> {
  try {
    console.log(`[match-worker] Processing match ${match.id} at ${match.scheduled_at}`);

    // Fetch teams with full rosters
    const homeData = await fetchTeamForSimulation(match.home_team_id);
    const awayData = await fetchTeamForSimulation(match.away_team_id);

    if (!homeData || !awayData) {
      throw new Error('Failed to fetch one or both teams');
    }

    // Normalize teams to engine format
    const home = normalizeTeamForEngine(homeData);
    const away = normalizeTeamForEngine(awayData);

    // ── Referee lookup (isl-84e) ───────────────────────────────────────────
    // Read the assigned referee from `match_referee_v` so the engine knows
    // the correct officiating identity AND so the Phase 8 `card_severity`
    // reflex resolver can resolve the referee's persona via `entity_id`.
    // The view returns `referee_strictness` on the raw 1–10 trait scale;
    // we multiply by 10 to land on the engine's 0–100 strictness scale
    // (matching the contract documented in simulateFullMatch.ts).
    //
    // Failure modes are all degrade-gracefully: a missing FK, a view
    // query error, or a referee with no strictness trait → `null`
    // refOverride, and gameEngine falls back to the legacy random
    // fabricated referee with `entity_id: null`.
    let refOverride: { name: string; strictness: number; entity_id: string | null } | null = null;
    try {
      const { data: refRow, error: refErr } = await supabase
        .from('match_referee_v')
        .select('referee_id, referee_name, referee_display_name, referee_strictness')
        .eq('match_id', match.id)
        .maybeSingle();
      if (refErr) {
        console.warn(`[match-worker] match_referee_v query failed: ${refErr.message}`);
      } else if (refRow && refRow.referee_id) {
        const name = (refRow.referee_display_name as string | null) ?? (refRow.referee_name as string);
        const rawStrictness = (refRow.referee_strictness as number | null) ?? 5;
        refOverride = {
          name,
          // Trait scale 1–10 → engine scale 0–100.
          strictness: rawStrictness * 10,
          entity_id: refRow.referee_id as string,
        };
        console.log(`[match-worker] Referee: ${name} (strictness ${refOverride.strictness}/100, entity ${refOverride.entity_id})`);
      }
    } catch (err) {
      console.warn('[match-worker] referee lookup threw:', (err as Error)?.message ?? err);
    }

    // ── Political-decree aggregation (isl-azz) ─────────────────────────────
    // Read every political_decree row for THIS match's season and
    // aggregate the three documented payload axes:
    //   • cadence_mult  → recorded but not yet applied (would mutate
    //                     season_config.match_duration_seconds; deferred
    //                     to a follow-up that owns the global pacing
    //                     knob).
    //   • ref_strictness_delta → SUMMED across all decrees; ADDED to
    //                     the looked-up referee's strictness then
    //                     clamped to the engine's 0..100 scale.  This
    //                     is the only effect we apply in v1 because
    //                     it slots cleanly into the existing
    //                     refOverride object isl-84e wired.
    //   • ticket_multiplier   → recorded but not yet applied (would
    //                     modulate team_finances ticket revenue; lives
    //                     in a different code path and stays in this
    //                     PR's deferred list).
    //
    // Failure modes degrade silently — a query error or a malformed
    // payload row leaves the existing refOverride untouched so the
    // worker never blocks on the decrees subsystem.
    try {
      // Find the season id this match belongs to via its competition.
      const seasonId =
        match.competition_id != null
          ? (async () => {
              const { data: comp } = await supabase
                .from('competitions')
                .select('season_id')
                .eq('id', match.competition_id)
                .maybeSingle();
              return (comp as { season_id?: string } | null)?.season_id ?? null;
            })()
          : Promise.resolve(null);
      const resolvedSeasonId = await seasonId;
      if (resolvedSeasonId) {
        const { data: decrees, error: decreeErr } = await supabase
          .from('season_decrees')
          .select('payload')
          .eq('season_id', resolvedSeasonId)
          .eq('decree_type', 'political_decree');
        if (decreeErr) {
          console.warn(`[match-worker] season_decrees query failed: ${decreeErr.message}`);
        } else if (Array.isArray(decrees) && decrees.length > 0) {
          let totalRefDelta = 0;
          for (const row of decrees) {
            const p = (row as { payload?: unknown }).payload as
              | { ref_strictness_delta?: unknown }
              | null
              | undefined;
            const d =
              typeof p?.ref_strictness_delta === 'number' ? p.ref_strictness_delta : 0;
            totalRefDelta += d;
          }
          if (totalRefDelta !== 0 && refOverride) {
            const before = refOverride.strictness;
            // Clamp to the engine's 0..100 strictness scale so a
            // pile of decrees can't push the value off the cliff.
            refOverride.strictness = Math.max(0, Math.min(100, before + totalRefDelta));
            console.log(
              `[match-worker] political_decree: ref strictness ${before} → ${refOverride.strictness} ` +
              `(Σ delta ${totalRefDelta} across ${decrees.length} decree(s))`,
            );
          }
        }
      }
    } catch (err) {
      console.warn('[match-worker] political_decree aggregation threw:', (err as Error)?.message ?? err);
    }

    // ── Pre-match context ───────────────────────────────────────────────────
    // Fan boost + Architect lifecycle are both hydrated here in parallel and
    // threaded into simulateFullMatch.  Both falling back to no-ops (no
    // fans / empty lore) is the common case early in the DB's life and is
    // the deliberate degradation path — kickoff must never block on either.
    //
    // `prepareArchitectForMatch` REPLACES the previous `hydrateArchitectBridge`
    // wiring: it returns a full CosmicArchitect (not just the read-only
    // GhostArchitect) so the same instance can mint pre-match omens AND
    // accept the post-match `saveMatchToLore` call that closes the
    // architect_lore persistence loop.  See architect.ts for the rationale.
    const [fanBoost, prepared] = await Promise.all([
      computeFanBoost(supabase, match.home_team_id, match.away_team_id),
      prepareArchitectForMatch(supabase, {
        apiKey:   ANTHROPIC_API_KEY,
        homeTeam: {
          name:      home.name,
          shortName: home.shortName,
          color:     home.color,
          players:   home.players.map((p) => ({ name: p.name })),
        },
        awayTeam: {
          name:      away.name,
          shortName: away.shortName,
          color:     away.color,
          players:   away.players.map((p) => ({ name: p.name })),
        },
        homeManager: { name: home.manager.name },
        awayManager: { name: away.manager.name },
        // home.stadium is always populated by normalizeTeamForEngine — but
        // guard anyway in case future schema lets it be null.
        stadium: home.stadium
          ? { name: home.stadium.name, planet: home.stadium.planet }
          : null,
        // Weather is selected by gameEngine inside createAIManager once the
        // simulation starts; we don't have it at omen time and the omen
        // prompt only references it as flavour.  Empty string is acceptable.
        weather: '',
        // Phase 11.2: matchId drives the shadow-distribution load inside
        // prepareArchitectForMatch.  Without it the council would
        // deliberate without the alternate-timeline read.
        matchId: match.id,
      }),
    ]);
    const { architect, loreStore } = prepared;
    if (fanBoost.boostedSide !== 'none') {
      console.log(`[match-worker] Fan boost: +${fanBoost.boostAmount} to ${fanBoost.boostedSide}`);
    }

    // ── Pre-match Cosmic Omen ──────────────────────────────────────────────
    // Fire-and-forget Architect prologue: generate a cryptic omen +
    // matchTitle and write to `narratives` (kind='cosmic_omen') so the news
    // feed gets a pre-kickoff atmospheric beat.  Awaited so we don't race
    // with the worker isolate shutdown, but wrapped in its own try/catch so
    // an LLM or insert failure NEVER blocks the simulation.
    try {
      const omen = await architect.getPreMatchOmen();
      const { error: omenErr } = await supabase.from('narratives').insert({
        kind:              'cosmic_omen',
        summary:           `${omen.matchTitle}. ${omen.omen}`,
        entities_involved: [],
        source:            'match',
      });
      if (omenErr) {
        console.warn(`[match-worker] cosmic_omen insert failed: ${omenErr.message}`);
      }
    } catch (err) {
      console.warn('[match-worker] getPreMatchOmen threw:', (err as Error)?.message ?? err);
    }

    // Phase 8 reflex-hooks (shoot_or_pass / card_severity) were a feature of
    // the legacy dice-roller engine only; the spatial engine derives those
    // outcomes from geometry, so the corpus-hydration + reflexHooks wiring was
    // removed with PATH B (#389).  agentReflex.ts is now unimported — a
    // follow-up can delete it.

    // ── Simulation ─────────────────────────────────────────────────────────
    // Full agent-based spatial simulation: 22 autonomous players with Reynolds
    // steering, formation slots, and possession physics.  Events (goals,
    // tackles, saves) emerge from geometry rather than probability rolls, and
    // real per-player (x,y) frames are stored in `match_positions` for the
    // pitch viewer.
    //
    // The spatial engine is the only engine.  Convert raw DB rows to its typed
    // input, derive a deterministic 32-bit seed from the match UUID (same
    // match_id → identical outcome on every worker retry), simulate, and adapt
    // to the match_events shape.  `result` is mutated in place below by the
    // Architect interference passes (result.events / finalScore / playerStats).
    const homeInput = toSpatialTeamInput(homeData);
    const awayInput = toSpatialTeamInput(awayData);
    const seed = parseInt(match.id.replace(/-/g, '').slice(0, 8), 16);

    const spatialResult = simulateSpatialMatch(homeInput, awayInput, { seed });

    // Build the id → { name, teamName, side } index the adapter needs to map
    // spatial player ids back to names (the worker's playerIndex join is keyed
    // on name downstream); the adapter derives team display names from it.
    const playerIdx = buildPlayerIndex(homeData, awayData);
    const result = adaptSpatialResult(spatialResult, playerIdx);
    const positionFrames: PositionFrame[] = spatialResult.frames;

    console.log(
      `[match-worker] Spatial sim: ${spatialResult.finalScore[0]}–${spatialResult.finalScore[1]}, ` +
      `${spatialResult.events.length} events, ${positionFrames.length} position frames`,
    );

    console.log(`[match-worker] Simulation complete: ${result.finalScore[0]}–${result.finalScore[1]}, MVP: ${result.mvp}`);

    // ── Append a terminal MVP event ────────────────────────────────────────
    // The matches table has no mvp column, so we surface the engine-chosen
    // MVP as a final event in match_events at minute=91 (a sentinel value
    // beyond regulation, before stoppage-time events would land).  This
    // keeps MVP-derived narratives, idol score boosts, and post-match UI
    // rendering working off a single source of truth — the events feed —
    // and means a missing-column schema drift can never silently erase the
    // result of a successful 90-minute simulation again.
    if (result.mvp && result.mvp !== '—') {
      result.events.push({
        minute: 91,
        subminute: 0,
        type: 'mvp',
        payload: { player: result.mvp },
      });
    }

    // ── Architect interferences (#370) ─────────────────────────────────────
    // Close the audit's "headline mechanic is dark code" finding: ask the
    // Cosmic Architect to react to up to 3 dramatic moments in the just-
    // simulated match. Each successful call produces a synthetic
    // architect_interference event for the live commentary feed AND an
    // architect_interventions audit row.
    //
    // Runs POST-simulation rather than in the per-minute loop so the
    // worker doesn't add ~14s of in-line LLM latency per match. The
    // narrative-first scope (no engine-side mutation) is deliberate —
    // future slice wires the chosen interferenceType into a per-event
    // resolver that the engine reads during simulation.
    //
    // Fails soft: any LLM error logs and skips that slot; the rest of
    // the match proceeds unchanged.
    try {
      const interferences = await generateInterferences(
        ANTHROPIC_API_KEY,
        result.events,
        result.finalScore,
        home.name ?? home.shortName ?? 'Home',
        away.name ?? away.shortName ?? 'Away',
      );
      for (const inter of interferences) {
        result.events.push({
          minute:    inter.minute,
          subminute: inter.subminute,
          type:      'architect_interference',
          payload:   {
            interferenceType: inter.interferenceType,
            proclamation:     inter.proclamation,
            targetPlayer:     inter.targetPlayer,
            targetTeam:       inter.targetTeam,
            magnitude:        inter.magnitude,
          },
        });
        // Audit row — mirrors the shape mid-week intrusions use in
        // architect-galaxy-tick so a single dashboard query surfaces all
        // Architect actions (in-match + out-of-match).
        await supabase.from('architect_interventions').insert({
          target_table: 'matches',
          target_id:    match.id,
          field:        inter.interferenceType,
          old_value:    { minute: inter.minute },
          new_value:    { proclamation: inter.proclamation, magnitude: inter.magnitude },
          reason:       `In-match Architect interference at minute ${inter.minute}: ${inter.interferenceType}.`,
          meta:         {
            match_id:      match.id,
            kind:          'in_match_interference',
            source:        'match-worker',
            target_player: inter.targetPlayer,
            target_team:   inter.targetTeam,
          },
        });
      }
      if (interferences.length > 0) {
        console.log(`[match-worker] Architect emitted ${interferences.length} interference(s) for match ${match.id}`);
      }

      // ── Architect mechanical effects (#476) ──────────────────────────────
      // Up to this point `interferences` is purely narrative — each one
      // emitted an `architect_interference` row for live commentary but the
      // simulated match outcome was identical with or without it. This
      // block closes #428's "headline mechanic is dark code" by partitioning
      // the LLM-chosen interferences into the four resolver-input buckets
      // and applying the pure post-passes from interferenceResolver.ts:
      //
      //   curse_player    → InterferenceEffect on `ctx.curses`
      //   bless_player    → InterferenceEffect on `ctx.blesses`
      //   annul_goal      → AnnulGoalIntent (retrospective goal rewind)
      //   force_red_card  → ForceRedCardIntent (forward card promotion)
      //
      // ORDER OF PASSES matters: curse/bless first (so an annulled goal
      // doesn't get re-cursed), then annul_goal, then force_red_card.
      // The resolvers naturally skip narrative architect_interference
      // events (no `payload.player`, no `payload.isGoal`, not a card-able
      // type) so we can run the post-pass over the FULL events array —
      // engine events + narrative items — and only the engine events
      // mutate.
      //
      // ── targetTeam mapping ──
      // architectInterference returns 'home' | 'away' | null. The engine
      // stamps goals with `payload.team === posTeam.shortName`, so we
      // map at the partition step to keep the resolver string-compare
      // pure.
      //
      // ── annul_goal minute offset ──
      // The Architect speaks AT or just AFTER the trigger goal (subminute
      // = goal.subminute + 0.005). applyAnnulGoals walks AT or AFTER
      // intent.minute. To catch the just-occurred goal we subtract
      // ANNUL_BACKSCAN_MINUTES from the speak-minute so the walk picks
      // up the goal that triggered the proclamation. The window is small
      // (3) so we don't accidentally consume a much older goal.
      const ANNUL_BACKSCAN_MINUTES = 3;

      const curses:        InterferenceEffect[]  = [];
      const blesses:       InterferenceEffect[]  = [];
      const annulGoals:    AnnulGoalIntent[]     = [];
      const forceRedCards: ForceRedCardIntent[]  = [];

      for (const inter of interferences) {
        // Map 'home'/'away' → the engine's shortName for goal-team match.
        const targetTeamShortName = inter.targetTeam === 'home' ? (home.shortName ?? home.name)
                                  : inter.targetTeam === 'away' ? (away.shortName ?? away.name)
                                  : null;
        switch (inter.interferenceType) {
          case 'curse_player':
            if (inter.targetPlayer) {
              curses.push({
                playerName: inter.targetPlayer,
                magnitude:  inter.magnitude,
                startMin:   inter.minute,
              });
            }
            break;
          case 'bless_player':
            if (inter.targetPlayer) {
              blesses.push({
                playerName: inter.targetPlayer,
                magnitude:  inter.magnitude,
                startMin:   inter.minute,
              });
            }
            break;
          case 'annul_goal':
            // Without a target team we can't disambiguate which side's
            // goal to annul — skip rather than guess.
            if (targetTeamShortName) {
              annulGoals.push({
                team:      targetTeamShortName,
                minute:    Math.max(0, inter.minute - ANNUL_BACKSCAN_MINUTES),
                magnitude: inter.magnitude,
              });
            }
            break;
          case 'force_red_card':
            if (inter.targetPlayer) {
              forceRedCards.push({
                playerName: inter.targetPlayer,
                minute:     inter.minute,
                magnitude:  inter.magnitude,
              });
            }
            break;
          // All other interferenceTypes remain narrative-only in this slice.
          // Adding mechanics for them is straightforward — wire another
          // resolver in interferenceResolver.ts and another bucket here.
        }
      }

      // Apply the post-passes in sequence. Each takes a SimulatedEvent[]
      // and returns a (possibly new) SimulatedEvent[] — input is never
      // mutated. Production uses Math.random; the resolvers' magnitude*0.1
      // probability gate encodes the per-intent uncertainty so the
      // Architect's call is not always guaranteed to fire.
      let mutated = result.events;
      if (curses.length > 0 || blesses.length > 0) {
        mutated = resolveInterferenceStream(mutated, { curses, blesses }, Math.random);
      }
      if (annulGoals.length > 0) {
        mutated = applyAnnulGoals(mutated, annulGoals, Math.random);
      }
      if (forceRedCards.length > 0) {
        mutated = applyForceRedCards(mutated, forceRedCards, Math.random);
      }

      // Re-derive finalScore from the mutated stream so annulled / cursed
      // goals are removed from the scoreline. Engine-side score lives in
      // `result.finalScore`; mirrors the same shortName comparison the
      // simulator uses internally.
      if (mutated !== result.events) {
        const rederived: [number, number] = [0, 0];
        for (const ev of mutated) {
          const pl = ev.payload as Record<string, unknown>;
          if (pl['isGoal'] !== true) continue;
          if (pl['team'] === (home.shortName ?? home.name))      rederived[0]++;
          else if (pl['team'] === (away.shortName ?? away.name)) rederived[1]++;
        }
        const mutationCount = mutated.filter(
          ev => (ev.payload as Record<string, unknown>)['interferenceApplied'],
        ).length;
        console.log(
          `[match-worker] Architect mechanically mutated ${mutationCount} event(s); ` +
          `score ${result.finalScore[0]}–${result.finalScore[1]} → ${rederived[0]}–${rederived[1]}`,
        );
        result.events     = mutated;
        result.finalScore = rederived;
        // Reconcile per-player counters with the mutated stream so an annulled
        // goal leaves its scorer's tally and a forced red card reaches
        // match_player_stats / the idol leaderboard — otherwise statRows below
        // would persist the pre-interference counts, diverging from the
        // re-derived scoreline.
        result.playerStats = reconcileStatsAfterInterference(result.playerStats, mutated);
      }
    } catch (err) {
      console.warn('[match-worker] generateInterferences threw (non-fatal):', err);
    }

    // ── Trim the spatial event flood (#519) ────────────────────────────────
    // The spatial engine emits ~8,500 per-tick events/match (thousands of
    // tackles/interceptions/passes).  Persist + show only the notable beats
    // plus anything the Architect just touched.  Runs AFTER interference so
    // force_red_card still found its tackle to promote, and so cursed/annulled
    // goals (now interferenceApplied 'shot' events) survive the trim.  Stats
    // were accumulated over the full stream in adaptSpatialResult and are
    // unaffected.
    const beforeFilterCount = result.events.length;
    result.events = filterNotableEvents(result.events);
    if (beforeFilterCount !== result.events.length) {
      console.log(`[match-worker] Significance filter: ${beforeFilterCount} → ${result.events.length} events`);
    }

    // ── Persist events (batch-insert) ──────────────────────────────────────
    // The engine may produce 30–60 events; batch into chunks of 500
    // to avoid payload size limits.
    for (let i = 0; i < result.events.length; i += EVENT_INSERT_BATCH_SIZE) {
      const chunk = result.events.slice(i, i + EVENT_INSERT_BATCH_SIZE);
      const eventRows = chunk.map((ev) => ({
        match_id: match.id,
        minute: ev.minute,
        subminute: ev.subminute,
        type: ev.type,
        payload: ev.payload,
      }));

      const { error: insertError } = await supabase
        .from('match_events')
        .insert(eventRows);

      if (insertError) {
        throw new Error(`Insert events failed: ${insertError.message}`);
      }
    }

    console.log(`[match-worker] Inserted ${result.events.length} events`);

    // ── Persist spatial position frames ───────────────────────────────────
    // The frames are written in the same batch-insert style as events
    // (500 rows/call) and stored in `match_positions` keyed by
    // (match_id, minute, second).
    //
    // Frame → row mapping:
    //   minute  = floor(tSec / 60) + 1, clamped to [1, 120] (extra time)
    //   second  = floor(tSec % 60)          — second within the minute
    //   snapshots.players[].hasBall is derived here (not in PositionFrame)
    //   by comparing each player id against frame.ball.ownerId.
    //
    // Failure is non-fatal: the match is already committed as completed and
    // position data is cosmetic (viewer only).  A missing frame just means
    // the viewer interpolates across a wider gap.
    if (positionFrames.length > 0) {
      const posRows = positionFrames.map((frame) => {
        const minute = Math.min(120, Math.max(1, Math.floor(frame.tSec / 60) + 1));
        const second = Math.floor(frame.tSec % 60);
        return {
          match_id:  match.id,
          minute,
          second,
          snapshots: {
            players: frame.players.map((p) => ({
              id:      p.id,
              x:       p.x,
              y:       p.y,
              hasBall: frame.ball.ownerId === p.id,
            })),
            ball: frame.ball,
          },
        };
      });

      for (let i = 0; i < posRows.length; i += EVENT_INSERT_BATCH_SIZE) {
        const chunk = posRows.slice(i, i + EVENT_INSERT_BATCH_SIZE);
        const { error: posErr } = await supabase.from('match_positions').insert(chunk);
        if (posErr) {
          // Non-fatal: log and continue — position data is cosmetic.
          console.warn(`[match-worker] match_positions insert failed: ${posErr.message}`);
          break;
        }
      }
      console.log(`[match-worker] Persisted ${posRows.length} position frames`);
    }

    // ── Persist per-player stats ───────────────────────────────────────────
    // The engine returns playerStats keyed by player *name*; the DB table
    // match_player_stats is keyed by player_id (uuid) + team_id (slug).
    // Build a name→{id, team_id} map from the rosters we already loaded so
    // we don't need a second round-trip.  Players who never touched a stat
    // counter during the match (no goals/assists/cards) are skipped so the
    // table only carries meaningful rows — the idol leaderboard reads sum
    // aggregates and treats missing rows as zeros.
    //
    // `minutes_played` defaults to 90 because the current engine has no
    // substitution path; once subs are simulated this can switch to the
    // real on-pitch duration.  `rating` is intentionally left NULL — there
    // is no agreed scoring formula yet and downstream views accept null.
    const playerIndex: Record<string, { id: string; teamId: string }> = {};
    for (const p of homeData.players || []) {
      if (p?.name && p?.id) playerIndex[p.name] = { id: p.id, teamId: homeData.id };
    }
    for (const p of awayData.players || []) {
      if (p?.name && p?.id) playerIndex[p.name] = { id: p.id, teamId: awayData.id };
    }

    const statRows = Object.entries(result.playerStats || {})
      .map(([name, s]) => {
        const idx = playerIndex[name];
        if (!idx) return null;
        return {
          match_id: match.id,
          player_id: idx.id,
          team_id: idx.teamId,
          goals: s.goals || 0,
          assists: s.assists || 0,
          yellow_cards: s.yellowCard ? 1 : 0,
          red_cards: s.redCard ? 1 : 0,
          minutes_played: 90,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (statRows.length > 0) {
      const { error: statsError } = await supabase
        .from('match_player_stats')
        .insert(statRows);
      if (statsError) throw new Error(`Insert match_player_stats failed: ${statsError.message}`);
      console.log(`[match-worker] Persisted ${statRows.length} player-stat rows`);
    }

    // ── Persist participation rows (isl-pfm) ───────────────────────────────
    // match_lineups carries one row per starter regardless of whether
    // they accrued a stat — gives the player_detail page true match
    // history (a defender with 30 clean sheets shows 30 lineups).
    // Worker writes both sides' starters at the same point in the
    // pipeline; match_player_stats stays contribution-only.
    //
    // ON CONFLICT DO NOTHING via the (match_id, player_id) PK so a
    // worker retry (rare but possible) doesn't double-insert.
    const lineupRows = [...(homeData.players ?? []), ...(awayData.players ?? [])]
      .filter((p): p is typeof p & { id: string; team_id: string } =>
        Boolean(p?.id && p?.team_id && p?.starter),
      )
      .map((p) => ({
        match_id:       match.id,
        player_id:      p.id,
        team_id:        p.team_id,
        position:       (p.position as string | null) ?? 'MF',
        jersey_number:  (p.jersey_number as number | null) ?? null,
        starter:        true,
        minutes_played: 90,
      }));
    if (lineupRows.length > 0) {
      const { error: lineupErr } = await supabase
        .from('match_lineups')
        .upsert(lineupRows, { onConflict: 'match_id,player_id', ignoreDuplicates: true });
      if (lineupErr) {
        // Best-effort: log + continue.  The match is still successfully
        // simulated even when the participation rows fail to land — the
        // historical backfill in migration 0047 covers existing matches
        // and a future re-run of this insert will re-fill missing rows.
        console.warn(`[match-worker] match_lineups insert failed: ${lineupErr.message}`);
      } else {
        console.log(`[match-worker] Persisted ${lineupRows.length} lineup rows`);
      }
    }

    // ── Update match to completed ──────────────────────────────────────────
    // The matches table only has columns for status / scores / timestamps —
    // there is intentionally no `mvp_player_name` column.  The MVP is captured
    // inside the final `mvp` event payload in match_events, where downstream
    // views (player_idol_score, public match feed) read it from.  Updating a
    // non-existent column here would throw at the PostgREST boundary and
    // revert every match in this batch back to 'scheduled' — masking the
    // simulation work that just succeeded.
    const { error: updateError } = await supabase
      .from('matches')
      .update({
        status: 'completed',
        home_score: result.finalScore[0],
        away_score: result.finalScore[1],
      })
      .eq('id', match.id);

    if (updateError) {
      throw new Error(`Update match failed: ${updateError.message}`);
    }

    // ── Post-match orchestration ──────────────────────────────────────────
    // These side-effects used to be wired through the browser-side
    // `match.completed` event bus, which is an in-memory singleton that
    // can never reach a server-side edge worker.  Now they run inline in
    // service-role context immediately after the match is marked complete.
    //
    // Failures here are logged but do NOT throw — the match is already
    // recorded as completed and we shouldn't revert simulation work just
    // because a downstream effect (e.g. settlement) hit a transient DB
    // blip.  Each effect is independently retry-safe; cron will pick up
    // missed work in the next pass for season transitions, and a manual
    // settlement sweep can clean up any open wagers that slipped through.
    try {
      const settlement = await settleMatchWagers(
        supabase, match.id, result.finalScore[0], result.finalScore[1],
      );
      if (settlement.settled > 0) {
        console.log(`[match-worker] Settled ${settlement.settled} wagers, total payout ${settlement.totalPayout}`);
      }
    } catch (err) {
      console.warn(`[match-worker] settleMatchWagers threw for ${match.id}:`, (err as Error)?.message ?? err);
    }

    // Advance the cup bracket if this match belonged to one.  A no-op for
    // league matches (their competition has no bracket).  Draws are logged
    // but skipped — extra-time / penalty resolution is not yet simulated,
    // so a drawn cup match leaves the bracket frozen until a future slice
    // resolves the tie.
    await maybeAdvanceCupBracket(
      supabase,
      match.id,
      match.competition_id ?? null,
      match.home_team_id,
      match.away_team_id,
      result.finalScore[0],
      result.finalScore[1],
    );

    try {
      const seasonTx = await maybeTransitionSeasonForMatch(supabase, match.id);
      if (seasonTx.transitioned) {
        console.log(`[match-worker] Season opened for voting after match ${match.id}`);
      }
    } catch (err) {
      console.warn(`[match-worker] maybeTransitionSeasonForMatch threw for ${match.id}:`, (err as Error)?.message ?? err);
    }

    // ── Server-side memory writes ───────────────────────────────────────────
    // The browser-side MemoryWriteListener writes entity_memories rows for
    // every involved actor (referee + both managers) on `match.completed`,
    // but only when a user is online to receive the bus event.  This is the
    // server-side mirror — guarantees the corpus-enricher always has fresh
    // memories to consume, regardless of who's watching.  Dual writes
    // collapse to one row via the dedup unique index on
    // (entity_id, fact_kind, occurred_at, md5(payload)) in migration 0035.
    try {
      const memSummary = await writeMatchCompletionMemories(
        supabase,
        match.id,
        match.home_team_id,
        match.away_team_id,
        result.finalScore[0],
        result.finalScore[1],
        match.competition_id ?? '',
      );
      if (memSummary.inserted > 0) {
        console.log(`[match-worker] Wrote ${memSummary.inserted}/${memSummary.attempted} match_result memories for match ${match.id}`);
      }
    } catch (err) {
      console.warn(`[match-worker] writeMatchCompletionMemories threw for ${match.id}:`, (err as Error)?.message ?? err);
    }

    // ── Post-match Architect lore save ─────────────────────────────────────
    // Closes the architect_lore persistence loop: one Claude call to mint a
    // verdict + lore mutations (player arcs, manager fates, rivalry thread,
    // player relationships) which then feed every FUTURE match's
    // simulation via the synchronous getRelationshipFor / getFeaturedMortals
    // / getActiveRelationships reads gameEngine.js makes.
    //
    // Failures are non-blocking — the match is already recorded as completed
    // and a missed save just means the next match runs with the same lore
    // it would have had anyway.  We MUST await loreStore.flush() before
    // returning so the Deno isolate doesn't get reclaimed mid-upsert and
    // silently drop the mutations.
    try {
      await postMatchLoreSave(architect, loreStore, match, result, homeData, awayData);
    } catch (err) {
      console.warn(`[match-worker] postMatchLoreSave threw for ${match.id}:`, (err as Error)?.message ?? err);
    }

    console.log(`[match-worker] Match ${match.id} completed successfully`);
    return true;
  } catch (err) {
    console.error(`[match-worker] Error processing match ${match.id}:`, err);

    // ── Roll back partial state before reverting status ────────────────────
    // If the failure landed *after* some events / stat rows were already
    // inserted (e.g. a mid-match insert hit a CHECK violation), leaving the
    // partial rows in place would cause the next retry to duplicate them —
    // and `match_events` has no per-(match_id, minute, type) unique index to
    // catch that.  Delete cascade isn't an option because we want to keep
    // the failed match around to retry, so we explicitly clear any rows
    // this attempt left behind before flipping status back to 'scheduled'.
    await supabase.from('match_events').delete().eq('match_id', match.id);
    await supabase.from('match_player_stats').delete().eq('match_id', match.id);
    // Spatial position frames are cosmetic but must be cleaned up too so a
    // retry doesn't hit the (match_id, minute, second) primary-key conflict.
    await supabase.from('match_positions').delete().eq('match_id', match.id);

    // Revert status so another worker (or next cron invocation) will retry.
    // We don't throw — the worker must process the rest of the batch even
    // if one match fails.
    const { error: revertError } = await supabase
      .from('matches')
      .update({ status: 'scheduled', played_at: null })
      .eq('id', match.id);

    if (revertError) {
      console.error(`[match-worker] Failed to revert match ${match.id}:`, revertError);
    }

    return false;
  }
}

// ── Shared-secret auth (matches match-notify-worker, see migration 0052) ──
// Without this gate, anyone on the internet could POST and burn Anthropic
// tokens on every match-worker tick. The cron job (updated in 0052) sends
// `Authorization: Bearer <vault.worker_shared_secret>`; we compare in
// constant time. Fails closed when the env var is unset.

/** Hex-encoded shared secret; the deployed secret must match the vault row. */
const WORKER_SHARED_SECRET = Deno.env.get('WORKER_SHARED_SECRET') || '';

/** Constant-time string compare to defeat timing side-channels. */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aa = enc.encode(a);
  const bb = enc.encode(b);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i += 1) diff |= aa[i]! ^ bb[i]!;
  return diff === 0;
}

/** Reject if no env secret OR header missing OR token mismatched. */
function isAuthorized(req: Request): boolean {
  if (!WORKER_SHARED_SECRET) {
    console.warn('[match-worker] WORKER_SHARED_SECRET unset — rejecting all calls');
    return false;
  }
  const header = req.headers.get('Authorization') ?? '';
  if (!header.startsWith('Bearer ')) return false;
  return timingSafeEqual(header.slice('Bearer '.length).trim(), WORKER_SHARED_SECRET);
}

// ── Fan-out orchestration ──────────────────────────────────────────────────

/**
 * Count matches due for simulation right now (status='scheduled', scheduled_at
 * <= now).  Used by the dispatcher to size each fan-out wave.  Returns 0 on a
 * query error so a transient failure just means "nothing to fan out this pass"
 * rather than crashing the tick.
 *
 * @param opts.leagueOnly  Count only league matches — matches what the fan-out
 *   actually claims, so a queue of cup-only ties never spins empty waves.
 */
async function countDueMatches(opts?: { leagueOnly?: boolean }): Promise<number> {
  const now = new Date().toISOString();
  let query = supabase
    .from('matches')
    .select(opts?.leagueOnly ? 'id, competitions!inner(type)' : 'id', { count: 'exact', head: true })
    .eq('status', 'scheduled')
    .lte('scheduled_at', now);
  if (opts?.leagueOnly) query = query.eq('competitions.type', 'league');
  const { count, error } = await query;
  if (error) {
    console.error('[match-worker] COUNT due matches failed:', error);
    return 0;
  }
  return count ?? 0;
}

/**
 * Fire a single worker-mode self-invocation and resolve once it responds.  The
 * call lands in its OWN isolate (own CPU budget) and simulates exactly one
 * LEAGUE match (leagueOnly — cups are kept off the parallel path).  Returns true
 * if that isolate reported it processed a match; false on an empty claim, a
 * non-200, or any transport error (the caller treats false as "no progress").
 */
async function spawnWorker(): Promise<boolean> {
  try {
    const res = await fetch(SELF_INVOKE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${WORKER_SHARED_SECRET}`,
      },
      body: JSON.stringify({ mode: 'one', leagueOnly: true }),
    });
    if (!res.ok) {
      console.warn(`[match-worker] worker invocation returned ${res.status}`);
      return false;
    }
    const json = (await res.json().catch(() => null)) as { processed?: number } | null;
    return (json?.processed ?? 0) > 0;
  } catch (err) {
    console.warn('[match-worker] worker invocation failed:', (err as Error)?.message ?? err);
    return false;
  }
}

/**
 * Drain the due queue by fanning out parallel single-match worker invocations.
 *
 * Each wave launches up to FANOUT_CONCURRENCY workers at once — every one its
 * own isolate, so the CPU-heavy sims run truly in parallel instead of stacking
 * up in one isolate (which is what tripped the WORKER_LIMIT before).  We
 * re-count between waves so we launch exactly what's left, and stop as soon as
 * the queue is empty, a wave makes no progress, or the wave/time caps are hit.
 *
 * LEAGUE ONLY: workers claim league matches only (cup ties are drained by the
 * sequential backstop), so the count that sizes each wave must also be
 * league-only — otherwise a queue of cup ties would spin empty waves.
 *
 * Claims are atomic (claimNextDueMatch), so two workers can never grab the same
 * match even though they race in parallel.
 *
 * @returns Number of matches processed across all waves this tick.
 */
async function fanOutDueMatches(): Promise<number> {
  const startedAt = Date.now();
  let totalProcessed = 0;

  for (let wave = 0; wave < FANOUT_MAX_WAVES; wave++) {
    if (Date.now() - startedAt >= FANOUT_TIME_BUDGET_MS) break;
    const due = await countDueMatches({ leagueOnly: true });
    if (due === 0) break;

    const slots = Math.min(due, FANOUT_CONCURRENCY);
    const results = await Promise.all(Array.from({ length: slots }, () => spawnWorker()));
    const processedThisWave = results.filter(Boolean).length;
    totalProcessed += processedThisWave;

    // Every worker came back empty/errored — don't spin further this tick.
    if (processedThisWave === 0) break;
  }

  return totalProcessed;
}

/**
 * In-process fallback: claim + simulate matches one at a time within
 * CLAIM_TIME_BUDGET_MS.  Runs as the dispatcher's backstop AFTER fan-out, so it
 * no-ops (one empty claim) when fan-out already drained the queue, but still
 * guarantees forward progress if self-invocation is disabled or a wave failed —
 * degrading at worst to the pre-fan-out behaviour, never to "nothing happens".
 *
 * @returns Per-match tallies for the tick summary.
 */
async function processWithinBudget(): Promise<{ processed: number; succeeded: number; failed: number }> {
  const startedAt = Date.now();
  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  while (Date.now() - startedAt < CLAIM_TIME_BUDGET_MS) {
    const match = await claimNextDueMatch();
    if (!match) break; // nothing due (or we lost the claim race) — done this tick
    processed++;
    const ok = await processMatch(match);
    if (ok) succeeded++;
    else failed++;
  }
  return { processed, succeeded, failed };
}

/**
 * Worker mode (dispatcher → self, body {"mode":"one"}): claim and simulate
 * exactly ONE due match, then return.  Runs in its own isolate so a single
 * 90-minute sim has the whole CPU budget to itself.  Skips the odds/reaper
 * housekeeping — that's the dispatcher's once-per-tick job.
 *
 * @param leagueOnly  Forwarded from the request body; the dispatcher fans out
 *   with leagueOnly=true so parallel workers never claim cup ties.
 */
async function runWorkerMode(leagueOnly: boolean): Promise<Response> {
  const match = await claimNextDueMatch({ leagueOnly });
  if (!match) return new Response(JSON.stringify({ processed: 0 }), { status: 200 });
  const ok = await processMatch(match);
  return new Response(
    JSON.stringify({ processed: 1, succeeded: ok ? 1 : 0, failed: ok ? 0 : 1 }),
    { status: 200 },
  );
}

/**
 * Dispatcher mode (the cron tick, body {}): do the once-per-tick housekeeping
 * (price upcoming odds, requeue orphaned in_progress matches), then fan out
 * parallel single-match workers to drain the due queue in seconds — so a whole
 * matchday's simultaneous kickoffs are all watchable live — with the in-process
 * loop as a guaranteed backstop.
 */
async function runDispatcherMode(): Promise<Response> {
  // ── Pre-claim: ensure odds exist for upcoming matches ────────────────────
  // Cheap when nothing's new to price.  Without odds the WagerWidget can't
  // render and placeWager has no snapshot.  Non-blocking — we still simulate
  // even if pricing the horizon failed entirely.
  try {
    const oddsSummary = await ensureOddsForUpcoming(supabase);
    if (oddsSummary.priced > 0) {
      console.log(`[match-worker] Priced ${oddsSummary.priced} new matches (${oddsSummary.skipped} already had odds, ${oddsSummary.considered} considered)`);
    }
  } catch (err) {
    console.warn('[match-worker] ensureOddsForUpcoming threw:', (err as Error)?.message ?? err);
  }

  // ── Recover orphans before claiming, so a stranded match rejoins the queue
  // this same tick.  Non-fatal: a failure here must not block fresh work.
  try {
    const requeued = await requeueStaleInProgress();
    if (requeued > 0) console.log(`[match-worker] Requeued ${requeued} stale in_progress match(es)`);
  } catch (err) {
    console.warn('[match-worker] requeueStaleInProgress threw:', (err as Error)?.message ?? err);
  }

  // ── Fan out LEAGUE matches: parallel single-match isolates drain the round
  // in seconds so a whole matchday's simultaneous kickoffs are all watchable
  // live.  Cup ties are deliberately excluded (see claimNextDueMatch) — their
  // shared bracket JSON isn't safe to advance concurrently.  Skipped only if
  // self-invocation isn't configured (SUPABASE_URL unset).
  let fannedOut = 0;
  if (SELF_INVOKE_URL) {
    fannedOut = await fanOutDueMatches();
  }

  // ── Backstop: sequentially drain whatever fan-out didn't — cup ties (kept off
  // the parallel path on purpose, so their bracket advances one at a time),
  // plus any league leftovers or a match that became due mid-tick.  No-ops when
  // the queue is already empty, so it's always safe to run.
  const local = await processWithinBudget();

  const processed = fannedOut + local.processed;
  if (processed === 0) {
    console.log('[match-worker] No due matches');
  } else {
    console.log(`[match-worker] Tick complete: ${fannedOut} via fan-out, ${local.processed} in-process`);
  }
  return new Response(
    JSON.stringify({ processed, fannedOut, inProcess: local.processed }),
    { status: 200 },
  );
}

// ── Main handler (Deno.serve entrypoint) ───────────────────────────────────

/**
 * HTTP entrypoint.  Two modes, both gated by the shared secret:
 *
 *   • Dispatcher (the pg_cron tick, body {}) — once-per-tick housekeeping then
 *     parallel fan-out; see runDispatcherMode.
 *   • Worker (dispatcher → self, body {"mode":"one"}) — simulate one match in
 *     its own isolate; see runWorkerMode.
 *
 * Returns 200 even on internal error so pg_cron doesn't back off; failures are
 * logged (and per-match work reverts to 'scheduled' for retry).
 */
Deno.serve(async (req: Request) => {
  if (!isAuthorized(req)) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Mode discriminator: the dispatcher self-calls with {"mode":"one"} (plus
  // leagueOnly); the cron job posts {} (→ dispatcher).  A malformed/empty body
  // defaults to dispatcher.
  let workerMode = false;
  let leagueOnly = false;
  try {
    const body = (await req.json().catch(() => null)) as { mode?: string; leagueOnly?: boolean } | null;
    workerMode = body?.mode === 'one';
    leagueOnly = body?.leagueOnly === true;
  } catch {
    workerMode = false;
  }

  try {
    if (workerMode) return await runWorkerMode(leagueOnly);
    console.log('[match-worker] Cron invocation (dispatcher)');
    return await runDispatcherMode();
  } catch (err) {
    console.error('[match-worker] Unhandled error:', err);
    // Return 200 so cron doesn't backoff; full error is in logs only
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 200 });
  }
});
