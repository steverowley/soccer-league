#!/usr/bin/env tsx
// ── scripts/rollover-season.ts ───────────────────────────────────────────────
// Rolls the league forward from season N to season N+1.
//
// WHY THIS SCRIPT EXISTS
// ──────────────────────
// When a season's league phase ends, the match worker transitions the season
// to 'enacted' (active → voting → enacted via maybeTransitionSeason).  After
// that, three things must happen before play can resume:
//
//   1. Seed the Celestial Cup + Solar Shield brackets for the ending season
//      (based on final league standings — top-3 and 4th–6th per league).
//   2. Create the next season row + 4 league competitions + 224 fixtures.
//   3. Generate focus_options for all 32 teams for the new season, so the
//      voting page is ready the moment the new season is live.
//
// This script handles all three steps in sequence.  Each step is idempotent
// via ON CONFLICT / upsert, so partial failures can be retried safely.
//
// ARCHITECTURE NOTES
// ──────────────────
// Cup seeding for the CURRENT season uses the existing `seedCupCompetitions`
// function, which for Season 1→2 reads from the hardcoded Season 1 league
// competition UUIDs.  For future rollovers (Season 2→3), that function will
// need the generalized league-comp-id injection path.  This script's cup-row
// creation step (Step 5) inserts empty competition rows for the NEW season;
// their brackets are populated at the END of the new season's league phase.
//
// WHAT IT TOUCHES
// ────────────────
//   • seasons              — 1 new row; previous season is_active → false
//   • competitions         — 4 league + 2 cup rows for the new season
//   • competition_teams    — populated for each new league competition
//   • matches              — 224 round-robin fixtures for the new season
//   • focus_options        — upserted (9 templates × 32 teams) for new season
//   • competitions.bracket — written by seedCupCompetitions for CURRENT season
//
// HOW TO RUN
// ──────────
//   SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> \
//     npx tsx scripts/rollover-season.ts \
//     [--from-season=<uuid>] [--cadence-minutes=<n>] [--first-kickoff=<iso>]
//
// CLI options:
//   --from-season=<uuid>     Season to roll over FROM.
//                            Default: auto-detect the most recently 'enacted' season.
//   --cadence-minutes=<n>    Minutes between consecutive matchday slots.
//                            Default: 20160 (14 days).  Use 60–300 for fast-cadence
//                            testing; use seed-test-season.ts to re-spread afterwards.
//   --first-kickoff=<iso>    UTC timestamp for matchday 1.
//                            Default: 7 days from now.
//
// IMPORTANT: never commit SUPABASE_SERVICE_ROLE_KEY to version control.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database }                      from '../src/types/database';
import { seedCupCompetitions }                from '../src/features/match/api/cupSeeder';
import { rolloverSeason }                     from '../src/features/match/api/seasonRollover';

// ── Environment ───────────────────────────────────────────────────────────────

const SUPABASE_URL              = process.env['SUPABASE_URL']             ?? process.env['VITE_SUPABASE_URL'];
const SUPABASE_SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'];

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    '[rollover-season] Missing required env vars: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
  );
  process.exit(1);
}

// ── CLI arg parsing ───────────────────────────────────────────────────────────

/**
 * Pull the value of a `--name=value` flag from process.argv.
 * Returns undefined if the flag is absent (caller supplies a default).
 */
function getArg(name: string): string | undefined {
  const flag  = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(flag));
  return found ? found.slice(flag.length) : undefined;
}

/**
 * Real-world minutes between consecutive matchday slots in a new season.
 * 20160 = 14 days — matches the original Season 1 cadence from migration
 * 0009 (matchdays every 14 days, 14 matchdays total = 28 weeks of play).
 * Override via --cadence-minutes for fast-cadence test runs.
 */
const DEFAULT_CADENCE_MINUTES = 20_160;

/**
 * Default offset (in ms) from now to the first matchday kickoff.
 * 7 days gives operators comfortable lead time to verify the new season data
 * before the worker starts simulating.
 */
const DEFAULT_FIRST_KICKOFF_MS = Date.now() + 7 * 24 * 60 * 60_000;

const ARG_FROM_SEASON   = getArg('from-season');
const ARG_CADENCE       = getArg('cadence-minutes');
const ARG_FIRST_KICKOFF = getArg('first-kickoff');

const CADENCE_MS       = (ARG_CADENCE ? parseInt(ARG_CADENCE, 10) : DEFAULT_CADENCE_MINUTES) * 60_000;
const FIRST_KICKOFF_MS = ARG_FIRST_KICKOFF
  ? Date.parse(ARG_FIRST_KICKOFF)
  : DEFAULT_FIRST_KICKOFF_MS;

if (isNaN(CADENCE_MS) || CADENCE_MS <= 0) {
  console.error('[rollover-season] invalid --cadence-minutes value');
  process.exit(1);
}
if (isNaN(FIRST_KICKOFF_MS)) {
  console.error('[rollover-season] invalid --first-kickoff value (must be ISO timestamp)');
  process.exit(1);
}

// ── Supabase client ───────────────────────────────────────────────────────────

type WorkerDb = SupabaseClient<Database>;

const db: WorkerDb = createClient<Database>(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

// Tables not yet in the generated database.ts use this escape hatch.
// Grepping for CAST:rollover lets us audit what needs removing after the
// next `generate_typescript_types` run following schema changes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

// ── Shared types ──────────────────────────────────────────────────────────────

interface SeasonRow {
  id:   string;
  name: string;
  year: number;
}

// ── Step 1: resolve the season we're rolling over FROM ───────────────────────

/**
 * Return the season row to roll over.  Uses the `--from-season` CLI flag
 * if provided; otherwise auto-detects the most recently enacted season.
 *
 * Exits the process (code 2) if the season cannot be found — a missing
 * source season would produce an orphaned new season with wrong metadata.
 *
 * @returns The seasons row for the season being closed out.
 */
async function resolveCurrentSeason(): Promise<SeasonRow> {
  if (ARG_FROM_SEASON) {
    const { data, error } = await db
      .from('seasons')
      .select('id, name, year')
      .eq('id', ARG_FROM_SEASON)
      .single();

    if (error || !data) {
      console.error(`[rollover-season] season ${ARG_FROM_SEASON} not found:`, error?.message);
      process.exit(2);
    }
    return data as SeasonRow;
  }

  // Auto-detect: pick the highest-year season in 'enacted' status.
  // ORDER BY year DESC + LIMIT 1 handles the (rare) case where two seasons
  // are both enacted simultaneously during a botched parallel rollover.
  const { data, error } = await (db as AnyDb)
    .from('seasons')
    .select('id, name, year')
    .eq('status', 'enacted')
    .order('year', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    console.error(
      '[rollover-season] no enacted season found — use --from-season=<uuid> to specify one, ' +
      'or transition the current season to enacted first.',
      error?.message ?? '',
    );
    process.exit(2);
  }
  return data as SeasonRow;
}

// ── Step 2: seed Celestial Cup + Solar Shield for the ending season ───────────

/**
 * Draw and persist the Celestial Cup and Solar Shield brackets for the
 * season that is rolling off.  Delegates to `seedCupCompetitions`, which
 * reads each league's final standings and applies the 1..12 seeding rule
 * (interleaved by finishing position across leagues).
 *
 * Idempotent: if the season's cup brackets are already written, `seedOneCup`
 * returns `already_seeded` and no DB writes occur.
 *
 * `seedCupCompetitions` resolves the season's OWN league + cup competitions
 * dynamically (by season_id + canonical league order; cups matched by name), so
 * this works for any season — Season 1 → 2, Season 2 → 3, and beyond.
 *
 * @param seasonId UUID of the season whose cups we are seeding.
 */
async function seedCurrentSeasonCups(seasonId: string): Promise<void> {
  console.log(`[rollover-season] seeding cups for season ${seasonId.slice(0, 8)} …`);

  const result = await seedCupCompetitions(db as AnyDb, seasonId);

  for (const [tier, res] of [
    ['celestial', result.celestial  ],
    ['shield',    result.solarShield],
  ] as const) {
    console.log(
      `[rollover-season]   ${tier}: ${res.status}, ` +
      `qualifiers=${res.qualifiers}, r1Matches=${res.round1Matches}`,
    );
  }
}

// ── Steps 3–6: build the new season (delegated to the shared module) ──────────
//
// The season/competition/fixture/cup/focus-option creation logic used to live
// inline in this script.  It now lives in the unit-tested, idempotent
// `rolloverSeason` (src/features/match/api/seasonRollover.ts), shared with the
// scheduled `enact-due-seasons` job (#568).  This CLI keeps only the operator
// surface — env, flags, cup-seeding of the OLD season, and exit codes.

// ── Main ──────────────────────────────────────────────────────────────────────

/**
 * Orchestrates the full season rollover.  Runs the steps sequentially:
 *   1. Resolve the season being closed out (CLI flag or auto-detect).
 *   2. Seed the OLD season's cup brackets from its final standings.
 *   3–6. Build the NEW season via `rolloverSeason` (idempotent).
 *
 * Exit codes:
 *   0  — completed (including an idempotent already-rolled no-op).
 *   1  — env vars missing or invalid CLI args.
 *   2  — source season not found.
 *   3  — new season build failed (no new season id returned).
 *   5  — unexpected thrown error.
 */
async function run(): Promise<void> {
  const firstKickoffIso = new Date(FIRST_KICKOFF_MS).toISOString();
  const lastMatchdayMs  = FIRST_KICKOFF_MS + 13 * CADENCE_MS; // matchday 14 (0-based idx 13)
  const lastKickoffIso  = new Date(lastMatchdayMs).toISOString();
  const cadenceHours    = (CADENCE_MS / 3_600_000).toFixed(1);

  console.log('[rollover-season] starting season rollover');
  console.log(`[rollover-season]   first matchday : ${firstKickoffIso}`);
  console.log(`[rollover-season]   last matchday  : ${lastKickoffIso}`);
  console.log(`[rollover-season]   matchday gap   : ${cadenceHours}h`);

  // Step 1: identify the season being closed out.
  const currentSeason = await resolveCurrentSeason();
  console.log(
    `[rollover-season] from: ${currentSeason.name} (${currentSeason.id.slice(0, 8)})`,
  );

  // Step 2: seed cup brackets for the ending season from its final standings.
  await seedCurrentSeasonCups(currentSeason.id);

  // Steps 3–6: build the new season (idempotent — re-runs are no-ops).
  const result = await rolloverSeason(db, currentSeason.id, {
    firstKickoffMs: FIRST_KICKOFF_MS,
    cadenceMs:      CADENCE_MS,
  });

  if (result.alreadyRolled) {
    console.log(
      `[rollover-season] already rolled — ${result.newSeasonName} ` +
      `(${result.newSeasonId?.slice(0, 8)}) exists; nothing to do.`,
    );
    return;
  }

  if (!result.newSeasonId) {
    console.error('[rollover-season] season build failed — no new season created.');
    process.exit(3);
  }

  console.log(
    `[rollover-season] created ${result.newSeasonName} (${result.newSeasonId.slice(0, 8)}): ` +
    `${result.competitionsCreated} leagues, ${result.fixturesCreated} fixtures, ` +
    `${result.cupRowsCreated} cups, ${result.focusOptionRows} focus_options`,
  );
  console.log(
    `[rollover-season] done — ${result.newSeasonName} ready. ` +
    `Fixtures span ${firstKickoffIso} → ${lastKickoffIso}. ` +
    `Start the match worker to begin simulation.`,
  );
}

run().catch((err) => {
  console.error('[rollover-season] fatal:', err);
  process.exit(5);
});
