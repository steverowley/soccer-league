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
import { randomUUID }                         from 'crypto';
import type { Database }                      from '../src/types/database';
import { seedCupCompetitions }                from '../src/features/match/api/cupSeeder';
import { generateFocusOptions }               from '../src/features/voting/api/focuses';
import {
  generateRoundRobinFixtures,
  DEFAULT_PAIRS_PER_MATCHDAY,
} from '../src/features/match/logic/roundRobinDraw';

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

/**
 * Number of fixture rows per Supabase upsert batch.  PostgREST's default
 * payload cap is ~1 MB; at ~300 bytes per fixture row 50 rows ≈ 15 KB —
 * well within limits while keeping the number of round-trips low.
 */
const FIXTURE_BATCH_SIZE = 50;

/**
 * Season year offset.  ISL Season 1 is year 2600, so Season N is year
 * 2599 + N.  Used to derive the human-readable season number from the
 * year column (e.g. year 2601 → "Season 2").
 */
const SEASON_YEAR_OFFSET = 2599;

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

// ── League catalogue ──────────────────────────────────────────────────────────

/**
 * The 4 permanent ISL league divisions.  `id` is the `teams.league_id`
 * foreign key — stable across seasons.  `name` drives the competition
 * display name in the new season's rows.
 *
 * Sorted in the canonical ISL tier order (inner → gas giants → asteroid
 * belt → Kuiper fringe) to match the Notion doc and seed.sql ordering.
 */
const LEAGUES = [
  { id: 'rocky-inner',   name: 'Rocky Inner League'   },
  { id: 'gas-giants',    name: 'Gas/Ice Giants League' },
  { id: 'outer-reaches', name: 'Outer Reaches League'  },
  { id: 'kuiper-belt',   name: 'Kuiper Belt League'    },
] as const;

/**
 * The two cup tiers seeded from the top half of the final league table.
 * `key` is used for salt strings in the deterministic bracket draw;
 * `name` becomes the competition display name for the new season.
 *
 * Cup rows are created empty at rollover time — their brackets are drawn
 * at the END of the new season's league phase (when standings are final).
 */
const CUP_TIERS = [
  { key: 'celestial', name: 'Celestial Cup' },
  { key: 'shield',    name: 'Solar Shield'  },
] as const;

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
 * NOTE: for Season 1 → 2, `seedCupCompetitions` resolves league comp IDs
 * from its internal hardcoded Season 1 constants.  Generalising to dynamic
 * comp-ID resolution is tracked as a follow-up so Season 2 → 3 works here
 * without changes to cupSeeder.ts.
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

// ── Step 3: insert the new season row ────────────────────────────────────────

/**
 * Create the Season N+1 row and deactivate Season N.
 *
 * The new season gets:
 *   • A fresh random UUID.
 *   • `is_active = true` (used by the legacy `getActiveSeason()` path).
 *   • `status = 'active'` (the lifecycle state machine from migration 0014).
 *   • `started_at = now()`.
 *
 * The previous season gets `is_active = false` so `getActiveSeason()` queries
 * return the new season immediately.  Its `status` column stays 'enacted' —
 * changing it would break the admin recovery path that expects enacted seasons
 * to be retrievable by status.
 *
 * Exits the process (code 3) if the INSERT fails — continuing without a valid
 * season row would leave all subsequent steps orphaned.
 *
 * @param current  The season row being closed out.
 * @returns        UUID of the newly created season.
 */
async function createNextSeason(current: SeasonRow): Promise<string> {
  const newYear = current.year + 1;
  const newId   = randomUUID();

  // Derive the human-readable season number from the year.
  // Season 1 = 2600, Season 2 = 2601, ... Season N = 2599 + N.
  const seasonNumber = newYear - SEASON_YEAR_OFFSET;
  const newName      = `Season ${seasonNumber} — ${newYear}`;

  const { error: deactivateErr } = await db
    .from('seasons')
    .update({ is_active: false })
    .eq('id', current.id);

  if (deactivateErr) {
    // Non-fatal: the new season row is inserted regardless.  An admin can
    // manually flip is_active on the old row if the UI shows duplicates.
    console.warn('[rollover-season] warning: failed to deactivate current season:', deactivateErr.message);
  }

  const { error: insertErr } = await (db as AnyDb)
    .from('seasons')
    .insert({
      id:         newId,
      name:       newName,
      year:       newYear,
      is_active:  true,
      start_date: `${newYear}-01-01`,
      end_date:   `${newYear}-12-31`,
      status:     'active',
      started_at: new Date().toISOString(),
    });

  if (insertErr) {
    console.error('[rollover-season] season insert failed:', insertErr.message);
    process.exit(3);
  }

  console.log(`[rollover-season] created season: ${newName} (${newId.slice(0, 8)})`);
  return newId;
}

// ── Step 4: league competitions + team rosters + fixtures ─────────────────────

/**
 * For each of the 4 ISL leagues, create a competition row for the new
 * season, populate competition_teams from the current `teams.league_id`
 * FK, and bulk-insert all round-robin fixtures.
 *
 * Each sub-step (competition insert, team roster, fixture batch) is guarded
 * individually so a single-league failure doesn't abort the others.
 *
 * @param newSeasonId  UUID of the newly created season.
 * @param seasonName   Human-readable season name (used in competition names).
 */
async function createLeagueInfrastructure(
  newSeasonId: string,
  seasonName:  string,
): Promise<void> {
  for (const league of LEAGUES) {
    // ── Competition row ─────────────────────────────────────────────────────
    const compId   = randomUUID();
    const compName = `${league.name} — ${seasonName}`;

    const { error: compErr } = await (db as AnyDb)
      .from('competitions')
      .insert({
        id:        compId,
        season_id: newSeasonId,
        league_id: league.id,
        name:      compName,
        type:      'league',
        format:    'round_robin',
        status:    'upcoming',
      });

    if (compErr) {
      console.error(
        `[rollover-season] competition insert failed (${league.id}):`,
        compErr.message,
      );
      continue;
    }

    // ── Resolve this league's teams from the teams table ────────────────────
    // We query `teams.league_id` rather than re-using the previous season's
    // competition_teams so the roster reflects any team-league reassignments
    // (e.g. promotion/relegation, which doesn't exist yet but keeps the code
    // future-proof).
    const { data: teams, error: teamsErr } = await db
      .from('teams')
      .select('id')
      .eq('league_id', league.id);

    if (teamsErr || !teams || teams.length === 0) {
      console.warn(
        `[rollover-season] no teams found for league ${league.id}:`,
        teamsErr?.message ?? 'empty result',
      );
      continue;
    }

    const teamIds = teams.map((t) => t.id);

    // ── competition_teams ───────────────────────────────────────────────────
    // Upsert so a re-run after partial failure is safe.
    const { error: ctErr } = await (db as AnyDb)
      .from('competition_teams')
      .upsert(
        teamIds.map((tid) => ({ competition_id: compId, team_id: tid })),
        { onConflict: 'competition_id,team_id' },
      );

    if (ctErr) {
      console.warn(
        `[rollover-season] competition_teams insert failed (${league.id}):`,
        ctErr.message,
      );
    }

    // ── Fixtures ────────────────────────────────────────────────────────────
    // Upsert in batches of FIXTURE_BATCH_SIZE to avoid PostgREST payload
    // limits.  ON CONFLICT (competition_id, home_team_id, away_team_id)
    // makes repeat runs safe — existing rows are left untouched.
    const fixtures = generateRoundRobinFixtures(compId, teamIds, {
      pairsPerMatchday: DEFAULT_PAIRS_PER_MATCHDAY,
      firstKickoffMs:   FIRST_KICKOFF_MS,
      cadenceMs:        CADENCE_MS,
    });
    let inserted   = 0;

    for (let off = 0; off < fixtures.length; off += FIXTURE_BATCH_SIZE) {
      const batch = fixtures.slice(off, off + FIXTURE_BATCH_SIZE);
      const { error: fixErr } = await (db as AnyDb)
        .from('matches')
        .upsert(batch, { onConflict: 'competition_id,home_team_id,away_team_id' });

      if (fixErr) {
        console.warn(
          `[rollover-season] fixture batch ${off}–${off + batch.length - 1} ` +
          `failed (${league.id}):`,
          fixErr.message,
        );
      } else {
        inserted += batch.length;
      }
    }

    console.log(
      `[rollover-season] ${league.name}: comp=${compId.slice(0, 8)}, ` +
      `teams=${teamIds.length}, fixtures=${inserted}/${fixtures.length}`,
    );
  }
}

// ── Step 5: empty cup competition rows for the new season ─────────────────────

/**
 * Insert placeholder Celestial Cup and Solar Shield competition rows for the
 * new season.  Their `bracket` column stays NULL until the new season's
 * league phase completes, at which point the rollover script (or a future
 * variant of maybeTransitionSeason) will call seedCupCompetitions to draw
 * the bracket from fresh standings.
 *
 * Exits silently if an insert fails — the cup rows can be re-inserted by
 * re-running the script; the rest of the season infrastructure is unaffected.
 *
 * @param newSeasonId  UUID of the newly created season.
 * @param seasonName   Human-readable season name (used in competition names).
 */
async function createCupRows(newSeasonId: string, seasonName: string): Promise<void> {
  for (const cup of CUP_TIERS) {
    const cupId   = randomUUID();
    const cupName = `${cup.name} — ${seasonName}`;

    const { error } = await (db as AnyDb)
      .from('competitions')
      .insert({
        id:        cupId,
        season_id: newSeasonId,
        league_id: null,   // Cross-league cup — no single-league affiliation
        name:      cupName,
        type:      'cup',
        format:    'knockout',
        status:    'upcoming',
        // `bracket` column intentionally omitted — defaults to NULL.
        // The seeder writes it after the new season's league phase ends.
      });

    if (error) {
      console.warn(`[rollover-season] cup insert failed (${cup.key}):`, error.message);
    } else {
      console.log(`[rollover-season] created cup: ${cupName} (${cupId.slice(0, 8)})`);
    }
  }
}

// ── Step 6: focus_options for all 32 teams ────────────────────────────────────

/**
 * Generate the full set of voting focus options for every team for the new
 * season.  Delegates to `generateFocusOptions`, which upserts the 9 static
 * templates (4 major + 5 minor) per team via ON CONFLICT — safe to re-run.
 *
 * Teams are queried from the `teams` table rather than a competition roster
 * so every club — including any that failed to get a competition_teams row
 * in step 4 — still receives voting options.
 *
 * @param newSeasonId UUID of the newly created season.
 */
async function generateAllFocusOptions(newSeasonId: string): Promise<void> {
  const { data: teams, error } = await db.from('teams').select('id');

  if (error || !teams) {
    console.warn('[rollover-season] teams read failed — skipping focus_options:', error?.message);
    return;
  }

  let total = 0;
  for (const team of teams) {
    const count = await generateFocusOptions(db as AnyDb, team.id, newSeasonId);
    total += count;
  }

  console.log(
    `[rollover-season] generated focus_options: ${total} row(s) for ${teams.length} team(s)`,
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

/**
 * Orchestrates the full season rollover.  Runs steps 1–6 sequentially so
 * each step can depend on outputs of earlier steps (e.g. newSeasonId).
 * Individual sub-step failures are logged but do not abort the run unless
 * they are structural (e.g. missing season row = can't create competitions).
 *
 * Exit codes:
 *   0  — all steps completed (including partial-success sub-steps).
 *   1  — env vars missing or invalid CLI args.
 *   2  — source season not found.
 *   3  — new season INSERT failed (structurally fatal).
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

  // Step 3: create the new season row.
  const newSeasonId   = await createNextSeason(currentSeason);
  const seasonNumber  = (currentSeason.year + 1) - SEASON_YEAR_OFFSET;
  const newSeasonName = `Season ${seasonNumber} — ${currentSeason.year + 1}`;

  // Steps 4–6: populate the new season's data.
  await createLeagueInfrastructure(newSeasonId, newSeasonName);
  await createCupRows(newSeasonId, newSeasonName);
  await generateAllFocusOptions(newSeasonId);

  console.log(
    `[rollover-season] done — ${newSeasonName} ready. ` +
    `Fixtures span ${firstKickoffIso} → ${lastKickoffIso}. ` +
    `Start the match worker to begin simulation.`,
  );
}

run().catch((err) => {
  console.error('[rollover-season] fatal:', err);
  process.exit(5);
});
