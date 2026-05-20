// ── match-worker/index.ts ─────────────────────────────────────────────────────
// Deno edge function: match simulation worker.
//
// TRIGGER
//   Cron job every minute (configured in supabase/config.toml).
//   Also accepts manual GET / POST requests for operator-triggered runs.
//   verify_jwt=false so the cron invoker doesn't need a bearer token.
//
// PIPELINE (per due match)
//   1. Query up to MATCH_BATCH_SIZE scheduled matches whose scheduled_at
//      has passed.
//   2. Claim each match with an optimistic lock (status: scheduled →
//      in_progress) to prevent duplicate processing if two worker instances
//      race.
//   3. Fetch both teams with their full player rosters and manager row.
//   4. Normalise the raw DB rows into EngineTeam shape.
//   5. Run simulateFullMatch() — pure, synchronous, no DB calls.
//   6. Batch-insert all events into match_events (BATCH_SIZE rows per INSERT
//      to stay under Supabase's request-body size limit).
//   7. Mark the match completed with final scores and MVP name.
//
// ERROR HANDLING
//   Any per-match error rolls back status to 'scheduled' so the next cron
//   run retries it.  The handler never throws — it always returns a JSON
//   summary so the cron scheduler sees a 200 and doesn't back off.
//
// WHY verify_jwt=false
//   The Supabase pg_cron / Edge Function scheduler invokes functions with a
//   service-role key in the Authorization header, but the JWT audience is the
//   project anon audience, causing verify_jwt=true to reject it.  Setting
//   false is safe here because the function uses the SERVICE_ROLE_KEY from
//   the environment — not the caller's token — for all DB writes, and the
//   only sensitive operation (updating match status) is gated by the
//   optimistic lock.

// @ts-ignore — Deno global not in the TypeScript lib used by this project
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { simulateFullMatch } from './simulateFullMatch.ts';
import { normalizeTeamForEngine } from './normalizeTeam.ts';

// ── Tuning constants ──────────────────────────────────────────────────────────

/**
 * Maximum number of matches processed per worker invocation.
 * Kept low (5) so a single cron tick stays well within the 150-second
 * Supabase edge-function wall-clock limit even when simulations are slow.
 * Back-pressure is handled naturally: if more than 5 matches are due, the
 * next cron tick picks up the remainder.
 */
const MATCH_BATCH_SIZE = 5;

/**
 * Maximum rows per match_events INSERT.
 * A full 90-minute match produces ~80–150 events.  500 rows per batch gives
 * headroom for matches with many sequences (penalty shootouts, near-miss
 * chains) while staying under the ~1 MB Supabase request-body limit.
 */
const EVENT_INSERT_BATCH_SIZE = 500;

// ── Handler ───────────────────────────────────────────────────────────────────

// @ts-ignore — Deno global not in the TypeScript lib used by this project
Deno.serve(async (req: Request) => {
  // ── Method guard ───────────────────────────────────────────────────────────
  // Accept GET (cron ping) and POST (manual operator trigger).
  // Reject everything else so the function surface is minimal.
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Environment ────────────────────────────────────────────────────────────
  // Both vars are injected by Supabase at deploy time.  Missing vars mean the
  // function was invoked outside the expected environment (e.g. a test runner
  // without secrets); fail fast with a clear error rather than a cryptic auth
  // failure from the Supabase client.
  // @ts-ignore — Deno global
  const supabaseUrl     = Deno.env.get('SUPABASE_URL');
  // @ts-ignore — Deno global
  const serviceRoleKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ── Supabase client ────────────────────────────────────────────────────────
  // Service-role key bypasses RLS so the worker can read all teams/players
  // and write to match_events / matches without an authenticated user context.
  // persistSession: false avoids the Deno KV storage that service-role clients
  // don't need and that triggers deprecation warnings in Deno 2.
  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // ── Find due matches ───────────────────────────────────────────────────────
  // Only fetch the columns needed for the claim step; we re-fetch teams
  // separately (with their nested relations) after claiming to keep this
  // query fast and index-friendly.
  const { data: scheduledMatches, error: fetchError } = await db
    .from('matches')
    .select('id, home_team_id, away_team_id, scheduled_at')
    .eq('status', 'scheduled')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })   // oldest-due first
    .limit(MATCH_BATCH_SIZE);

  if (fetchError) {
    return new Response(
      JSON.stringify({ ok: false, error: fetchError.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  if (!scheduledMatches || scheduledMatches.length === 0) {
    return new Response(
      JSON.stringify({ ok: true, processed: 0, failed: 0, matches: [] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ── Per-match processing ───────────────────────────────────────────────────
  const results: Array<{ id: string; home_score: number; away_score: number }> = [];
  let processed = 0;
  let failed    = 0;

  for (const match of scheduledMatches) {
    // ── Optimistic lock: claim the match ─────────────────────────────────────
    // UPDATE … WHERE status = 'scheduled' is the lock.  If two worker
    // instances race, only one will find status='scheduled' and get a row
    // back; the other sees data=null and skips without error.  This prevents
    // double-simulation without needing a distributed lock service.
    const { data: claimed, error: claimError } = await db
      .from('matches')
      .update({ status: 'in_progress' })
      .eq('id', match.id)
      .eq('status', 'scheduled')   // optimistic lock predicate
      .select('id')
      .single();

    if (claimError || !claimed) {
      // Another worker instance beat us to this match — skip silently.
      continue;
    }

    try {
      // ── Fetch home team ───────────────────────────────────────────────────
      // `players(*)` and `managers(*)` are PostgREST nested-resource joins.
      // The service role bypasses RLS so we get all active players including
      // those on reserve / injured lists — normalizeTeamForEngine filters
      // is_active=false rows before handing the squad to the engine.
      const { data: homeRaw, error: homeError } = await db
        .from('teams')
        .select('*, players(*), managers(*)')
        .eq('id', match.home_team_id)
        .single();

      if (homeError || !homeRaw) {
        throw new Error(`Failed to fetch home team ${match.home_team_id}: ${homeError?.message}`);
      }

      // ── Fetch away team ───────────────────────────────────────────────────
      const { data: awayRaw, error: awayError } = await db
        .from('teams')
        .select('*, players(*), managers(*)')
        .eq('id', match.away_team_id)
        .single();

      if (awayError || !awayRaw) {
        throw new Error(`Failed to fetch away team ${match.away_team_id}: ${awayError?.message}`);
      }

      // ── Normalise into engine shape ───────────────────────────────────────
      // normalizeTeamForEngine maps snake_case DB columns → camelCase engine
      // fields and applies safe defaults for any missing values.
      const homeTeam = normalizeTeamForEngine(homeRaw as Record<string, unknown>);
      const awayTeam = normalizeTeamForEngine(awayRaw as Record<string, unknown>);

      // ── Run simulation ────────────────────────────────────────────────────
      // No refOverride or fanBoost wired up yet — those are Phase 5a / 6
      // additions.  The engine falls back to a random referee and no fan
      // stat bump, which is correct for the current season state.
      const result = simulateFullMatch(homeTeam, awayTeam);

      // ── Persist events ────────────────────────────────────────────────────
      // Shape each SimulatedEvent into the match_events schema row.
      // simulated_at marks when the event was computed (now), not when it
      // should be revealed to viewers — the live-stream layer uses
      // (scheduled_at + minute * realSecPerSimMin) for reveal timing.
      const eventRows = result.events.map((ev) => ({
        match_id:  match.id,
        minute:    ev.minute,
        subminute: ev.subminute,
        type:      ev.type,
        payload:   ev.payload,
      }));

      // Batch inserts: split into EVENT_INSERT_BATCH_SIZE-row chunks to stay
      // under Supabase's ~1 MB per-request body limit.  Awaited sequentially
      // (not Promise.all) to avoid overwhelming the DB connection pool.
      for (let i = 0; i < eventRows.length; i += EVENT_INSERT_BATCH_SIZE) {
        const batch = eventRows.slice(i, i + EVENT_INSERT_BATCH_SIZE);
        const { error: insertError } = await db.from('match_events').insert(batch);
        if (insertError) {
          throw new Error(
            `Failed to insert events batch [${i}–${i + batch.length}] for match ${match.id}: ${insertError.message}`,
          );
        }
      }

      // ── Mark match completed ──────────────────────────────────────────────
      // Write final scores, MVP, and completed_at in a single UPDATE so the
      // live-stream UI can query `status = 'completed'` as its done signal.
      const { error: completeError } = await db
        .from('matches')
        .update({
          status:     'completed',
          home_score: result.finalScore[0],
          away_score: result.finalScore[1],
          played_at:  new Date().toISOString(),
        })
        .eq('id', match.id);

      if (completeError) {
        throw new Error(
          `Failed to mark match ${match.id} completed: ${completeError.message}`,
        );
      }

      results.push({
        id:         match.id,
        home_score: result.finalScore[0],
        away_score: result.finalScore[1],
      });
      processed++;

    } catch (err) {
      // ── Rollback on any per-match error ───────────────────────────────────
      // Reset status to 'scheduled' so the next cron tick retries.
      // We fire-and-forget the rollback UPDATE (no await on the error) because
      // there's nothing useful to do if the rollback itself fails — the match
      // will stay 'in_progress' and require manual intervention, but that is
      // preferable to masking the original error with a secondary one.
      db.from('matches')
        .update({ status: 'scheduled' })
        .eq('id', match.id)
        .then(() => {/* rollback complete */})
        .catch(() => {/* rollback failed — match needs manual reset */});

      console.error(`match-worker: error processing match ${match.id}:`, err);
      failed++;
    }
  }

  // ── Response ───────────────────────────────────────────────────────────────
  // Always 200 so the cron scheduler doesn't interpret a partial failure as
  // a hard error and apply exponential back-off.  The `failed` count in the
  // body is sufficient for alerting via log monitors.
  return new Response(
    JSON.stringify({ ok: true, processed, failed, matches: results }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});
