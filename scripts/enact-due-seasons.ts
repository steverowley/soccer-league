#!/usr/bin/env tsx
// ── scripts/enact-due-seasons.ts ──────────────────────────────────────────────
// Server-side trigger for end-of-season focus enactment (#529).
//
// WHY THIS SCRIPT EXISTS
// ──────────────────────
// When a season's league phase ends, the match-worker transitions it
// active → voting and stamps the voting-open timestamp.  The "vote reshapes
// your club" payoff — applying each team's winning focus to its roster — must
// then fire once the voting window closes.  That used to ride an in-browser
// `season.ended` listener (removed in #372), so it never fired on its own.
//
// This runner reuses the existing, unit-tested `enactSeasonFocuses` directly
// from a Node process with the service-role key (the same pattern as
// rollover-season.ts).  We deliberately do NOT port that logic into the Deno
// match-worker — it pulls in ~1,400 lines of TypeScript the Deno runtime can't
// import and the compiler can't check.  A scheduled GitHub Action invokes this
// script (see .github/workflows/enact-due-seasons.yml).
//
// IDEMPOTENT BY DESIGN
// ────────────────────
// `enactSeasonFocuses` guards each (team, season, tier) on an existing
// `focus_enacted` row before mutating, so re-running on an already-enacted
// season is a no-op.  This script is therefore safe to run on any cadence and
// safe to retry; it does not transition the season's status (that, plus the
// Election Night ceremony, is a separate season-lifecycle concern).
//
// HOW TO RUN
// ──────────
//   SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> \
//     npx tsx scripts/enact-due-seasons.ts [--dry-run]
//
// Env / flags:
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  Required. Service-role bypasses RLS.
//   ENACT_AFTER_HOURS=<n>                     Voting window before enactment (default 48).
//   --dry-run                                 List due seasons; do not enact.
//
// IMPORTANT: never commit SUPABASE_SERVICE_ROLE_KEY to version control.

import { createClient } from '@supabase/supabase-js';
import type { Database } from '../src/types/database';
import { enactSeasonFocuses } from '../src/features/voting/api/enactment';
import {
  isSeasonDueForEnactment,
  DEFAULT_ENACTMENT_WINDOW_HOURS,
  type SchedulableSeason,
} from '../src/features/voting/logic/enactmentSchedule';
import { transitionSeasonStatus } from '../src/features/match';
// rolloverSeason is imported via its deep path (not the @features/match barrel)
// because it is server-only — it imports node:crypto, which must never reach the
// browser bundle. Scripts live outside src/, so the barrel-only import rule
// doesn't apply here.
import { rolloverSeason } from '../src/features/match/api/seasonRollover';

// ── Environment ───────────────────────────────────────────────────────────────

const SUPABASE_URL              = process.env['SUPABASE_URL'] ?? process.env['VITE_SUPABASE_URL'];
const SUPABASE_SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'];

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[enact-due-seasons] Missing required env vars: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const WINDOW_HOURS = process.env['ENACT_AFTER_HOURS']
  ? parseInt(process.env['ENACT_AFTER_HOURS'], 10)
  : DEFAULT_ENACTMENT_WINDOW_HOURS;

if (isNaN(WINDOW_HOURS) || WINDOW_HOURS < 0) {
  console.error('[enact-due-seasons] invalid ENACT_AFTER_HOURS value');
  process.exit(1);
}

const DRY_RUN = process.argv.includes('--dry-run');

// ── Rollover scheduling constants (#568) ──────────────────────────────────────
// When a season's focuses are enacted, this job rolls the league forward into
// the next season.  These two values anchor the new season's fixture calendar:

/**
 * Lead time (ms) from the rollover moment to the new season's matchday 1.
 * 7 days gives the new fixtures a comfortable buffer before the match worker
 * starts claiming them, mirroring the rollover CLI's default first-kickoff
 * offset.
 */
const ROLLOVER_FIRST_KICKOFF_OFFSET_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Real-world gap (ms) between consecutive matchdays in the new season.
 * ONE DAY: a matchday every day keeps matches (and betting) live daily and a
 * 14-matchday league season completes in two weeks.  The previous value here
 * was 14 days, justified by a comment claiming it "matches the production
 * Season 1 cadence" — that was wrong (Season 1 ran daily) and it left betting
 * dark 13 days out of 14.  Owner decision 2026-07-16: daily.
 */
const ROLLOVER_CADENCE_MS = 24 * 60 * 60 * 1000;

/**
 * Gap (ms) between kickoffs within a matchday (see RolloverOptions).
 * 15 minutes × 4 slots/league, with leagues interleaved a quarter-slot apart,
 * yields one kickoff roughly every 3–4 minutes across a ~1-hour window — the
 * match worker claims a steady trickle instead of 16 fixtures at one instant
 * (the 2026-07-16 worker/database outage).
 */
const ROLLOVER_KICKOFF_STAGGER_MS = 15 * 60 * 1000;

const db = createClient<Database>(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

// ── Main ──────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const { data, error } = await db
    .from('seasons')
    .select('id, status, election_opens_at, ended_at')
    .eq('status', 'voting');

  if (error) {
    console.error('[enact-due-seasons] seasons query failed:', error.message);
    process.exit(4);
  }

  const seasons = (data ?? []) as SchedulableSeason[];
  const now = Date.now();
  const due = seasons.filter((s) => isSeasonDueForEnactment(s, now, WINDOW_HOURS));

  console.log(
    `[enact-due-seasons] ${seasons.length} season(s) in voting; ` +
    `${due.length} past the ${WINDOW_HOURS}h window`,
  );

  if (due.length === 0) return;

  if (DRY_RUN) {
    for (const s of due) {
      console.log(`[enact-due-seasons] (dry-run) would enact ${s.id}`);
      console.log(`[enact-due-seasons] (dry-run) would roll over ${s.id} → next season`);
    }
    return;
  }

  for (const s of due) {
    // ── Step 1: apply each team's winning focus to its roster ────────────────
    const result = await enactSeasonFocuses(db, s.id);
    console.log(
      `[enact-due-seasons] season ${s.id.slice(0, 8)}: ` +
      `enacted=${result.enacted} skipped=${result.skipped} (${result.details.length} teams)`,
    );

    // ── Step 2: advance the lifecycle and roll the league forward (#568) ─────
    // The season loop must be perpetual: once focuses are enacted, advance
    // voting → enacted → archived and create the next season.  Every step is
    // CAS/guard-protected, so re-running this job (e.g. the next scheduled
    // tick before the first finished) is a safe no-op.

    // 2a. voting → enacted (compare-and-swap).  A `false` return means either
    //     we lost the race or the season already moved past 'voting'; in both
    //     cases we still try to roll over (rolloverSeason's own year-guard
    //     makes that idempotent).
    const wonEnacted = await transitionSeasonStatus(db, s.id, 'voting', 'enacted');
    console.log(
      `[enact-due-seasons] season ${s.id.slice(0, 8)}: ` +
      `voting→enacted ${wonEnacted ? 'won' : 'already past'}`,
    );

    // 2b. Build the next season (idempotent — guards on year+1 existence).
    const rollover = await rolloverSeason(db, s.id, {
      firstKickoffMs:   Date.now() + ROLLOVER_FIRST_KICKOFF_OFFSET_MS,
      cadenceMs:        ROLLOVER_CADENCE_MS,
      kickoffStaggerMs: ROLLOVER_KICKOFF_STAGGER_MS,
    });
    console.log(
      `[enact-due-seasons] season ${s.id.slice(0, 8)}: ` +
      (rollover.alreadyRolled
        ? `already rolled → ${rollover.newSeasonName} (${rollover.newSeasonId?.slice(0, 8)})`
        : `rolled over → ${rollover.newSeasonName} ` +
          `(${rollover.competitionsCreated} leagues, ${rollover.fixturesCreated} fixtures, ` +
          `${rollover.cupRowsCreated} cups, ${rollover.focusOptionRows} focus_options)`),
    );

    // 2c. enacted → archived, but only once the next season actually exists
    //     (created this run or already present).  Otherwise we leave the
    //     season in 'enacted' so a later retry can complete the rollover.
    if (rollover.newSeasonId || rollover.alreadyRolled) {
      const wonArchived = await transitionSeasonStatus(db, s.id, 'enacted', 'archived');
      console.log(
        `[enact-due-seasons] season ${s.id.slice(0, 8)}: ` +
        `enacted→archived ${wonArchived ? 'won' : 'already past'}`,
      );
    } else {
      console.warn(
        `[enact-due-seasons] season ${s.id.slice(0, 8)}: ` +
        `rollover did not produce a next season — leaving in 'enacted' for retry`,
      );
    }
  }
}

run().catch((err) => {
  console.error('[enact-due-seasons] fatal:', err);
  process.exit(5);
});
