// ── features/match/api/matchEvents.ts ────────────────────────────────────────
// Supabase data layer for the live match viewer (Package 11).
//
// WHAT THIS MODULE OWNS
//   • Fetching the full event list for a match (initial page-load query).
//   • Fetching the match row (scheduled_at, status, scores, team metadata).
//   • Reading the latest event of a match, which the live views poll
//     through the read cache (docs/read-cache.md).  This replaced Realtime
//     postgres_changes subscriptions, which cost the database per viewer.
//   • Reading the per-season match_duration_seconds knob so the viewer can
//     pace its wall-clock → game-minute conversion correctly.
//
// WHAT THIS MODULE DOES NOT DO
//   • No React.  All functions take an injected `db: PublicReadClient` so
//     unit tests inject a fake without patching globals.
//   • No elapsed-minute math — that lives in logic/elapsedMinute.ts.
//   • No event-rendering or sorting — the viewer renders what it gets here.
//
// WHY A SEPARATE FILE FROM api/matches.ts (which doesn't exist yet)
//   matches.ts will hold the broader CRUD surface (insert, update, list).
//   The live viewer only needs reads, and the surface is small
//   enough that a dedicated file keeps the test mocks compact.

import type { PublicReadClient } from '@shared/supabase/publicReadClient';
import type { Database } from '@/types/database';
// #386 slice 2: drift-catch the match_events rows + the LiveMatchRow
// nested-join shape at the api boundary. Malformed rows warn-log and
// drop instead of half-rendering the viewer header.
import {
  parseLiveMatchRow,
  parseMatchEventRows,
} from './matchEvents.schema';

// ── Shared row types (re-narrowed from generated database.ts) ────────────────

/**
 * One row from `match_events` as the viewer consumes it.  Equivalent to the
 * generated `Database['public']['Tables']['match_events']['Row']` but
 * re-exported here so consumers don't have to descend into the deep type.
 */
export type MatchEventRow = Database['public']['Tables']['match_events']['Row'];

/**
 * One row from `matches` joined with team metadata (name + colour + ground)
 * for both home and away.  This is the minimum shape the viewer needs to
 * paint the scoreline and meta-header.
 */
export interface LiveMatchRow {
  id:             string;
  status:         string;
  home_score:     number | null;
  away_score:     number | null;
  scheduled_at:   string | null;
  played_at:      string | null;
  competition_id: string;
  home_team: {
    id:           string;
    name:         string;
    short_name:   string | null;
    color:        string | null;
    home_ground:  string | null;
    location:     string | null;
  };
  away_team: {
    id:           string;
    name:         string;
    short_name:   string | null;
    color:        string | null;
    home_ground:  string | null;
    location:     string | null;
  };
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Fallback duration when no season_config row exists for the match's season.
 * 600 s (10 minutes real time → 90 game minutes ≈ 6.7 real seconds per game
 * minute) is the production default seeded by migration 0013.  Using the same
 * default here means the viewer paces correctly even if the season_config
 * row was somehow deleted — a worst-case visual regression rather than a
 * blank page.
 */
export const DEFAULT_MATCH_DURATION_SECONDS = 600;

// ── Match metadata ────────────────────────────────────────────────────────────

/**
 * Fetch a single match plus enough team metadata to render the scoreline.
 *
 * Uses Supabase's relational selector to join both team rows in one query.
 * `home_team:teams!matches_home_team_id_fkey(...)` is the syntax for
 * disambiguating the two FK paths from matches → teams.
 *
 * @param db        Injected Supabase client.
 * @param matchId   UUID of the match to fetch.
 * @returns         The joined match row, or null on error / not found.
 */
export async function getLiveMatch(
  db:      PublicReadClient,
  matchId: string,
): Promise<LiveMatchRow | null> {
  const { data, error } = await db
    .from('matches')
    .select(`
      id, status, home_score, away_score, scheduled_at, played_at, competition_id,
      home_team:teams!matches_home_team_id_fkey(id, name, short_name, color, home_ground, location),
      away_team:teams!matches_away_team_id_fkey(id, name, short_name, color, home_ground, location)
    `)
    .eq('id', matchId)
    .single();

  if (error) {
    console.warn('[getLiveMatch] failed:', error.message);
    return null;
  }
  // Zod-validate the joined shape. A future rename of e.g. `teams.location`
  // would compile-pass but fail here, surfacing the drift as a null return
  // + warn-log rather than a half-painted scoreline.
  return parseLiveMatchRow(data, 'getLiveMatch') as LiveMatchRow | null;
}

// ── Event log fetch ───────────────────────────────────────────────────────────

/**
 * Fetch every event for a match, ordered chronologically.  Called once on
 * page load so the viewer has the full pre-simulated stream to filter
 * client-side as game minutes elapse.
 *
 * The composite index `idx_match_events_match_minute` (migration 0013)
 * lets PostgreSQL serve this directly from the index without a sort step.
 *
 * @param db        Injected Supabase client.
 * @param matchId   UUID of the match.
 * @returns         All event rows ordered by (minute, subminute).  Empty
 *                  array on error or for a match that hasn't been
 *                  simulated yet.
 */
export async function getMatchEvents(
  db:      PublicReadClient,
  matchId: string,
): Promise<MatchEventRow[]> {
  const { data, error } = await db
    .from('match_events')
    .select('*')
    .eq('match_id', matchId)
    .order('minute',    { ascending: true })
    .order('subminute', { ascending: true });

  if (error) {
    console.warn('[getMatchEvents] failed:', error.message);
    return [];
  }
  // Zod-validate each row before handing the array to the viewer's
  // filter pipeline. Malformed rows (drift, partial migration window,
  // worker-side bug) are dropped with a warn-log so the rest of the
  // event log still renders.
  return parseMatchEventRows((data ?? []) as unknown[], 'getMatchEvents') as MatchEventRow[];
}

// ── Latest event (live polling) ─────────────────────────────────────────────

/**
 * Fetch the most recent event of a match: the last row by (minute,
 * subminute).  The matches list polls this for each live match's mini
 * pitch through the read cache, so every viewer shares one database query
 * per match per cache TTL.  It replaced a table-wide Realtime
 * `postgres_changes` channel (docs/read-cache.md, "As built").
 *
 * @param db        The public-read client.
 * @param matchId   UUID of the match.
 * @returns         The latest event, or null when there is none or the read
 *                  failed (the next poll retries).
 */
export async function getLatestMatchEvent(
  db:      PublicReadClient,
  matchId: string,
): Promise<MatchEventRow | null> {
  const { data, error } = await db
    .from('match_events')
    .select('*')
    .eq('match_id', matchId)
    .order('minute',    { ascending: false })
    .order('subminute', { ascending: false })
    .limit(1);

  if (error) {
    console.warn('[getLatestMatchEvent] failed:', error.message);
    return null;
  }
  const rows = parseMatchEventRows((data ?? []) as unknown[], 'getLatestMatchEvent') as MatchEventRow[];
  return rows[0] ?? null;
}

// ── Season pacing ────────────────────────────────────────────────────────────

/**
 * Look up `match_duration_seconds` for the season this match belongs to.
 *
 * Two-hop query: matches.competition_id → competitions.season_id →
 * season_config.match_duration_seconds.  We do this manually rather than
 * via a single relational join because season_config has no FK to matches
 * (it's keyed by season_id text, deliberately decoupled per migration 0013).
 *
 * Returns DEFAULT_MATCH_DURATION_SECONDS on any failure path so the viewer
 * always has a usable pacing value.  Visible regression on miss: a too-fast
 * or too-slow reveal, never a blank page.
 *
 * @param db        Injected Supabase client.
 * @param matchId   UUID of the match.
 * @returns         Real-world seconds the viewer should take to reveal a
 *                  90-minute simulated match.  Falls back to 600 s on miss.
 */
export async function getMatchDurationSeconds(
  db:      PublicReadClient,
  matchId: string,
): Promise<number> {
  // Step 1: get the competition id for the match.
  const { data: matchRow, error: matchErr } = await db
    .from('matches')
    .select('competition_id')
    .eq('id', matchId)
    .single();

  if (matchErr || !matchRow) return DEFAULT_MATCH_DURATION_SECONDS;

  // Step 2: get the season id for the competition.
  const { data: compRow, error: compErr } = await db
    .from('competitions')
    .select('season_id')
    .eq('id', matchRow.competition_id)
    .single();

  if (compErr || !compRow) return DEFAULT_MATCH_DURATION_SECONDS;

  // Step 3: read the season's match_duration_seconds knob.
  const { data: cfgRow, error: cfgErr } = await db
    .from('season_config')
    .select('match_duration_seconds')
    .eq('season_id', compRow.season_id)
    .single();

  if (cfgErr || !cfgRow) return DEFAULT_MATCH_DURATION_SECONDS;
  return cfgRow.match_duration_seconds;
}
