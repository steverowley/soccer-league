#!/usr/bin/env tsx
// ── scripts/match-worker.ts ──────────────────────────────────────────────────
// Package 10: server-side match simulation worker.
//
// WHY THIS PROCESS EXISTS
// ────────────────────────
// The live viewer (Package 11) reveals match events to clients using
// wall-clock elapsed time since kickoff — no streaming, no leader election.
// For that to work, *every* event for a 90-minute match must be pre-computed
// and persisted to `match_events` by the time real-world viewers start
// watching.  This worker is the process that does that work: it polls
// `matches` for fixtures whose `scheduled_at` has passed, simulates them via
// `simulateFullMatch()`, and writes the resulting event rows so the viewer can
// simply replay them at the correct pace.
//
// ARCHITECTURE OVERVIEW
// ──────────────────────
//   1.  Poll `matches` every POLL_INTERVAL_MS for rows with
//       `status = 'scheduled'` and `scheduled_at <= now()`.
//   2.  Claim each due match with an optimistic UPDATE
//       (`status → 'in_progress'`, `simulated_at → now()`).
//       The WHERE clause includes the original `status = 'scheduled'`
//       predicate so only one worker process can win the race; the others see
//       0 rows updated and skip silently.
//   3.  Fetch both teams from the DB and normalise them for the engine.
//   4.  Run `simulateFullMatch()` — a pure, synchronous function that drives
//       the game engine over 90 minutes and returns all events + final score.
//   5.  Batch-insert events into `match_events` in chunks of BATCH_SIZE to
//       stay within Supabase's payload limits.
//   6.  Update the match row to `status = 'completed'` with scores and
//       `played_at = now()`.
//   7.  Call `settleMatchWagers()` to resolve open bets and credit winners.
//   8.  On any error, flip the match back to `'scheduled'` so the next poll
//       can retry.  A real production system would use a dead-letter queue
//       or an `error_count` cap; for now simple retry-on-next-poll is enough.
//
// HOW TO RUN
// ──────────
//   SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> npx tsx scripts/match-worker.ts
//
//   Or export the vars in your shell / .env and run without prefixes.
//   The service-role key is required — the anon key cannot write to
//   `match_events` (RLS only allows service-role inserts).
//
// IMPORTANT: never commit SUPABASE_SERVICE_ROLE_KEY to version control.
// The service-role key bypasses Row Level Security entirely.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../src/types/database';
import { normalizeTeamForEngine } from '../src/lib/supabase';
import { simulateFullMatch }       from '../src/features/match/logic/simulateFullMatch';
import { settleMatchWagers }        from '../src/features/betting/api/wagers';
import { isSeasonComplete }         from '../src/features/match/logic/seasonLifecycle';
import {
  getSeasonIdForMatch,
  getSeasonStatus,
  getLeagueFixtureCountsForSeason,
  transitionSeasonStatus,
} from '../src/features/match/api/seasons';
import { enactSeasonFocuses }       from '../src/features/voting/api/enactment';

// ── Environment ───────────────────────────────────────────────────────────────

const SUPABASE_URL             = process.env['SUPABASE_URL']             ?? process.env['VITE_SUPABASE_URL'];
const SUPABASE_SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'];

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    '[match-worker] Missing required env vars: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
  );
  process.exit(1);
}

// ── Typed service-role client ─────────────────────────────────────────────────
// We need the service-role key (not the anon key) so we can:
//   • INSERT into match_events (RLS: service-role only)
//   • UPDATE matches.status beyond 'scheduled'
//   • UPDATE wager rows and profile credits during settlement
//
// This client is only created once and reused across all poll ticks.
type WorkerDb = SupabaseClient<Database>;

const db: WorkerDb = createClient<Database>(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      // Service-role clients must not attempt session management.
      // persistSession: false ensures no localStorage/cookie reads in Node.
      persistSession: false,
      autoRefreshToken: false,
    },
  },
);

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * How often the worker polls for due matches, in milliseconds.
 * 30 s is a comfortable cadence — even with a 1-minute kickoff cadence
 * (season_config.match_cadence_minutes = 1) the worst-case delay before
 * a match is picked up is 30 s, which is acceptable for a pre-sim model.
 *
 * Lowering this too far creates unnecessary DB load without meaningful benefit
 * since all event data is already pre-persisted for the viewer.
 */
const POLL_INTERVAL_MS = 30_000;

/**
 * Maximum number of match_events rows inserted per Supabase call.
 * Supabase's PostgREST layer has a default 1 MB payload cap; at ~300 bytes
 * per event row (most of which is the jsonb payload), 500 rows ≈ 150 KB —
 * well within the limit with comfortable headroom for larger payloads.
 *
 * A typical 90-minute match produces 50–120 events so one batch usually
 * suffices.  The batching code handles the edge case of longer matches.
 */
const BATCH_SIZE = 500;

// ── Type helpers ──────────────────────────────────────────────────────────────

// Supabase typed client doesn't expose a universal row type — we narrow
// inline where needed.  The IslSupabaseClient alias used by feature API
// modules resolves to the same SupabaseClient<Database> shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

// ── Season-end transition helper ─────────────────────────────────────────────

/**
 * Decide whether the just-completed match closed out its season's league
 * phase, and if so drive the lifecycle forward (active → voting → enacted)
 * with the optimistic-lock pattern that keeps concurrent workers safe.
 *
 * The function is split out of `processMatch` so the per-match try/catch
 * can isolate season-side failures without affecting the wager-settlement
 * branch above it.
 *
 * Flow:
 *   1. Resolve the match → season UUID (no FK so it's a two-hop query).
 *   2. Fetch the season's current status; bail unless it's still 'active'.
 *   3. Tally league fixtures; bail unless `isSeasonComplete` says yes.
 *   4. Optimistic UPDATE active → voting.  Only the worker that wins the
 *      race proceeds to enactment.
 *   5. Run `enactSeasonFocuses` server-side (mirrors the client-side
 *      SeasonEnactmentListener path so the React mount remains usable for
 *      manual / dev-mode triggering).
 *   6. Optimistic UPDATE voting → enacted on success.
 *
 * @param db        Service-role Supabase client.
 * @param matchId   UUID of the match that just completed.
 * @param tag       Log prefix (`[match-worker:<short-id>]`) for parity
 *                  with the rest of processMatch's logging.
 */
async function maybeTransitionSeason(
  db:       WorkerDb,
  matchId:  string,
  tag:      string,
): Promise<void> {
  // ── Step 1: resolve season ─────────────────────────────────────────────
  const seasonId = await getSeasonIdForMatch(db, matchId);
  if (!seasonId) return;

  // ── Step 2: short-circuit on already-advanced seasons ──────────────────
  // Each match completion calls this — for the 223 matches that are not
  // the season's last fixture, the status check returns 'active' but the
  // tally below leaves it unchanged.  For matches in already-closed
  // seasons (cup matches that ran past season end), we exit immediately.
  const status = await getSeasonStatus(db, seasonId);
  if (status !== 'active') return;

  // ── Step 3: fixture-count tally ────────────────────────────────────────
  const counts = await getLeagueFixtureCountsForSeason(db, seasonId);
  if (!isSeasonComplete(counts)) return;

  console.log(
    `${tag} season ${seasonId.slice(0, 8)} league phase complete ` +
      `(${counts.completed} completed, ${counts.cancelled} cancelled) — transitioning`,
  );

  // ── Step 4: active → voting (optimistic) ───────────────────────────────
  // The optimistic predicate ensures only one worker proceeds to step 5
  // even if several workers complete their last match at the same instant.
  const wonVoting = await transitionSeasonStatus(db, seasonId, 'active', 'voting');
  if (!wonVoting) {
    console.log(`${tag} season ${seasonId.slice(0, 8)} already past 'active' — skipping enactment`);
    return;
  }

  // ── Step 5: run enactment ──────────────────────────────────────────────
  // enactSeasonFocuses iterates all 32 teams, applies winning focuses,
  // writes focus_enacted rows, and is idempotent on the (team_id,
  // season_id, tier) UNIQUE constraint — re-running is safe if step 6
  // fails partway.
  const enactResult = await enactSeasonFocuses(db as AnyDb, seasonId);
  console.log(
    `${tag} enactment for season ${seasonId.slice(0, 8)}: ` +
      `enacted=${enactResult.enacted}, skipped=${enactResult.skipped}`,
  );

  // ── Step 6: voting → enacted ───────────────────────────────────────────
  // Closes the loop.  If this UPDATE fails (network blip), the season
  // sits in 'voting' until an admin nudge or the next match completion
  // re-runs steps 4-6 (step 4 is a no-op since status is already 'voting').
  const wonEnacted = await transitionSeasonStatus(db, seasonId, 'voting', 'enacted');
  if (wonEnacted) {
    console.log(`${tag} season ${seasonId.slice(0, 8)} → enacted`);
  } else {
    console.warn(`${tag} season ${seasonId.slice(0, 8)} enacted-transition lost race — manual check`);
  }
}

// ── Core: simulate one match ─────────────────────────────────────────────────

/**
 * Claim, simulate, persist, and settle a single due match.
 *
 * The match is claimed via an optimistic UPDATE so only one worker instance
 * can process it even if multiple workers are running concurrently.  All DB
 * mutations are wrapped in a try/catch that rolls the match back to
 * `'scheduled'` on failure so a subsequent poll can retry cleanly.
 *
 * @param matchId          UUID of the match to simulate.
 * @param homeTeamId       Home team slug (used to fetch the team from DB).
 * @param awayTeamId       Away team slug.
 */
async function processMatch(
  matchId: string,
  homeTeamId: string,
  awayTeamId: string,
): Promise<void> {
  const tag = `[match-worker:${matchId.slice(0, 8)}]`;

  // ── Step 1: Claim the match (optimistic lock) ────────────────────────────
  // The UPDATE returns the number of rows affected.  If another worker already
  // claimed this match (status is now 'in_progress'), we get 0 rows back and
  // exit early rather than double-simulating.
  const { data: claimed, error: claimErr } = await db
    .from('matches')
    .update({ status: 'in_progress', simulated_at: new Date().toISOString() })
    .eq('id', matchId)
    .eq('status', 'scheduled')   // Only wins the race if still 'scheduled'
    .select('id');

  if (claimErr) {
    console.warn(`${tag} claim failed:`, claimErr.message);
    return;
  }
  if (!claimed || claimed.length === 0) {
    // Another worker beat us to it — no-op is the correct response.
    console.log(`${tag} already claimed by another worker, skipping`);
    return;
  }

  console.log(`${tag} claimed — fetching teams`);

  try {
    // ── Step 2: Fetch teams from the DB ─────────────────────────────────────
    // We fetch both teams in parallel to minimise wall-clock time before the
    // simulation starts.  Players and managers are joined in the same query
    // (same pattern as getTeamForEngine in src/lib/supabase.js).
    const [homeResult, awayResult] = await Promise.all([
      (db as AnyDb)
        .from('teams')
        .select('*, players(*), managers(*)')
        .eq('id', homeTeamId)
        .single(),
      (db as AnyDb)
        .from('teams')
        .select('*, players(*), managers(*)')
        .eq('id', awayTeamId)
        .single(),
    ]);

    if (homeResult.error) throw new Error(`home team fetch failed: ${homeResult.error.message}`);
    if (awayResult.error) throw new Error(`away team fetch failed: ${awayResult.error.message}`);

    const homeTeam = normalizeTeamForEngine(homeResult.data);
    const awayTeam = normalizeTeamForEngine(awayResult.data);

    console.log(`${tag} simulating: ${homeTeam.name} vs ${awayTeam.name}`);

    // ── Step 3: Simulate all 90 minutes ────────────────────────────────────
    // simulateFullMatch is fully synchronous — it drives gameEngine.genEvent()
    // across minutes 1–90 and returns all events + final score in one call.
    // No I/O happens inside; the entire match is in memory within milliseconds.
    const result = simulateFullMatch(homeTeam, awayTeam);
    const [homeScore, awayScore] = result.finalScore;

    console.log(
      `${tag} simulated: ${homeScore}–${awayScore}, ${result.events.length} events`,
    );

    // ── Step 4: Persist events in batches ───────────────────────────────────
    // Each SimulatedEvent is augmented with the match_id FK before insert.
    // Batching avoids hitting PostgREST's ~1 MB payload cap on matches with
    // unusually high event counts (e.g. if extra-time events are added later).
    const rows = result.events.map((ev) => ({
      match_id:  matchId,
      minute:    ev.minute,
      subminute: ev.subminute,
      type:      ev.type,
      payload:   ev.payload,
    }));

    for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
      const batch = rows.slice(offset, offset + BATCH_SIZE);
      const { error: insertErr } = await db
        .from('match_events')
        .insert(batch);

      if (insertErr) throw new Error(`event insert batch ${offset} failed: ${insertErr.message}`);
    }

    // ── Step 5: Mark the match completed ───────────────────────────────────
    const { error: completeErr } = await db
      .from('matches')
      .update({
        status:     'completed',
        home_score: homeScore,
        away_score: awayScore,
        played_at:  new Date().toISOString(),
      })
      .eq('id', matchId);

    if (completeErr) throw new Error(`match completion update failed: ${completeErr.message}`);

    console.log(`${tag} completed: ${homeScore}–${awayScore}, mvp=${result.mvp}`);

    // ── Step 6: Settle open wagers ──────────────────────────────────────────
    // settleMatchWagers reads all open wagers for this match, resolves each
    // against the final score, updates wager rows, and credits winners.
    // Failures here are logged but do not roll back the match result — a failed
    // settlement is recoverable by re-running settlement; a failed match update
    // is harder to recover cleanly.
    try {
      const settled = await settleMatchWagers(db as AnyDb, matchId, homeScore, awayScore);
      if (settled > 0) console.log(`${tag} settled ${settled} wager(s)`);
    } catch (settleErr) {
      console.warn(`${tag} wager settlement error (match result preserved):`, settleErr);
    }

    // ── Step 7: Season-end check + enactment (Package 13) ──────────────────
    // After every match completes we check whether *this* completion was
    // the last one in the season's league phase.  When it is, we transition
    // seasons.status from 'active' → 'voting' and immediately run focus
    // enactment ('voting' → 'enacted').
    //
    // Why both transitions on the same tick: there's no human-driven gate
    // between "voting opens" and "enactment runs" in the current product;
    // the 48-hour voting window is enforced by the *vote-cast UI* not by
    // the worker, and any votes already cast are in `focus_votes` ready
    // for enactSeasonFocuses() to tally.  Splitting the transitions would
    // just add a second worker wakeup with no behavioural difference.
    //
    // The race-safety story: transitionSeasonStatus uses an optimistic
    // UPDATE WHERE status = expectedFromStatus, so even if multiple workers
    // close their last match at the same instant, only one wins each
    // transition and runs the side-effect.
    //
    // Failures here are logged but never roll back the match result —
    // a stuck 'voting' status can be retried from the next match
    // completion or by an admin manual transition.
    try {
      await maybeTransitionSeason(db as AnyDb, matchId, tag);
    } catch (seasonErr) {
      console.warn(`${tag} season-end check failed (match result preserved):`, seasonErr);
    }

  } catch (err) {
    // ── Error recovery: flip match back to 'scheduled' ──────────────────────
    // The simplest retry strategy: un-claim the match so the next poll tick
    // picks it up and tries again.  In a production system you'd track
    // retry_count and dead-letter after N failures; that complexity is
    // deferred until the worker is battle-tested.
    console.error(`${tag} simulation error — rolling back to 'scheduled':`, err);

    await db
      .from('matches')
      .update({ status: 'scheduled', simulated_at: null })
      .eq('id', matchId);
  }
}

// ── Poll loop ────────────────────────────────────────────────────────────────

/**
 * One poll tick: query for all scheduled matches whose kickoff has passed,
 * then simulate each one serially.
 *
 * Serial (not parallel) processing keeps the per-worker DB load predictable
 * and avoids contention on the `profiles.credits` read-modify-write inside
 * wager settlement.  A multi-worker deployment (for throughput) is handled
 * by the optimistic lock in `processMatch()`.
 */
async function poll(): Promise<void> {
  const { data: dueMatches, error } = await db
    .from('matches')
    .select('id, home_team_id, away_team_id')
    .eq('status', 'scheduled')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true }); // Oldest first — chronological order

  if (error) {
    console.warn('[match-worker] poll query failed:', error.message);
    return;
  }

  if (!dueMatches || dueMatches.length === 0) return;

  console.log(`[match-worker] ${dueMatches.length} match(es) due`);

  for (const match of dueMatches) {
    await processMatch(match.id, match.home_team_id, match.away_team_id);
  }
}

// ── Main entrypoint ───────────────────────────────────────────────────────────

console.log(
  `[match-worker] starting — polling every ${POLL_INTERVAL_MS / 1000}s`,
);

// Run an immediate poll at startup so the worker doesn't sit idle for up to
// POLL_INTERVAL_MS before processing already-due matches.
poll().catch(console.error);

// Recurring poll on a fixed interval.  setInterval fires POLL_INTERVAL_MS
// after the *previous tick started*, not after it finished — which is fine
// here since individual match simulations complete in <100ms and overlapping
// ticks are prevented by the optimistic lock anyway.
const timer = setInterval(() => {
  poll().catch(console.error);
}, POLL_INTERVAL_MS);

// ── Graceful shutdown ─────────────────────────────────────────────────────────
// Clear the interval so Node.js can exit cleanly when a SIGTERM or SIGINT
// is received (e.g. from a container orchestrator or Ctrl-C in the terminal).
function shutdown(signal: string): void {
  console.log(`[match-worker] received ${signal}, shutting down`);
  clearInterval(timer);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
