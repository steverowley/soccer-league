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
// CONCURRENCY & LOCKING
// ────────────────────
// Multiple worker instances can run simultaneously. Optimistic locking
// (UPDATE ... WHERE status='scheduled') prevents duplicate processing:
// only one worker can flip status to 'in_progress' for a given match.
// On error, status reverts to 'scheduled' for retry.
//
// BATCH SIZES
// ───────────
// MATCH_BATCH_SIZE=5: fetch up to 5 due matches per cron invocation.
//   Keeps memory footprint low and spreads compute across invocations.
// EVENT_INSERT_BATCH_SIZE=500: insert up to 500 events in a single
//   Supabase call.  A typical 90-minute match generates 30–60 events,
//   so one batch usually handles the entire match.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.2';
import { normalizeTeamForEngine } from './normalizeTeam.ts';
import { simulateFullMatch } from './simulateFullMatch.ts';

// ── Configuration ──────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const MATCH_BATCH_SIZE = 5;          // Fetch up to 5 due matches per invocation
const EVENT_INSERT_BATCH_SIZE = 500; // Insert up to 500 events per Supabase call

// ── Supabase client (service role — full access) ──────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ── Helper: Claim and fetch due matches ────────────────────────────────────

/**
 * Fetch up to MATCH_BATCH_SIZE matches where status='scheduled' and
 * scheduled_at <= now(), then claim them by setting status='in_progress'.
 *
 * Uses optimistic locking: the UPDATE ... WHERE status='scheduled'
 * guarantees only one worker instance can claim each match.
 *
 * Returns the number of matches actually claimed (in case of race conditions
 * where other workers claim matches between SELECT and UPDATE).
 */
async function claimDueMatches() {
  const now = new Date().toISOString();

  // Fetch due matches. Intentionally no UPDATE lock here — the next step
  // claims them atomically.
  const { data: matches, error: selectError } = await supabase
    .from('matches')
    .select('id, home_team_id, away_team_id, scheduled_at, competition_id')
    .eq('status', 'scheduled')
    .lte('scheduled_at', now)
    .limit(MATCH_BATCH_SIZE)
    .order('scheduled_at', { ascending: true });

  if (selectError) {
    console.error('[match-worker] SELECT matches failed:', selectError);
    return [];
  }

  if (!matches || matches.length === 0) {
    return [];
  }

  const matchIds = matches.map((m) => m.id);

  // Atomically claim: UPDATE status to 'in_progress' for these IDs.
  // The WHERE status='scheduled' ensures we only claim matches that haven't
  // been claimed by another worker instance since our SELECT.
  const { error: claimError, count } = await supabase
    .from('matches')
    .update({ status: 'in_progress', played_at: new Date().toISOString() })
    .in('id', matchIds)
    .eq('status', 'scheduled');

  if (claimError) {
    console.error('[match-worker] UPDATE claim failed:', claimError);
    return [];
  }

  console.log(`[match-worker] Claimed ${count} matches`);

  // Return the full match objects for processing. The count might be less
  // than matchIds.length if other workers claimed some in the race window.
  const claimedMatches = matches.filter((m) => matchIds.includes(m.id));
  return claimedMatches;
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
    .select('id, name, location, home_ground, managers(id, name), players(id, name, position, age, jersey_number, starter, attacking, defending, mental, technical, athletic, is_active)')
    .eq('id', teamId)
    .single();

  if (error) {
    console.error(`[match-worker] Failed to fetch team ${teamId}:`, error);
    return null;
  }

  return data;
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

    // Simulate the full 90 minutes
    const result = simulateFullMatch(home, away);

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

    console.log(`[match-worker] Match ${match.id} completed successfully`);
    return true;
  } catch (err) {
    console.error(`[match-worker] Error processing match ${match.id}:`, err);

    // Revert status to 'scheduled' so another worker (or next cron invocation)
    // will retry.  We don't throw here — the worker must process all matches
    // in the batch even if some fail.
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

// ── Main handler (Deno.serve entrypoint) ───────────────────────────────────

/**
 * HTTP handler invoked by pg_cron every minute.
 * Processes all due matches in the current batch.
 *
 * Returns 200 always (success) so pg_cron doesn't backoff on transient errors.
 * Failures are logged per-match and reverted for retry.
 */
Deno.serve(async (req: Request) => {
  try {
    console.log('[match-worker] Cron invocation');

    const matches = await claimDueMatches();
    if (matches.length === 0) {
      console.log('[match-worker] No due matches');
      return new Response(JSON.stringify({ processed: 0 }), { status: 200 });
    }

    // Process all claimed matches
    let successCount = 0;
    let failureCount = 0;

    for (const match of matches) {
      const ok = await processMatch(match);
      if (ok) successCount++;
      else failureCount++;
    }

    console.log(`[match-worker] Batch complete: ${successCount} succeeded, ${failureCount} failed`);

    return new Response(
      JSON.stringify({
        processed: matches.length,
        succeeded: successCount,
        failed: failureCount,
      }),
      { status: 200 },
    );
  } catch (err) {
    console.error('[match-worker] Unhandled error:', err);
    // Return 200 so cron doesn't backoff; full error is in logs only
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 200 });
  }
});
