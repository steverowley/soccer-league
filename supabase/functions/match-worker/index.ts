// ── match-worker / index.ts ──────────────────────────────────────────────────
// Edge Function version of scripts/match-worker.ts.
// Polls for due matches, simulates them, and persists results to Supabase.
//
// CRON SETUP (Supabase Dashboard → Cron):
//   Schedule: `*/1 * * * *`  (every 1 minute, or adjust to match needs)
//   Function: match-worker
//   HTTP method: POST
//   No body required.
//
// WHY EDGE FUNCTION:
// The original Node.js worker required a persistent server. This version runs
// on-demand via cron, reducing costs and eliminating deployment complexity.
// Matches are pre-simulated and stored in match_events for client replay.

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import type { Database } from '../../../src/types/database.ts';

type WorkerDb = ReturnType<typeof createClient<Database>>;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const db = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
}) as WorkerDb;

/**
 * Maximum number of match_events rows inserted per Supabase call.
 * Supabase's PostgREST layer has a default 1 MB payload cap; at ~300 bytes
 * per event row, 500 rows ≈ 150 KB — well within the limit with headroom.
 * A typical 90-minute match produces 50–120 events, so one batch usually suffices.
 */
const BATCH_SIZE = 500;

// ── Type helpers ──────────────────────────────────────────────────────────────

type AnyDb = any;

// ── Minimal imports from existing modules ──────────────────────────────────────
// We can't directly import from the codebase in Deno, so we'll inline the
// critical logic or fetch it via HTTP. For now, we'll inline the essential parts.

/**
 * Normalize a Supabase team row (with joined players + manager) into the shape
 * required by the game engine. Provides sensible defaults for missing fields.
 *
 * @param team - Raw team row from Supabase with players(*) and managers(*)
 * @returns Engine-shaped team object with all required stats and roster
 */
function normalizeTeamForEngine(team: any) {
  const { players = [], managers = [] } = team;
  return {
    name: team.name,
    id: team.id,
    attacking: team.attacking || 50,
    defending: team.defending || 50,
    mental: team.mental || 50,
    athletic: team.athletic || 50,
    technical: team.technical || 50,
    players: players.map((p: any) => ({
      id: p.id,
      name: p.name,
      jersey_number: p.jersey_number || 0,
      starter: p.starter || false,
      position: p.position || 'GK',
      shooting: p.shooting || 50,
      assisting: p.assisting || 50,
      tackling: p.tackling || 50,
      blocking: p.blocking || 50,
      goalkeeping: p.goalkeeping || 50,
      passing: p.passing || 50,
      dribbling: p.dribbling || 50,
      speed: p.speed || 50,
      stamina: p.stamina || 50,
      strength: p.strength || 50,
      positioning: p.positioning || 50,
      aggression: p.aggression || 50,
      vision: p.vision || 50,
    })),
    manager: managers[0] || { name: 'Unknown', id: 'unknown' },
  };
}

/**
 * Simulate a full 90-minute match between two teams.
 *
 * STUB: This is a placeholder implementation. In production, this would:
 *   1. Call the real game engine (src/gameEngine.js) via dynamic import or HTTP
 *   2. Drive the match minute-by-minute with personality-driven contests
 *   3. Return 50–120 events representing the full match narrative
 *
 * Currently returns a minimal deterministic result for testing edge function
 * deployment. Once gameEngine.js is Deno-compatible, replace this stub.
 *
 * @param homeTeam - Engine-shaped home team with players and stats
 * @param awayTeam - Engine-shaped away team with players and stats
 * @param ref - Optional referee override (name, strictness)
 * @param fanBoost - Fan support bonus (boostedSide, boostAmount)
 * @returns Object with finalScore [homeGoals, awayGoals], all match events, and MVP name
 */
function simulateFullMatch(homeTeam: any, awayTeam: any, ref: any, fanBoost: any) {
  // Generate a deterministic but pseudo-random result based on team stats
  const seed = (homeTeam.id + awayTeam.id).charCodeAt(0) || 42;
  const rng = (s: number) => Math.sin(s) * 10000 % 1;

  const homeScore = Math.floor(3 * rng(seed) % 3);
  const awayScore = Math.floor(3 * rng(seed + 1) % 3);

  return {
    finalScore: [homeScore, awayScore],
    events: [
      {
        minute: 15,
        subminute: 0,
        type: 'possession_change',
        payload: { team: 'home' },
      },
      {
        minute: 45,
        subminute: 30,
        type: 'half_end',
        payload: { half: 1 },
      },
      {
        minute: 90,
        subminute: 0,
        type: 'match_end',
        payload: { result: 'final' },
      },
    ],
    mvp: homeTeam.players?.[0]?.name || 'Unknown',
  };
}

/**
 * Settle all open wagers for a completed match.
 *
 * STUB: Currently logs the result but doesn't update wagers or credits.
 * In production, this would:
 *   1. Fetch all open wagers for this match from wagers table
 *   2. Determine winner from final score
 *   3. Calculate payouts using odds from match_odds
 *   4. Update wager rows with result and settled_at timestamp
 *   5. Credit winners' profiles.credits balances
 *
 * @param db - Service-role Supabase client
 * @param matchId - UUID of completed match
 * @param homeScore - Final home team goal count
 * @param awayScore - Final away team goal count
 * @returns Number of wagers settled
 */
async function settleMatchWagers(db: WorkerDb, matchId: string, homeScore: number, awayScore: number) {
  console.log(`[match-worker] settling wagers for match ${matchId.slice(0, 8)}: ${homeScore}–${awayScore}`);
  return 0;
}

/**
 * Look up the season UUID for a given match.
 *
 * @param db - Supabase client
 * @param matchId - Match UUID
 * @returns Season UUID or undefined if not found
 */
async function getSeasonIdForMatch(db: WorkerDb, matchId: string) {
  const { data } = await (db as AnyDb).from('matches').select('season_id').eq('id', matchId).single();
  return data?.season_id;
}

/**
 * Get the current status of a season.
 *
 * @param db - Supabase client
 * @param seasonId - Season UUID
 * @returns Season status ('active', 'voting', 'enacted', etc.) or undefined
 */
async function getSeasonStatus(db: WorkerDb, seasonId: string) {
  const { data } = await (db as AnyDb).from('seasons').select('status').eq('id', seasonId).single();
  return data?.status;
}

/**
 * Count how many fans of a given team have been active in the last 5 minutes.
 *
 * Used to calculate fan-support bonuses: the team with more logged-in fans
 * during a match receives a +2 stat bump to all players. This is a subtle,
 * in-game consequence of fan presence that is never explained to the player.
 *
 * @param db - Supabase client
 * @param teamId - Team UUID
 * @returns Count of fans with last_seen_at >= 5 minutes ago
 */
async function countPresentFans(db: WorkerDb, teamId: string) {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60000).toISOString();
  const { count } = await (db as AnyDb)
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('favourite_team_id', teamId)
    .gte('last_seen_at', fiveMinutesAgo);
  return count || 0;
}

/**
 * Calculate which team (if any) should receive a fan-support bonus.
 *
 * The team with more logged-in fans gets a +2 boost to all player stats.
 * This mechanic drives emergent metagaming: fans coordinating their presence
 * to boost their team during crucial matches.
 *
 * @param homeFans - Count of logged-in home team supporters
 * @param awayFans - Count of logged-in away team supporters
 * @returns Object describing boost target and magnitude
 */
function calculateFanBoost(homeFans: number, awayFans: number) {
  const boostAmount = 2;
  const boostedSide = homeFans > awayFans ? 'home' : awayFans > homeFans ? 'away' : 'none';
  return { boostedSide, boostAmount, homeFanCount: homeFans, awayFanCount: awayFans };
}

// ── Core: process one match ───────────────────────────────────────────────────

/**
 * Claim, simulate, persist, and settle a single due match.
 *
 * Uses an optimistic UPDATE to claim the match so only one worker instance
 * can process it, even if multiple workers run concurrently. All DB mutations
 * are wrapped in try/catch that rolls the match back to 'scheduled' on failure
 * so a subsequent poll can retry cleanly.
 *
 * Workflow:
 *   1. Claim match with optimistic lock (status 'scheduled' → 'in_progress')
 *   2. Fetch both teams and normalize for game engine
 *   3. Calculate fan-support bonus
 *   4. Simulate full 90 minutes (generates 50–120 events)
 *   5. Batch-insert events to match_events (chunks of 500 to avoid payload limits)
 *   6. Mark match 'completed' with final score and timestamp
 *   7. Settle all open wagers for this match
 *   8. On any error, delete partial events and revert to 'scheduled' for retry
 *
 * @param matchId - UUID of match to process
 * @param homeTeamId - Home team UUID
 * @param awayTeamId - Away team UUID
 */
async function processMatch(matchId: string, homeTeamId: string, awayTeamId: string): Promise<void> {
  const tag = `[match-worker:${matchId.slice(0, 8)}]`;

  // Claim the match
  const { data: claimed, error: claimErr } = await (db as AnyDb)
    .from('matches')
    .update({ status: 'in_progress', simulated_at: new Date().toISOString() })
    .eq('id', matchId)
    .eq('status', 'scheduled')
    .select('id');

  if (claimErr) {
    console.warn(`${tag} claim failed:`, claimErr.message);
    return;
  }
  if (!claimed || claimed.length === 0) {
    console.log(`${tag} already claimed by another worker, skipping`);
    return;
  }

  console.log(`${tag} claimed — fetching teams`);

  try {
    // Fetch teams
    const [homeResult, awayResult] = await Promise.all([
      (db as AnyDb)
        .from('teams')
        .select('*, players(*), managers(*)')
        .eq('id', homeTeamId)
        .single(),
      (db as AnyDb)
        .from('teams')
        .select('*, players(*), managers(*)')
        .eq('id', awayTeamId)
        .single(),
    ]);

    if (homeResult.error) throw new Error(`home team fetch failed: ${homeResult.error.message}`);
    if (awayResult.error) throw new Error(`away team fetch failed: ${awayResult.error.message}`);

    const homeTeam = normalizeTeamForEngine(homeResult.data);
    const awayTeam = normalizeTeamForEngine(awayResult.data);

    // Fan boost
    const [homeFanCount, awayFanCount] = await Promise.all([
      countPresentFans(db, homeTeamId),
      countPresentFans(db, awayTeamId),
    ]);
    const fanBoost = calculateFanBoost(homeFanCount, awayFanCount);

    console.log(
      `${tag} simulating: ${homeTeam.name} vs ${awayTeam.name}` +
        (fanBoost.boostedSide !== 'none'
          ? ` (boost: ${fanBoost.boostedSide} +${fanBoost.boostAmount})`
          : ''),
    );

    // Simulate match
    const result = simulateFullMatch(homeTeam, awayTeam, null, fanBoost);
    const [homeScore, awayScore] = result.finalScore;

    console.log(`${tag} simulated: ${homeScore}–${awayScore}, ${result.events.length} events`);

    // Persist events in batches
    const rows = result.events.map((ev: any) => ({
      match_id: matchId,
      minute: ev.minute,
      subminute: ev.subminute,
      type: ev.type,
      payload: ev.payload,
    }));

    for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
      const batch = rows.slice(offset, offset + BATCH_SIZE);
      const { error: insertErr } = await (db as AnyDb).from('match_events').insert(batch);
      if (insertErr) throw new Error(`event insert batch ${offset} failed: ${insertErr.message}`);
    }

    // Mark match completed
    const { error: completeErr } = await (db as AnyDb)
      .from('matches')
      .update({
        status: 'completed',
        home_score: homeScore,
        away_score: awayScore,
        played_at: new Date().toISOString(),
      })
      .eq('id', matchId);

    if (completeErr) throw new Error(`match completion update failed: ${completeErr.message}`);

    console.log(`${tag} completed: ${homeScore}–${awayScore}, mvp=${result.mvp}`);

    // Settle wagers
    try {
      const settled = await settleMatchWagers(db as AnyDb, matchId, homeScore, awayScore);
      if (settled > 0) console.log(`${tag} settled ${settled} wager(s)`);
    } catch (settleErr) {
      console.warn(`${tag} wager settlement error (match result preserved):`, settleErr);
    }
  } catch (err) {
    console.error(`${tag} simulation error — rolling back to 'scheduled':`, err);
    await (db as AnyDb).from('match_events').delete().eq('match_id', matchId);
    await (db as AnyDb)
      .from('matches')
      .update({ status: 'scheduled', simulated_at: null })
      .eq('id', matchId);
  }
}

// ── Poll loop ─────────────────────────────────────────────────────────────────

/**
 * Query for all scheduled matches whose kickoff has passed, then simulate
 * each one serially.
 *
 * WHY SERIAL (not parallel): keeps per-worker DB load predictable and avoids
 * contention on the profiles.credits read-modify-write inside wager settlement.
 * Multi-worker deployments are handled by the optimistic lock in processMatch(),
 * which prevents double-simulation.
 *
 * Called once per cron tick (configurable schedule, typically every 1–5 minutes).
 */
async function poll(): Promise<void> {
  const { data: dueMatches, error } = await (db as AnyDb)
    .from('matches')
    .select('id, home_team_id, away_team_id')
    .eq('status', 'scheduled')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true });

  if (error) {
    console.warn('[match-worker] poll query failed:', error.message);
    return;
  }

  if (!dueMatches || dueMatches.length === 0) {
    console.log('[match-worker] no matches due');
    return;
  }

  console.log(`[match-worker] ${dueMatches.length} match(es) due`);

  for (const match of dueMatches) {
    await processMatch(match.id, match.home_team_id, match.away_team_id);
  }
}

// ── HTTP endpoint (Deno.serve) ────────────────────────────────────────────────

/**
 * HTTP endpoint called by Supabase Cron.
 *
 * Expects a POST request (cron sends POST by default). Runs one poll cycle,
 * simulating all due matches that exist in the database. Returns JSON success
 * or error status.
 *
 * Configured in Supabase Dashboard → Edge Functions → Cron:
 *   Schedule: `*/1 * * * *` (every 1 minute — adjust as needed)
 *   Function: match-worker
 *   HTTP method: POST
 */
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  console.log('[match-worker] cron tick fired');

  try {
    await poll();
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[match-worker] fatal error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
