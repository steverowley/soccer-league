#!/usr/bin/env tsx
// ── scripts/compute-odds.ts ──────────────────────────────────────────────────
// Package 12: pre-match odds generation cron.
//
// WHY THIS PROCESS EXISTS
// ────────────────────────
// The match-detail page (`MatchDetail.jsx`) lazily computes and persists odds
// the first time someone visits a scheduled fixture, but that's:
//
//   • Latency-shifted onto the first visitor (slow page load).
//   • Skipped entirely for matches no one ever clicks into (e.g. background
//     fixtures the user only sees aggregated in standings).
//   • Form-blind — the browser bootstrap uses a neutral 2W-1D-2L stub because
//     it has no good way to query the league's match history client-side.
//
// This cron computes odds server-side using *real* recent form (last 5
// completed matches per team) for every scheduled match in the upcoming
// horizon, ahead of the visitor's first page load.  Idempotent — re-running
// against an already-priced match overwrites the row with fresh numbers, so
// a roster change in the morning can be reflected by an afternoon re-run.
//
// ARCHITECTURE OVERVIEW
// ──────────────────────
//   1.  Query `matches` for rows with `status = 'scheduled'` and
//       `scheduled_at` within ODDS_HORIZON_HOURS of now.
//   2.  For each due match: fetch home + away teams (with players), pull
//       recent league results to derive each team's W/D/L form, run the
//       pure odds pipeline, upsert via `saveMatchOdds`.
//   3.  Log per-match outcomes; abort the script (non-zero exit) only on a
//       fatal env / connection failure.  Per-match errors are logged and
//       skipped so one bad row doesn't block the rest.
//
// HOW TO RUN
// ──────────
//   SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> npx tsx scripts/compute-odds.ts
//
//   Cron invocation: every 30 minutes is plenty — odds drift slowly between
//   roster events, and the horizon window is wide enough that each match is
//   priced multiple times before kickoff.  pg_cron equivalent:
//
//     SELECT cron.schedule('compute-odds', '*/30 * * * *', $$ ... $$);
//
// IMPORTANT: never commit SUPABASE_SERVICE_ROLE_KEY to version control.
// The service-role key bypasses Row Level Security entirely.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../src/types/database';
import {
  computeAvgRating,
  computeForm,
  computeMatchOdds,
  resultsForTeam,
  type CompletedMatchRow,
} from '../src/features/betting/logic/odds';
import { saveMatchOdds } from '../src/features/betting/api/oddsRepo';

// ── Environment ───────────────────────────────────────────────────────────────

const SUPABASE_URL              = process.env['SUPABASE_URL']             ?? process.env['VITE_SUPABASE_URL'];
const SUPABASE_SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'];

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    '[compute-odds] Missing required env vars: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
  );
  process.exit(1);
}

// ── Typed service-role client ─────────────────────────────────────────────────
// Service-role bypasses RLS — required because `match_odds` writes are
// disallowed for anon/auth roles per migration 0004.

type WorkerDb = SupabaseClient<Database>;

const db: WorkerDb = createClient<Database>(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      // No browser session in a cron context — disable both knobs to avoid
      // the supabase-js client trying to read non-existent storage.
      persistSession: false,
      autoRefreshToken: false,
    },
  },
);

// Shared escape hatch for the casts we make where database.ts hasn't been
// regenerated against the latest migrations yet (mirrors the pattern used in
// betting/api/wagers.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * How far ahead we look when picking matches to price.
 *
 * 48 hours is wide enough that even a once-a-day cron schedule produces fresh
 * odds for every match before kickoff, but narrow enough that we don't waste
 * cycles re-pricing fixtures whose rosters might change before they kick off.
 */
const ODDS_HORIZON_HOURS = 48;

/**
 * Number of recent completed league matches to consider when computing form.
 *
 * Set to 20 (not 5) because we project a single league-wide query down to
 * each team's last 5 results via `resultsForTeam` + `slice(0, 5)`. 20 covers
 * plenty of overlap so even teams with sparse fixture lists still find their
 * window. The pure helper does the trimming — this is just an upper bound on
 * the I/O round trip.
 */
const FORM_LOOKUP_LIMIT = 20;

/**
 * Neutral fallback used when a team has no completed matches yet (start of
 * a season) or when the form lookup fails. Mirrors the bootstrap shape in
 * `MatchDetail.jsx` so first-visit odds match cron-priced odds.
 */
const NEUTRAL_FORM = { wins: 2, draws: 1, losses: 2 } as const;

// ── Type helpers ──────────────────────────────────────────────────────────────

/**
 * Minimum player shape needed for `computeAvgRating`. The cron pulls only
 * starters via the `starter` boolean filter, but the logic helper looks at
 * the five core stat columns regardless.
 */
interface StarterRow {
  starter:    boolean;
  attacking:  number;
  defending:  number;
  mental:     number;
  athletic:   number;
  technical:  number;
}

/**
 * Match row shape returned by the due-fixture query. Only the columns the
 * cron needs to drive the rest of the pipeline.
 */
interface DueMatch {
  id:           string;
  competition_id: string;
  home_team_id: string;
  away_team_id: string;
}

// ── Form lookup ───────────────────────────────────────────────────────────────

/**
 * Pull recent completed matches in the same competition as the given match
 * and project both teams' results. Reading all completed matches in one
 * query (instead of two team-scoped queries) is cheaper because the
 * `(competition_id, status)` index is already covered by the standings page.
 *
 * @param db             Injected Supabase client.
 * @param competitionId  Competition the match belongs to — scopes the query.
 * @param homeTeamId     The home team's UUID.
 * @param awayTeamId     The away team's UUID.
 * @returns              Two ordered W/D/L arrays (newest-first), one per team.
 *                       Empty arrays on lookup failure — caller falls back
 *                       to NEUTRAL_FORM.
 */
async function getRecentResultsForTeams(
  db:             WorkerDb,
  competitionId:  string,
  homeTeamId:     string,
  awayTeamId:     string,
): Promise<{ home: Array<'W' | 'D' | 'L'>; away: Array<'W' | 'D' | 'L'> }> {
  const { data, error } = await db
    .from('matches')
    .select('home_team_id, away_team_id, home_score, away_score')
    .eq('competition_id', competitionId)
    .eq('status',         'completed')
    // Newest first so resultsForTeam returns the freshest games at the head
    // of the array — computeForm consumes the first FORM_WINDOW entries.
    .order('played_at', { ascending: false, nullsFirst: false })
    .limit(FORM_LOOKUP_LIMIT);

  if (error || !data) {
    console.warn('[compute-odds] form lookup failed:', error?.message ?? 'no data');
    return { home: [], away: [] };
  }

  const matches = data as CompletedMatchRow[];
  return {
    home: resultsForTeam(homeTeamId, matches),
    away: resultsForTeam(awayTeamId, matches),
  };
}

// ── Per-match odds computation ────────────────────────────────────────────────

/**
 * Compute and persist odds for a single scheduled match. Encapsulates the
 * full pipeline so the top-level loop can wrap one call in try/catch and
 * keep going on failure.
 *
 * @param db        Injected Supabase client.
 * @param match     The match row to price.
 * @returns         True if odds were saved successfully, false otherwise.
 */
async function priceMatch(db: WorkerDb, match: DueMatch): Promise<boolean> {
  const tag = `[compute-odds:${match.id.slice(0, 8)}]`;

  // ── Step 1: Fetch starter rows for both teams ────────────────────────────
  // We only need the five stat columns + starter flag; trimming the
  // projection keeps the response small even when both squads return.
  const [homeRes, awayRes] = await Promise.all([
    (db as AnyDb)
      .from('players')
      .select('starter, attacking, defending, mental, athletic, technical')
      .eq('team_id', match.home_team_id)
      .eq('starter', true),
    (db as AnyDb)
      .from('players')
      .select('starter, attacking, defending, mental, athletic, technical')
      .eq('team_id', match.away_team_id)
      .eq('starter', true),
  ]);

  if (homeRes.error || awayRes.error) {
    console.warn(`${tag} starter fetch failed:`, homeRes.error?.message ?? awayRes.error?.message);
    return false;
  }

  const homePlayers = (homeRes.data ?? []) as StarterRow[];
  const awayPlayers = (awayRes.data ?? []) as StarterRow[];

  // ── Step 2: Recent form (best-effort) ────────────────────────────────────
  // Falls back to NEUTRAL_FORM on lookup failure or empty history (start of
  // season). The pure helper trims to FORM_WINDOW internally so we pass the
  // raw newest-first slice straight through.
  const recent = await getRecentResultsForTeams(
    db, match.competition_id, match.home_team_id, match.away_team_id,
  );
  const homeForm = recent.home.length > 0 ? computeForm(recent.home) : NEUTRAL_FORM;
  const awayForm = recent.away.length > 0 ? computeForm(recent.away) : NEUTRAL_FORM;

  // ── Step 3: Run the pure pipeline ────────────────────────────────────────
  const { homeOdds, drawOdds, awayOdds } = computeMatchOdds(
    { avgRating: computeAvgRating(homePlayers), form: homeForm },
    { avgRating: computeAvgRating(awayPlayers), form: awayForm },
  );

  // ── Step 4: Upsert. saveMatchOdds returns null on DB error. ──────────────
  const saved = await saveMatchOdds(db, match.id, homeOdds, drawOdds, awayOdds);
  if (!saved) {
    console.warn(`${tag} saveMatchOdds returned null`);
    return false;
  }

  console.log(
    `${tag} priced ${homeOdds.toFixed(2)} / ${drawOdds.toFixed(2)} / ${awayOdds.toFixed(2)} ` +
      `(home form ${homeForm.wins}W-${homeForm.draws}D-${homeForm.losses}L, ` +
      `away ${awayForm.wins}W-${awayForm.draws}D-${awayForm.losses}L)`,
  );
  return true;
}

// ── Main run ──────────────────────────────────────────────────────────────────

/**
 * Top-level entrypoint: query due matches, price each one, log a summary.
 *
 * Designed to be run on a fixed schedule (cron / pg_cron). Exits 0 on
 * success — including the "no due matches" no-op case — so cron monitors
 * don't fire alerts during the natural off-season gap.
 */
async function run(): Promise<void> {
  const horizonIso = new Date(Date.now() + ODDS_HORIZON_HOURS * 3_600_000).toISOString();
  const nowIso     = new Date().toISOString();

  console.log(
    `[compute-odds] looking for scheduled matches between ${nowIso} and ${horizonIso}`,
  );

  // Pull every scheduled match that kicks off inside the horizon. We do not
  // filter on "odds row already exists" — re-pricing is intentional so a
  // mid-window roster change can move the line.
  const { data: due, error } = await db
    .from('matches')
    .select('id, competition_id, home_team_id, away_team_id')
    .eq('status', 'scheduled')
    .gte('scheduled_at', nowIso)
    .lte('scheduled_at', horizonIso);

  if (error) {
    console.error('[compute-odds] due-match query failed:', error.message);
    process.exit(2);
  }

  const matches = (due ?? []) as DueMatch[];
  if (matches.length === 0) {
    console.log('[compute-odds] no matches due — exiting cleanly');
    return;
  }

  console.log(`[compute-odds] pricing ${matches.length} match(es)`);

  // Sequential not parallel: form lookups query the same competition for
  // back-to-back matches in the same league, so the DB cache benefits from
  // serial execution. At ~30 fixtures/horizon × ~50 ms/match = 1.5 s, the
  // wall-clock cost is acceptable.
  let succeeded = 0;
  let failed    = 0;
  for (const match of matches) {
    try {
      const ok = await priceMatch(db, match);
      if (ok) succeeded++; else failed++;
    } catch (err) {
      // Per-match throws are logged but never abort the run.
      console.error(`[compute-odds:${match.id.slice(0, 8)}] threw:`, err);
      failed++;
    }
  }

  console.log(`[compute-odds] done — ${succeeded} priced, ${failed} failed`);
}

// ── Entrypoint guard ─────────────────────────────────────────────────────────
// Catches unhandled top-level rejections so the process exits with a non-zero
// status code (cron tools key off this for alerting). Without it, a thrown
// promise would log to stderr but exit 0.
run().catch((err) => {
  console.error('[compute-odds] fatal:', err);
  process.exit(3);
});
