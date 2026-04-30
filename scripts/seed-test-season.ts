#!/usr/bin/env tsx
// ── scripts/seed-test-season.ts ──────────────────────────────────────────────
// Package 14: dev-only fast-cadence test season setup.
//
// WHY THIS PROCESS EXISTS
// ────────────────────────
// The production season cadence (1 match per day, 10 minutes per match)
// makes end-to-end testing of the playable-state loop impractical: a full
// 224-fixture season would take ~32 weeks of wall-clock time.  This script
// reconfigures Season 1 for *fast-cadence* testing — match every 5 minutes,
// each match revealed in 2 minutes — so a full season finishes in ~3.5 hours.
//
// WHAT IT TOUCHES
// ────────────────
//   1. season_config (season_id = ACTIVE_SEASON_ID)
//      • match_cadence_minutes  → FAST_CADENCE_MINUTES   (5 min)
//      • match_duration_seconds → FAST_DURATION_SECONDS  (120 s)
//      • min_bet stays at the production default — wager amounts shouldn't
//        change between dev/prod because tests assert against MIN_BET=10.
//   2. matches (status='scheduled' for active season)
//      • scheduled_at re-spread starting 1 minute from now, with
//        FAST_CADENCE_MINUTES gaps between successive fixtures.
//
// WHAT IT DOES NOT TOUCH (intentionally)
// ───────────────────────────────────────
//   • Players / managers / teams — rosters stay as seeded so the engine has
//     real opponents.  A future "wipe + reseed everything" mode can opt in
//     via a flag, but the current contract is "fast-forward Season 1".
//   • Cup brackets — Package 3's seedCupCompetitions writes those; they're
//     re-drawn from standings post-season anyway.
//   • Already-completed matches — leaving past results intact lets a tester
//     replay the season-end transition without re-running everything.
//
// HOW TO RUN
// ──────────
//   SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> npx tsx scripts/seed-test-season.ts
//
// IMPORTANT: never commit SUPABASE_SERVICE_ROLE_KEY to version control.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../src/types/database';

// ── Environment ───────────────────────────────────────────────────────────────

const SUPABASE_URL              = process.env['SUPABASE_URL']             ?? process.env['VITE_SUPABASE_URL'];
const SUPABASE_SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'];

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    '[seed-test-season] Missing required env vars: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
  );
  process.exit(1);
}

// ── Tunables ─────────────────────────────────────────────────────────────────

/**
 * Real-world minutes between consecutive kickoffs.  At 5 min × 224 fixtures
 * a Season 1 round-robin takes ~18.5 hours of wall-clock time — short
 * enough to overnight, long enough to inspect each match in the live
 * viewer rather than blink-and-miss-it.
 */
const FAST_CADENCE_MINUTES = 5;

/**
 * Real-world seconds the live viewer uses to reveal a 90-minute match.
 * 120 s = 2 minutes real-time per match, so the match-worker has time to
 * pre-simulate before the wall clock catches up.
 */
const FAST_DURATION_SECONDS = 120;

/**
 * UUID of the Season 1 row created by `supabase/seed.sql`.  Hard-coded
 * because the test season is the only one we ever fast-cadence — pulling
 * the active season at runtime would silently target whatever happens to
 * be active and could clobber a half-finished real run.
 */
const ACTIVE_SEASON_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Lead time (real seconds) before the first match's scheduled_at.  Gives
 * the operator a moment to start the worker after the script finishes
 * before fixtures start firing.  60 seconds is generous; tighten if your
 * worker boot is faster.
 */
const FIRST_MATCH_LEAD_SECONDS = 60;

// ── Service-role client ──────────────────────────────────────────────────────

type WorkerDb = SupabaseClient<Database>;

const db: WorkerDb = createClient<Database>(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      // No browser session in a CLI context — disable both knobs.
      persistSession:   false,
      autoRefreshToken: false,
    },
  },
);

// Same escape hatch the other scripts use for tables not yet in
// generated types (CAST:season_config, CAST:matches.scheduled_at).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

// ── Step 1: cadence + duration knobs ─────────────────────────────────────────

/**
 * Upsert the season_config row for the active season with fast-cadence
 * values.  ON CONFLICT (season_id) ensures a re-run cleanly overwrites a
 * previous test-season setup without raising a duplicate-key error.
 */
async function configureFastCadence(): Promise<void> {
  const { error } = await (db as AnyDb)
    .from('season_config')
    .upsert(
      {
        season_id:              ACTIVE_SEASON_ID,
        match_cadence_minutes:  FAST_CADENCE_MINUTES,
        match_duration_seconds: FAST_DURATION_SECONDS,
        // `updated_at` is left to the server's NOW() default.
      },
      { onConflict: 'season_id' },
    );

  if (error) {
    console.error('[seed-test-season] season_config upsert failed:', error.message);
    process.exit(2);
  }

  console.log(
    `[seed-test-season] season_config set: cadence=${FAST_CADENCE_MINUTES}min, duration=${FAST_DURATION_SECONDS}s`,
  );
}

// ── Step 2: re-spread scheduled match kickoffs ───────────────────────────────

/**
 * Pull every still-scheduled match for the active season and rewrite each
 * `scheduled_at` to a new evenly-spaced timestamp starting
 * `FIRST_MATCH_LEAD_SECONDS` from now.  Already-completed and in-progress
 * matches are left alone so a partial-season replay still works.
 *
 * Order: we sort by current `scheduled_at` ascending so the rewrite
 * preserves the original season calendar order — important for tests that
 * depend on conference matchday sequencing.
 */
async function rescheduleUpcomingMatches(): Promise<void> {
  // Two-hop join: matches → competitions → season_id matches our target.
  // We pull the competition list first to keep the matches query plan
  // index-friendly.
  const { data: comps, error: compErr } = await (db as AnyDb)
    .from('competitions')
    .select('id')
    .eq('season_id', ACTIVE_SEASON_ID);

  if (compErr) {
    console.error('[seed-test-season] competitions read failed:', compErr.message);
    process.exit(3);
  }

  const competitionIds = ((comps ?? []) as Array<{ id: string }>).map((c) => c.id);
  if (competitionIds.length === 0) {
    console.warn('[seed-test-season] no competitions for season — nothing to reschedule');
    return;
  }

  const { data: matches, error: matchErr } = await (db as AnyDb)
    .from('matches')
    .select('id, scheduled_at')
    .in('competition_id', competitionIds)
    .eq('status', 'scheduled')
    .order('scheduled_at', { ascending: true, nullsFirst: false });

  if (matchErr) {
    console.error('[seed-test-season] matches read failed:', matchErr.message);
    process.exit(4);
  }

  const rows = (matches ?? []) as Array<{ id: string }>;
  if (rows.length === 0) {
    console.warn('[seed-test-season] no scheduled matches — nothing to reschedule');
    return;
  }

  // Compute the new timestamps once, outside the write loop, so timing
  // drift across the per-row UPDATEs doesn't shift the cadence.
  const baseMs    = Date.now() + FIRST_MATCH_LEAD_SECONDS * 1_000;
  const cadenceMs = FAST_CADENCE_MINUTES * 60_000;

  let written = 0;
  for (let i = 0; i < rows.length; i++) {
    const next = new Date(baseMs + i * cadenceMs).toISOString();
    const { error: writeErr } = await (db as AnyDb)
      .from('matches')
      .update({ scheduled_at: next })
      .eq('id', rows[i]!.id);
    if (!writeErr) written++;
    else console.warn(`[seed-test-season] match ${rows[i]!.id} update failed: ${writeErr.message}`);
  }

  const lastMs   = baseMs + (rows.length - 1) * cadenceMs;
  const lastIso  = new Date(lastMs).toISOString();
  console.log(
    `[seed-test-season] rescheduled ${written}/${rows.length} matches over ` +
      `${(rows.length * FAST_CADENCE_MINUTES / 60).toFixed(1)}h, last kickoff at ${lastIso}`,
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

/**
 * Top-level entrypoint.  Runs the two steps sequentially because step 2
 * doesn't need step 1's data — it's just easier to reason about a strict
 * "knobs first, then schedule" ordering.  Exit codes:
 *   0 — happy path (including "no scheduled matches found" no-op).
 *   1 — env vars missing.
 *   2/3/4 — query failures (upsert / competitions / matches respectively).
 *   3rd-party errors are caught at the outer .catch() and become exit 5.
 */
async function run(): Promise<void> {
  console.log(`[seed-test-season] target season ${ACTIVE_SEASON_ID}`);
  await configureFastCadence();
  await rescheduleUpcomingMatches();
  console.log('[seed-test-season] done — start the worker to begin simulation');
}

run().catch((err) => {
  console.error('[seed-test-season] fatal:', err);
  process.exit(5);
});
