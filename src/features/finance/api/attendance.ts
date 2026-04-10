// ── finance/api/attendance.ts ────────────────────────────────────────────────
// WHY: Supabase queries for fan attendance counting, match_attendance recording,
// and team_finances updates. These three operations happen together at kickoff:
//   1. Count present fans per team (profiles with recent last_seen_at).
//   2. Insert match_attendance rows with fan counts and ticket revenue.
//   3. Increment team_finances.ticket_revenue and balance.
//
// Tables used:
//   - profiles (read: count fans by favourite_team_id + last_seen_at)
//   - match_attendance (write: created by 0005_attendance.sql)
//   - team_finances (write: created by 0004_betting.sql)
//
// All queries take an injected Supabase client; no direct imports.

import type { IslSupabaseClient } from '@shared/supabase/client';
import { calculateTicketRevenue } from '../logic/ticketPricing';

// TYPE ESCAPE HATCH — tables not yet in generated database.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

// ── Fan presence window ─────────────────────────────────────────────────────

/**
 * How far back to look when counting "present" fans. A fan is present if
 * their `last_seen_at` is within this many minutes of the query time.
 *
 * 5 minutes matches FAN_PRESENCE_WINDOW_MS in logic/fanBoost.ts. Defined
 * separately here as a SQL interval string for the DB query.
 */
const PRESENCE_INTERVAL = '5 minutes';

// ── Fan counting ────────────────────────────────────────────────────────────

/**
 * Count the number of fans currently "present" for a given team. A fan is
 * present if:
 *   1. Their `favourite_team_id` matches the team.
 *   2. Their `last_seen_at` is within the PRESENCE_INTERVAL of now.
 *
 * This drives both the fan support boost and ticket revenue calculations.
 *
 * @param db      Injected Supabase client.
 * @param teamId  Team slug (e.g. 'mars-athletic').
 * @returns       Number of present fans (0 on error or no fans).
 */
export async function countPresentFans(
  db: IslSupabaseClient,
  teamId: string,
): Promise<number> {
  const { count, error } = await (db as AnyDb) // CAST:profiles
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('favourite_team_id', teamId)
    .gte('last_seen_at', `now() - interval '${PRESENCE_INTERVAL}'`);

  if (error) {
    console.warn(`[countPresentFans] failed for team=${teamId}:`, error.message);
    return 0;
  }
  return count ?? 0;
}

// ── Match attendance recording ──────────────────────────────────────────────

/**
 * Row shape for the match_attendance table. Manually defined because the
 * migration hasn't been applied yet.
 */
export interface MatchAttendanceRow {
  id: string;
  match_id: string;
  team_id: string;
  fan_count: number;
  ticket_revenue: number;
  created_at: string;
}

/**
 * Record match attendance for both teams and update their finances.
 * This is the primary entry point called at kickoff. It:
 *   1. Counts present fans for both teams.
 *   2. Calculates ticket revenue for each.
 *   3. Inserts match_attendance rows (one per team).
 *   4. Upserts team_finances with incremented ticket_revenue and balance.
 *
 * Returns the attendance data so the caller can compute the fan boost.
 *
 * @param db         Injected Supabase client.
 * @param matchId    The match UUID.
 * @param homeTeamId Home team slug.
 * @param awayTeamId Away team slug.
 * @param seasonId   Current season UUID (for team_finances FK).
 * @param ticketPrice Optional per-match ticket price override.
 * @returns          { homeFans, awayFans, homeRevenue, awayRevenue }, or null on error.
 */
export async function recordMatchAttendance(
  db: IslSupabaseClient,
  matchId: string,
  homeTeamId: string,
  awayTeamId: string,
  seasonId: string,
  ticketPrice?: number,
): Promise<{
  homeFans: number;
  awayFans: number;
  homeRevenue: number;
  awayRevenue: number;
} | null> {
  // 1. Count fans for both teams in parallel.
  const [homeFans, awayFans] = await Promise.all([
    countPresentFans(db, homeTeamId),
    countPresentFans(db, awayTeamId),
  ]);

  // 2. Calculate ticket revenue.
  const homeRevenue = calculateTicketRevenue(homeFans, ticketPrice);
  const awayRevenue = calculateTicketRevenue(awayFans, ticketPrice);

  // 3. Insert match_attendance rows (upsert to handle re-runs).
  const attendanceRows = [
    { match_id: matchId, team_id: homeTeamId, fan_count: homeFans, ticket_revenue: homeRevenue },
    { match_id: matchId, team_id: awayTeamId, fan_count: awayFans, ticket_revenue: awayRevenue },
  ];

  const { error: attendErr } = await (db as AnyDb) // CAST:match_attendance
    .from('match_attendance')
    .upsert(attendanceRows, { onConflict: 'match_id,team_id' });

  if (attendErr) {
    console.warn('[recordMatchAttendance] attendance insert failed:', attendErr.message);
    return null;
  }

  // 4. Update team_finances for both teams.
  await Promise.all([
    updateTeamFinances(db, homeTeamId, seasonId, homeRevenue),
    updateTeamFinances(db, awayTeamId, seasonId, awayRevenue),
  ]);

  return { homeFans, awayFans, homeRevenue, awayRevenue };
}

/**
 * Fetch attendance data for a specific match. Returns one row per team
 * (home and away). Used on the match detail page to display fan counts.
 *
 * @param db       Injected Supabase client.
 * @param matchId  The match UUID.
 * @returns        Array of 0–2 MatchAttendanceRow entries.
 */
export async function getMatchAttendance(
  db: IslSupabaseClient,
  matchId: string,
): Promise<MatchAttendanceRow[]> {
  const { data, error } = await (db as AnyDb) // CAST:match_attendance
    .from('match_attendance')
    .select('*')
    .eq('match_id', matchId);

  if (error) {
    console.warn('[getMatchAttendance] failed:', error.message);
    return [];
  }
  return (data ?? []) as MatchAttendanceRow[];
}

// ── Team finances helper ────────────────────────────────────────────────────

/**
 * Upsert a team's finances row, incrementing ticket_revenue and balance
 * by the given amount. Uses an upsert so the row is auto-created for a
 * new season.
 *
 * NOTE: This performs a read-then-write (not atomic increment) because
 * Supabase JS doesn't support `SET col = col + value` syntax directly.
 * When the engine moves server-side, replace with an RPC for atomicity.
 *
 * @param db         Injected Supabase client.
 * @param teamId     Team slug.
 * @param seasonId   Season UUID.
 * @param revenue    Ticket revenue to add.
 */
async function updateTeamFinances(
  db: IslSupabaseClient,
  teamId: string,
  seasonId: string,
  revenue: number,
): Promise<void> {
  if (revenue <= 0) return;

  // Try to read existing row.
  const { data: existing } = await (db as AnyDb) // CAST:team_finances
    .from('team_finances')
    .select('ticket_revenue, balance')
    .eq('team_id', teamId)
    .eq('season_id', seasonId)
    .single();

  if (existing) {
    // Increment existing values.
    const ex = existing as { ticket_revenue: number; balance: number };
    await (db as AnyDb)
      .from('team_finances')
      .update({
        ticket_revenue: ex.ticket_revenue + revenue,
        balance: ex.balance + revenue,
        updated_at: new Date().toISOString(),
      })
      .eq('team_id', teamId)
      .eq('season_id', seasonId);
  } else {
    // Create new row for this team+season.
    await (db as AnyDb)
      .from('team_finances')
      .insert({
        team_id: teamId,
        season_id: seasonId,
        ticket_revenue: revenue,
        balance: revenue,
      });
  }
}
