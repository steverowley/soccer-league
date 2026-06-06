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
    for (const s of due) console.log(`[enact-due-seasons] (dry-run) would enact ${s.id}`);
    return;
  }

  for (const s of due) {
    const result = await enactSeasonFocuses(db, s.id);
    console.log(
      `[enact-due-seasons] season ${s.id.slice(0, 8)}: ` +
      `enacted=${result.enacted} skipped=${result.skipped} (${result.details.length} teams)`,
    );
  }
}

run().catch((err) => {
  console.error('[enact-due-seasons] fatal:', err);
  process.exit(5);
});
