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
import { settleMatchWagers, maybeTransitionSeasonForMatch } from './postMatchEffects.ts';
import { hydrateArchitectBridge } from './architectBridge.ts';
import { computeFanBoost } from './fanBoost.ts';

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
 * Returns the *actually claimed* rows — i.e. only matches whose UPDATE
 * succeeded under the `status='scheduled'` predicate.  Any rows that another
 * worker race-grabbed between our SELECT and UPDATE are excluded, so we never
 * double-simulate or duplicate event inserts.
 *
 * CONCURRENCY
 * ───────────
 * The original implementation returned `matches.filter(m => matchIds.includes(m.id))`,
 * which silently included every row from the SELECT regardless of who actually
 * won the UPDATE race — meaning two concurrent worker invocations could both
 * "claim" the same match, run two simulations against it, and double-insert
 * match_events.  Chaining `.select(...)` on the UPDATE returns exactly the
 * rows whose `status='scheduled'` predicate matched, making the claim
 * authoritative.
 *
 * @returns Array of match rows this worker owns for the duration of the call.
 */
async function claimDueMatches() {
  const now = new Date().toISOString();

  // Fetch due matches. Intentionally no UPDATE lock here — the next step
  // claims them atomically via the predicate on the UPDATE.
  const { data: candidates, error: selectError } = await supabase
    .from('matches')
    .select('id')
    .eq('status', 'scheduled')
    .lte('scheduled_at', now)
    .limit(MATCH_BATCH_SIZE)
    .order('scheduled_at', { ascending: true });

  if (selectError) {
    console.error('[match-worker] SELECT matches failed:', selectError);
    return [];
  }
  if (!candidates || candidates.length === 0) return [];

  // Atomically claim. The .select() on the UPDATE returns only the rows
  // whose `status='scheduled'` predicate matched — i.e. rows we actually
  // won.  This is the race-safe variant of the old "filter by candidate IDs"
  // approach, which credulously trusted the SELECT result set.
  const candidateIds = candidates.map((m) => m.id);
  const { data: claimed, error: claimError } = await supabase
    .from('matches')
    .update({ status: 'in_progress', played_at: new Date().toISOString() })
    .in('id', candidateIds)
    .eq('status', 'scheduled')
    .select('id, home_team_id, away_team_id, scheduled_at, competition_id');

  if (claimError) {
    console.error('[match-worker] UPDATE claim failed:', claimError);
    return [];
  }

  console.log(`[match-worker] Claimed ${claimed?.length ?? 0} of ${candidateIds.length} candidate matches`);
  return claimed ?? [];
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
    //
    // `color` and `capacity` feed the engine's per-event animation payload and
    // its stadium/weather selection.  Omitting them (as the worker did before
    // this commit) made gameEngine fall back to a *random* STADIUMS entry,
    // which in turn picked a random `planet` and therefore the wrong
    // PLANET_WX table — every weather-keyed mechanic was running off the
    // wrong distribution.
    .select('id, name, short_name, color, location, home_ground, capacity, managers(id, name), players(id, name, position, age, jersey_number, starter, attacking, defending, mental, technical, athletic, is_active)')
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

    // ── Pre-match context ───────────────────────────────────────────────────
    // Fan boost + Architect bridge are both hydrated here in parallel and
    // threaded into simulateFullMatch.  Either falling back to a no-op
    // (no fans / no lore) is the common case in the early life of the DB
    // and is the deliberate degradation path — never block kickoff on
    // either of these reads.
    const [fanBoost, architect] = await Promise.all([
      computeFanBoost(supabase, match.home_team_id, match.away_team_id),
      hydrateArchitectBridge(supabase),
    ]);
    if (fanBoost.boostedSide !== 'none') {
      console.log(`[match-worker] Fan boost: +${fanBoost.boostAmount} to ${fanBoost.boostedSide}`);
    }

    // Simulate the full 90 minutes
    const result = simulateFullMatch(home, away, fanBoost, architect);

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

    // ── Persist per-player stats ───────────────────────────────────────────
    // The engine returns playerStats keyed by player *name*; the DB table
    // match_player_stats is keyed by player_id (uuid) + team_id (slug).
    // Build a name→{id, team_id} map from the rosters we already loaded so
    // we don't need a second round-trip.  Players who never touched a stat
    // counter during the match (no goals/assists/cards) are skipped so the
    // table only carries meaningful rows — the idol leaderboard reads sum
    // aggregates and treats missing rows as zeros.
    //
    // `minutes_played` defaults to 90 because the current engine has no
    // substitution path; once subs are simulated this can switch to the
    // real on-pitch duration.  `rating` is intentionally left NULL — there
    // is no agreed scoring formula yet and downstream views accept null.
    const playerIndex: Record<string, { id: string; teamId: string }> = {};
    for (const p of homeData.players || []) {
      if (p?.name && p?.id) playerIndex[p.name] = { id: p.id, teamId: homeData.id };
    }
    for (const p of awayData.players || []) {
      if (p?.name && p?.id) playerIndex[p.name] = { id: p.id, teamId: awayData.id };
    }

    const statRows = Object.entries(result.playerStats || {})
      .map(([name, s]) => {
        const idx = playerIndex[name];
        if (!idx) return null;
        return {
          match_id: match.id,
          player_id: idx.id,
          team_id: idx.teamId,
          goals: s.goals || 0,
          assists: s.assists || 0,
          yellow_cards: s.yellowCard ? 1 : 0,
          red_cards: s.redCard ? 1 : 0,
          minutes_played: 90,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (statRows.length > 0) {
      const { error: statsError } = await supabase
        .from('match_player_stats')
        .insert(statRows);
      if (statsError) throw new Error(`Insert match_player_stats failed: ${statsError.message}`);
      console.log(`[match-worker] Persisted ${statRows.length} player-stat rows`);
    }

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

    // ── Post-match orchestration ──────────────────────────────────────────
    // These side-effects used to be wired through the browser-side
    // `match.completed` event bus, which is an in-memory singleton that
    // can never reach a server-side edge worker.  Now they run inline in
    // service-role context immediately after the match is marked complete.
    //
    // Failures here are logged but do NOT throw — the match is already
    // recorded as completed and we shouldn't revert simulation work just
    // because a downstream effect (e.g. settlement) hit a transient DB
    // blip.  Each effect is independently retry-safe; cron will pick up
    // missed work in the next pass for season transitions, and a manual
    // settlement sweep can clean up any open wagers that slipped through.
    try {
      const settlement = await settleMatchWagers(
        supabase, match.id, result.finalScore[0], result.finalScore[1],
      );
      if (settlement.settled > 0) {
        console.log(`[match-worker] Settled ${settlement.settled} wagers, total payout ${settlement.totalPayout}`);
      }
    } catch (err) {
      console.warn(`[match-worker] settleMatchWagers threw for ${match.id}:`, (err as Error)?.message ?? err);
    }

    try {
      const seasonTx = await maybeTransitionSeasonForMatch(supabase, match.id);
      if (seasonTx.transitioned) {
        console.log(`[match-worker] Season opened for voting after match ${match.id}`);
      }
    } catch (err) {
      console.warn(`[match-worker] maybeTransitionSeasonForMatch threw for ${match.id}:`, (err as Error)?.message ?? err);
    }

    console.log(`[match-worker] Match ${match.id} completed successfully`);
    return true;
  } catch (err) {
    console.error(`[match-worker] Error processing match ${match.id}:`, err);

    // ── Roll back partial state before reverting status ────────────────────
    // If the failure landed *after* some events / stat rows were already
    // inserted (e.g. a mid-match insert hit a CHECK violation), leaving the
    // partial rows in place would cause the next retry to duplicate them —
    // and `match_events` has no per-(match_id, minute, type) unique index to
    // catch that.  Delete cascade isn't an option because we want to keep
    // the failed match around to retry, so we explicitly clear any rows
    // this attempt left behind before flipping status back to 'scheduled'.
    await supabase.from('match_events').delete().eq('match_id', match.id);
    await supabase.from('match_player_stats').delete().eq('match_id', match.id);

    // Revert status so another worker (or next cron invocation) will retry.
    // We don't throw — the worker must process the rest of the batch even
    // if one match fails.
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
