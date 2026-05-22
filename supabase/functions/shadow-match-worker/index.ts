// ── shadow-match-worker / index.ts ──────────────────────────────────────────
// Phase 11 of the Universal Agent System (bd isl-bqx.12).  Cron-driven
// edge function that populates `shadow_match_results` for upcoming
// matches.  Each fixture gets N (3-5) shadow outcomes — alternate
// timelines the canonical (live) match would never produce — so the
// Architect council can read the distribution pre-kickoff and decide
// whether the canonical story needs nudging.
//
// CHEAP MONTE-CARLO, NOT FULL SIM
//   v1 deliberately avoids running the full gameEngine.js per shadow.
//   The match-worker already runs the canonical timeline; running 4
//   additional 90-minute simulations per fixture would balloon compute
//   for relatively little signal.  Instead, we draw shadows from the
//   already-computed `match_odds` distribution (home/draw/away
//   probabilities) and use a Poisson-ish goal model to fabricate
//   credible scorelines.  This costs near-zero, produces a reasonable
//   spread, and is easily upgraded later by swapping the inner draw
//   for a real-engine call — the table shape doesn't change.
//
// CADENCE
//   Cron: `15 */1 * * *` (every hour, 15 minutes past).  Off-cycle from
//   architect-galaxy-tick + drama-tick so the three never thunder on
//   the same minute.  Picks up to MATCH_HORIZON matches scheduled in
//   the next SHADOW_HORIZON_HOURS hours that don't yet have a full set
//   of shadow rows.
//
// COST
//   Zero LLM tokens.  Compute: a handful of Math.random rolls per
//   match.  Service-role queries only.  Safe to run frequently.
//
// INVARIANTS
//   - service_role only; never exposed to user-facing reads (RLS).
//   - Idempotent via the (match_id, timeline_index) unique constraint —
//     re-running on a partially-populated match upserts cleanly.
//   - Skips matches with status != 'scheduled' so we never produce
//     shadows for in-progress or completed games.

// deno-lint-ignore-file no-explicit-any

// @ts-ignore — Deno-only import, resolved at deploy time.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

// ── Real-engine shadow draw (Phase 11.1) ────────────────────────────────────
// Pull the match-worker's pure simulator + normaliser via LOCAL copies
// in this function's directory.  Earlier revisions imported from
// `../match-worker/...` directly, but Supabase's edge-function deploy
// pipeline rejects relative imports that traverse outside the function
// directory — see isl-hhz.  The fix mirrors the pattern already used
// by `corpus-enricher/voiceGuard.ts`: the canonical copy lives under
// `supabase/functions/match-worker/`, and this directory carries a
// KEEP-IN-SYNC duplicate of every file the shadow worker needs.  The
// banner at the top of each duplicate spells out the diff invariant
// (the only allowed delta is the banner block itself); edits MUST be
// applied to BOTH places in lockstep.
//
// When the duplication starts hurting, lift the shared engine into
// `supabase/functions/_shared/match-engine/` and have both workers
// import from there.  Until then, the diff check in the banner is the
// drift guard.
//
// SimulationResult shape is intentionally not imported as a type — the
// worker doesn't ship a typed surface here and `any` is already the
// house style for this file's deno-lint exemption.
import { simulateFullMatch } from './simulateFullMatch.ts';
import { normalizeTeamForEngine } from './normalizeTeam.ts';

// ── Tuning constants ────────────────────────────────────────────────────────

/** Shadows per match.  3-5 is enough for "majority of timelines say X" without bloating storage. */
const SHADOWS_PER_MATCH = 5;

/** How many upcoming matches to process per tick.  Avoids thundering on a freshly-seeded season. */
const MATCH_HORIZON = 40;

/** Hours of fixture lookahead from now() — only matches kicking off inside this window get shadows. */
const SHADOW_HORIZON_HOURS = 36;

/**
 * Mean goals per team per match used by the goal model when match_odds
 * is missing.  2.7 total goals (1.35/team) reflects league averages.
 * Independent (not correlated) per side; the model is intentionally
 * simple — outcome selection comes from match_odds, scoreline from
 * here.
 */
const FALLBACK_TEAM_LAMBDA = 1.35;

/**
 * Caps on the goal model output.  Anything above MAX_TEAM_GOALS clamps
 * to MAX_TEAM_GOALS — a 9-1 shadow is statistically rare and visually
 * weird in the council's "distribution" read.
 */
const MAX_TEAM_GOALS = 6;

/**
 * Master switch for the real-engine shadow draw (Phase 11.1).
 *
 * MECHANICAL EFFECT: when true, each shadow runs a full simulateFullMatch
 * (90 in-engine minutes per shadow); when false, the worker falls back to
 * the cheap Poisson sampler.  Default is true — at ~50–200 ms per
 * simulation × SHADOWS_PER_MATCH (5) × MATCH_HORIZON (40) the cumulative
 * budget is well under the 5-minute edge-function ceiling.  Flip to false
 * if a cron tick ever times out so shadows keep landing on schedule
 * while we triage.
 */
const USE_REAL_ENGINE = true;

/**
 * Maximum real-engine shadows per match.  Set lower than
 * SHADOWS_PER_MATCH to mix real-engine + Poisson per fixture — useful if
 * we want one "high-fidelity" shadow plus a cheap distribution-fill.  At
 * SHADOWS_PER_MATCH this means every shadow is real-engine.
 *
 * MECHANICAL EFFECT: the first N shadows for a match use simulateFullMatch
 * (slow but high-fidelity).  Subsequent shadows fall back to Poisson.
 * The council's distribution read mixes both and treats them
 * indistinguishably — the perturbation column lets us tell them apart in
 * audits.
 */
const REAL_ENGINE_SHADOWS_PER_MATCH = SHADOWS_PER_MATCH;

// ── Environment ────────────────────────────────────────────────────────────

// @ts-ignore — Deno global type.
declare const Deno: { env: { get(name: string): string | undefined } };

/**
 * Read a required env var or throw with a clear message.  Same
 * pattern as the other edge functions; fails at boot rather than
 * runtime.
 *
 * @param name  The env var name.
 * @returns     The non-empty value.
 */
function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

// ── Goal sampling ──────────────────────────────────────────────────────────

/**
 * Draw a Poisson-distributed integer using the Knuth multiplicative
 * algorithm.  Sufficient for the small lambda values we use here
 * (≤2 expected goals/team).  Clamped to MAX_TEAM_GOALS.
 *
 * @param lambda  Mean of the Poisson distribution.
 * @returns       A non-negative integer ≤ MAX_TEAM_GOALS.
 */
function samplePoisson(lambda: number): number {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= Math.random();
  } while (p > L);
  const result = k - 1;
  return result > MAX_TEAM_GOALS ? MAX_TEAM_GOALS : result;
}

/**
 * Sample one shadow scoreline conditioned on the chosen outcome.  We
 * draw home + away goals independently from Poisson(lambdaHome) /
 * Poisson(lambdaAway) and resample if the result contradicts the
 * outcome (rejection sampling is fine at small N because the rejection
 * rate is bounded).
 *
 * @param outcome      'home' | 'draw' | 'away' — chosen from match_odds.
 * @param lambdaHome   Home team's goal-rate parameter.
 * @param lambdaAway   Away team's goal-rate parameter.
 * @returns            {home, away} non-negative integers consistent with outcome.
 */
function sampleScoreline(
  outcome: 'home' | 'draw' | 'away',
  lambdaHome: number,
  lambdaAway: number,
): { home: number; away: number } {
  // Cap retries so a pathological lambda choice doesn't loop forever.
  // 30 attempts at the worst case (Poisson(1.35) on both sides) gives
  // ~99.9% probability of finding a draw with at least one goal.
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const home = samplePoisson(lambdaHome);
    const away = samplePoisson(lambdaAway);
    if (outcome === 'draw' && home === away) return { home, away };
    if (outcome === 'home' && home > away) return { home, away };
    if (outcome === 'away' && away > home) return { home, away };
  }
  // Fallback — produce a minimum-bias result consistent with outcome
  // when sampling fails.  Keeps the function deterministic-output even
  // in degenerate cases.
  if (outcome === 'draw') return { home: 1, away: 1 };
  if (outcome === 'home') return { home: 1, away: 0 };
  return { home: 0, away: 1 };
}

/**
 * Pick an outcome category according to weighted probabilities.  Falls
 * back to a 45/30/25 home-leaning split when match_odds is missing.
 *
 * @param probs  {home, draw, away} implied probabilities summing to ~1.
 * @returns      One of 'home' | 'draw' | 'away'.
 */
function sampleOutcome(probs: {
  home: number;
  draw: number;
  away: number;
}): 'home' | 'draw' | 'away' {
  const r = Math.random();
  if (r < probs.home) return 'home';
  if (r < probs.home + probs.draw) return 'draw';
  return 'away';
}

// ── Team fetch for real-engine shadows ─────────────────────────────────────

/**
 * Load a team row + manager + active players in the same shape the
 * match-worker uses for canonical simulation.  Duplicated select string
 * with the match-worker so any column change there is mirrored here at
 * the same time (look for the same comment block).
 *
 * Returns null on error so the caller can fall back to Poisson without
 * the whole tick exploding on one bad team.
 *
 * @param db      Service-role Supabase client.
 * @param teamId  Team slug.
 * @returns       Raw team row ready for normalizeTeamForEngine, or null.
 */
async function fetchTeamForShadow(db: any, teamId: string): Promise<any | null> {
  const { data, error } = await db
    .from('teams')
    // Keep this select in sync with match-worker/index.ts:fetchTeamForSimulation —
    // both feed the same normalizer + the same engine.
    .select(
      'id, name, short_name, color, location, home_ground, capacity, ' +
      'managers(id, name, entity_id), ' +
      'players(id, entity_id, name, position, age, jersey_number, starter, ' +
      'attacking, defending, mental, technical, athletic, is_active)',
    )
    .eq('id', teamId)
    .single();

  if (error || !data) {
    console.warn(`[shadow-match-worker] team fetch failed for ${teamId}:`, error?.message);
    return null;
  }
  return data;
}

/**
 * Map a final score to the three-way outcome shape we store on the
 * shadow row.  Equal scores are 'draw' — same convention as the
 * canonical match-worker.
 *
 * @param home  Home goals.
 * @param away  Away goals.
 * @returns     'home' | 'draw' | 'away'.
 */
function outcomeFromScore(home: number, away: number): 'home' | 'draw' | 'away' {
  if (home > away) return 'home';
  if (away > home) return 'away';
  return 'draw';
}

// ── Per-match shadow generation ────────────────────────────────────────────

interface ShadowRow {
  match_id: string;
  timeline_index: number;
  home_goals: number;
  away_goals: number;
  outcome: 'home' | 'draw' | 'away';
  perturbation: string;
}

/**
 * Generate the SHADOWS_PER_MATCH shadow rows for one upcoming match.
 *
 * STRATEGY
 *   The first REAL_ENGINE_SHADOWS_PER_MATCH shadows run a full
 *   `simulateFullMatch` (90 engine minutes; deterministic given the
 *   RNG sequence at call time).  Successive Math.random draws between
 *   calls produce different timelines without any explicit perturbation
 *   — same teams, divergent stories.  Remaining shadows fall back to
 *   the Poisson sampler so distribution-fill stays cheap.
 *
 *   When USE_REAL_ENGINE is false OR team fetch fails, the function
 *   falls through entirely to the Poisson path so a single bad team
 *   never strands a fixture's shadow set.
 *
 * @param db         Supabase client.
 * @param matchId    Match UUID.
 * @param homeTeamId Home team slug — needed for real-engine fetch.
 * @param awayTeamId Away team slug — needed for real-engine fetch.
 * @returns          Array of ShadowRow inserts.
 */
async function generateShadows(
  db: any,
  matchId: string,
  homeTeamId: string,
  awayTeamId: string,
): Promise<ShadowRow[]> {
  // ── Outcome probabilities from match_odds, if present. ──────────────────
  const oddsQ = await db
    .from('match_odds')
    .select('home_implied_prob, draw_implied_prob, away_implied_prob')
    .eq('match_id', matchId)
    .maybeSingle();

  let probs = { home: 0.45, draw: 0.30, away: 0.25 };
  if (!oddsQ.error && oddsQ.data) {
    probs = {
      home: oddsQ.data.home_implied_prob ?? 0.45,
      draw: oddsQ.data.draw_implied_prob ?? 0.30,
      away: oddsQ.data.away_implied_prob ?? 0.25,
    };
  }
  // ── Lambda derivation from probs. ───────────────────────────────────────
  // Mild slope around the canonical 1.35 mean: stronger sides score
  // more.  Bounded to [0.4, 2.6] so a 90%-home favourite still doesn't
  // produce 5-0 every shadow.
  const lambdaHome = Math.max(
    0.4,
    Math.min(2.6, FALLBACK_TEAM_LAMBDA + (probs.home - 0.45) * 1.8),
  );
  const lambdaAway = Math.max(
    0.4,
    Math.min(2.6, FALLBACK_TEAM_LAMBDA + (probs.away - 0.25) * 1.8),
  );

  // ── Optional real-engine pre-load ───────────────────────────────────────
  // When USE_REAL_ENGINE is true, fetch + normalise both teams ONCE so
  // every real-engine shadow can reuse the same payload.  Fetch errors
  // demote the match to all-Poisson mode (homeNormalised == null sentinel).
  let homeNormalised: any | null = null;
  let awayNormalised: any | null = null;
  if (USE_REAL_ENGINE && REAL_ENGINE_SHADOWS_PER_MATCH > 0) {
    const [homeRow, awayRow] = await Promise.all([
      fetchTeamForShadow(db, homeTeamId),
      fetchTeamForShadow(db, awayTeamId),
    ]);
    if (homeRow && awayRow) {
      homeNormalised = normalizeTeamForEngine(homeRow);
      awayNormalised = normalizeTeamForEngine(awayRow);
    }
  }

  // ── Per-shadow draw. ────────────────────────────────────────────────────
  // First REAL_ENGINE_SHADOWS_PER_MATCH timelines use the real engine
  // (when prerequisites met); remainder use the Poisson sampler so a
  // single fixture always lands a full set even if compute is tight.
  const rows: ShadowRow[] = [];
  for (let i = 0; i < SHADOWS_PER_MATCH; i += 1) {
    const useEngine =
      USE_REAL_ENGINE &&
      i < REAL_ENGINE_SHADOWS_PER_MATCH &&
      homeNormalised !== null &&
      awayNormalised !== null;

    if (useEngine) {
      try {
        const result = simulateFullMatch(homeNormalised, awayNormalised, null, null);
        const [home, away] = result.finalScore as [number, number];
        rows.push({
          match_id: matchId,
          timeline_index: i,
          home_goals: home,
          away_goals: away,
          outcome: outcomeFromScore(home, away),
          // `real_engine` marks this row as a full-engine shadow so audits
          // can separate it from Poisson-derived rows when validating the
          // distribution.
          perturbation: 'real_engine',
        });
        continue;
      } catch (err) {
        console.warn(
          `[shadow-match-worker] real-engine sim failed for ${matchId} (timeline ${i}):`,
          err,
        );
        // Fall through to Poisson — better one off shadow than a partial set.
      }
    }

    const outcome = sampleOutcome(probs);
    const { home, away } = sampleScoreline(outcome, lambdaHome, lambdaAway);
    rows.push({
      match_id: matchId,
      timeline_index: i,
      home_goals: home,
      away_goals: away,
      outcome,
      perturbation: 'rng_only',
    });
  }
  return rows;
}

// ── Main entry point ──────────────────────────────────────────────────────

/**
 * Cron handler.  Pulls upcoming scheduled matches missing a full
 * shadow set, generates the shadows, upserts them.
 *
 * @returns  JSON Response with `{ processed, shadowsInserted }`.
 */
async function handler(): Promise<Response> {
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── Pick candidate matches. ─────────────────────────────────────────────
  const horizonIso = new Date(
    Date.now() + SHADOW_HORIZON_HOURS * 3600 * 1000,
  ).toISOString();
  const nowIso = new Date().toISOString();

  const matchesQ = await db
    .from('matches')
    // home_team_id / away_team_id are required by the real-engine path so
    // we can fetch + normalise both squads.  Poisson-only mode ignores them.
    .select('id, scheduled_at, home_team_id, away_team_id')
    .eq('status', 'scheduled')
    .gte('scheduled_at', nowIso)
    .lte('scheduled_at', horizonIso)
    .order('scheduled_at', { ascending: true })
    .limit(MATCH_HORIZON);

  if (matchesQ.error) {
    console.warn('[shadow-match-worker] matches fetch failed:', matchesQ.error.message);
    return new Response(
      JSON.stringify({ error: 'matches_fetch_failed' }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }

  const candidateMatches = matchesQ.data ?? [];

  // ── Skip matches that already have a full shadow set. ──────────────────
  let processed = 0;
  let shadowsInserted = 0;
  for (const match of candidateMatches) {
    const existingQ = await db
      .from('shadow_match_results')
      .select('id', { count: 'exact', head: true })
      .eq('match_id', match.id);
    if ((existingQ.count ?? 0) >= SHADOWS_PER_MATCH) continue;

    const rows = await generateShadows(
      db,
      match.id,
      match.home_team_id,
      match.away_team_id,
    );
    if (rows.length === 0) continue;

    const { error: upsertErr } = await db
      .from('shadow_match_results')
      .upsert(rows, { onConflict: 'match_id,timeline_index' });
    if (upsertErr) {
      console.warn(
        `[shadow-match-worker] upsert failed for ${match.id}:`,
        upsertErr.message,
      );
      continue;
    }
    processed += 1;
    shadowsInserted += rows.length;
  }

  return new Response(
    JSON.stringify({ processed, shadowsInserted }),
    { headers: { 'content-type': 'application/json' } },
  );
}

// @ts-ignore — Deno-only API.
Deno.serve(async (_req: Request) => {
  try {
    return await handler();
  } catch (err) {
    console.error('[shadow-match-worker] fatal:', err);
    return new Response(
      JSON.stringify({ error: 'internal server error' }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }
});
