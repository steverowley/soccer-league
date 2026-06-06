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
import { settleMatchWagers, maybeTransitionSeasonForMatch, maybeAdvanceCupBracket, writeMatchCompletionMemories } from './postMatchEffects.ts';
import { prepareArchitectForMatch, type CosmicArchitect, type LoreStore } from './architect.ts';
import { generateInterferences } from './architectInterference.ts';
import {
  applyAnnulGoals,
  applyForceRedCards,
  reconcileStatsAfterInterference,
  resolveInterferenceStream,
  type AnnulGoalIntent,
  type ForceRedCardIntent,
  type InterferenceEffect,
} from './interferenceResolver.ts';
import { computeFanBoost } from './fanBoost.ts';
import { ensureOddsForUpcoming } from './oddsGenerator.ts';
// Phase 8 reflex-tier hooks duplicated into the worker (isl-5kx) so
// in-match shoot_or_pass + card_severity decisions can consult each
// agent's persona + memory substrate.  Worker-side mirror of
// src/features/agents/{api/prepareCorpusForMatch,logic/decisions,
// logic/resolvers/{shootOrPass,cardSeverity}}.
import { prepareCorpusForMatch, runDecision } from './agentReflex.ts';
import { simulateSpatialMatch } from './spatial/simulateSpatialMatch.ts';
import { adaptSpatialResult, buildPlayerIndex, toSpatialTeamInput, filterNotableEvents } from './spatial/spatialEventAdapter.ts';
import type { PositionFrame } from './spatial/types.ts';

// ── Configuration ──────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

/**
 * Anthropic API key for Architect LLM calls (pre-match omen + post-match
 * verdict).  Optional: when empty, the architect falls back to deterministic
 * templates and the post-match save only writes a match-ledger entry — no
 * verdict, no player-arc updates, no relationship mutations.  Match
 * completion is never blocked on this key being present.
 */
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';

/**
 * When truthy, the full agent-based spatial simulation (Phase A rebuild)
 * runs instead of `simulateFullMatch`.  The spatial engine emits real
 * per-second (x,y) position frames and derives match events from geometry
 * (ball crossing goal line, tackle distance, etc.) rather than probability
 * rolls.  All downstream code — Architect interference, event persistence,
 * player-stat rows — is unchanged because `adaptSpatialResult` emits the
 * same `{ events, finalScore, mvp, playerStats }` shape.
 *
 * Set to 'true' in the Supabase Function environment to enable.
 */
const USE_SPATIAL_ENGINE = Deno.env.get('USE_SPATIAL_ENGINE') === 'true';

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
    // `round` is read post-match by postMatchLoreSave to surface the matchday
    // in the Architect verdict prompt (e.g. 'Matchday 7', 'Final').  Absent
    // matches still process — the field is treated as 0 downstream.
    .select('id, home_team_id, away_team_id, scheduled_at, competition_id, round');

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
    // `preferred_formation` on the manager row is read by `toSpatialTeamInput`
    // to assign each player to their correct formation slot (e.g. '4-4-2').
    // The legacy `normalizeTeamForEngine` path ignores it safely.
    .select('id, name, short_name, color, location, home_ground, capacity, managers(id, name, entity_id, preferred_formation), players(id, entity_id, name, position, age, jersey_number, starter, attacking, defending, mental, technical, athletic, is_active)')
    .eq('id', teamId)
    .single();

  if (error) {
    console.error(`[match-worker] Failed to fetch team ${teamId}:`, error);
    return null;
  }

  return data;
}

// ── Helper: Post-match lore save ───────────────────────────────────────────

/**
 * Builds the match-state shape the Architect expects, calls saveMatchToLore
 * (LLM-driven verdict + lore mutations) and persists the mutated lore.
 *
 * Extracted so the post-match orchestration block in processMatch stays
 * focused on cron-level concerns (settlement, cup advance, season tx) and
 * the lore-specific marshalling/persistence logic lives in one place.
 *
 * @param architect  The CosmicArchitect from prepareArchitectForMatch.
 *                   `architect.lore` is mutated in place by saveMatchToLore.
 * @param loreStore  The LoreStore from prepareArchitectForMatch.  Used to
 *                   batch-upsert the mutated lore + drain pending writes.
 * @param match      The DB match row this worker just simulated; we use
 *                   `round` as the matchday hint in the verdict prompt.
 * @param result     Output of simulateFullMatch — events, score, MVP, stats.
 * @param homeData   Raw home team row (for the team shape + player roster
 *                   the verdict prompt references).
 * @param awayData   Raw away team row.
 */
async function postMatchLoreSave(
  architect: CosmicArchitect,
  loreStore: LoreStore,
  match: any,
  result: { events: any[]; finalScore: [number, number]; mvp: string; playerStats: any },
  homeData: any,
  awayData: any,
): Promise<void> {
  // The events array carries the minute-by-minute commentary; saveMatchToLore
  // inlines goals + red cards + injuries into the verdict prompt so the LLM
  // can reference specific moments.  We forward only the fields it reads.
  const matchState = {
    events:      result.events.map((ev: any) => ({
      minute:     ev.minute,
      type:       ev.type,
      commentary: ev.payload?.commentary,
      isGoal:     ev.payload?.isGoal,
      cardType:   ev.payload?.cardType,
      isInjury:   ev.payload?.isInjury,
    })),
    score:       result.finalScore,
    playerStats: result.playerStats,
    mvp:         result.mvp,
    homeTeam: {
      name:      homeData.name,
      shortName: homeData.short_name ?? homeData.name,
      players:   (homeData.players ?? []).map((p: any) => ({ name: p.name })),
    },
    awayTeam: {
      name:      awayData.name,
      shortName: awayData.short_name ?? awayData.name,
      players:   (awayData.players ?? []).map((p: any) => ({ name: p.name })),
    },
  };

  // leagueContext carries only what we can derive without another DB round-trip:
  //   - matchday: `match.round` is a free-form string ('Matchday 1', 'Final').
  //     We strip non-digits for the numeric ledger column; 0 when not parseable.
  //   - seasonId / season / league: would require a competitions JOIN that
  //     isn't worth the round-trip for v1; the architect just won't write a
  //     season-arc row when seasonId is absent (the rest of the verdict still lands).
  const matchdayDigits = String(match.round ?? '').replace(/\D/g, '');
  const leagueContext = {
    matchday: matchdayDigits ? Number(matchdayDigits) : 0,
  };

  await architect.saveMatchToLore(matchState, leagueContext);
  loreStore.persistAll(architect.lore);
  await loreStore.flush();
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

    // ── Referee lookup (isl-84e) ───────────────────────────────────────────
    // Read the assigned referee from `match_referee_v` so the engine knows
    // the correct officiating identity AND so the Phase 8 `card_severity`
    // reflex resolver can resolve the referee's persona via `entity_id`.
    // The view returns `referee_strictness` on the raw 1–10 trait scale;
    // we multiply by 10 to land on the engine's 0–100 strictness scale
    // (matching the contract documented in simulateFullMatch.ts).
    //
    // Failure modes are all degrade-gracefully: a missing FK, a view
    // query error, or a referee with no strictness trait → `null`
    // refOverride, and gameEngine falls back to the legacy random
    // fabricated referee with `entity_id: null`.
    let refOverride: { name: string; strictness: number; entity_id: string | null } | null = null;
    try {
      const { data: refRow, error: refErr } = await supabase
        .from('match_referee_v')
        .select('referee_id, referee_name, referee_display_name, referee_strictness')
        .eq('match_id', match.id)
        .maybeSingle();
      if (refErr) {
        console.warn(`[match-worker] match_referee_v query failed: ${refErr.message}`);
      } else if (refRow && refRow.referee_id) {
        const name = (refRow.referee_display_name as string | null) ?? (refRow.referee_name as string);
        const rawStrictness = (refRow.referee_strictness as number | null) ?? 5;
        refOverride = {
          name,
          // Trait scale 1–10 → engine scale 0–100.
          strictness: rawStrictness * 10,
          entity_id: refRow.referee_id as string,
        };
        console.log(`[match-worker] Referee: ${name} (strictness ${refOverride.strictness}/100, entity ${refOverride.entity_id})`);
      }
    } catch (err) {
      console.warn('[match-worker] referee lookup threw:', (err as Error)?.message ?? err);
    }

    // ── Political-decree aggregation (isl-azz) ─────────────────────────────
    // Read every political_decree row for THIS match's season and
    // aggregate the three documented payload axes:
    //   • cadence_mult  → recorded but not yet applied (would mutate
    //                     season_config.match_duration_seconds; deferred
    //                     to a follow-up that owns the global pacing
    //                     knob).
    //   • ref_strictness_delta → SUMMED across all decrees; ADDED to
    //                     the looked-up referee's strictness then
    //                     clamped to the engine's 0..100 scale.  This
    //                     is the only effect we apply in v1 because
    //                     it slots cleanly into the existing
    //                     refOverride object isl-84e wired.
    //   • ticket_multiplier   → recorded but not yet applied (would
    //                     modulate team_finances ticket revenue; lives
    //                     in a different code path and stays in this
    //                     PR's deferred list).
    //
    // Failure modes degrade silently — a query error or a malformed
    // payload row leaves the existing refOverride untouched so the
    // worker never blocks on the decrees subsystem.
    try {
      // Find the season id this match belongs to via its competition.
      const seasonId =
        match.competition_id != null
          ? (async () => {
              const { data: comp } = await supabase
                .from('competitions')
                .select('season_id')
                .eq('id', match.competition_id)
                .maybeSingle();
              return (comp as { season_id?: string } | null)?.season_id ?? null;
            })()
          : Promise.resolve(null);
      const resolvedSeasonId = await seasonId;
      if (resolvedSeasonId) {
        const { data: decrees, error: decreeErr } = await supabase
          .from('season_decrees')
          .select('payload')
          .eq('season_id', resolvedSeasonId)
          .eq('decree_type', 'political_decree');
        if (decreeErr) {
          console.warn(`[match-worker] season_decrees query failed: ${decreeErr.message}`);
        } else if (Array.isArray(decrees) && decrees.length > 0) {
          let totalRefDelta = 0;
          for (const row of decrees) {
            const p = (row as { payload?: unknown }).payload as
              | { ref_strictness_delta?: unknown }
              | null
              | undefined;
            const d =
              typeof p?.ref_strictness_delta === 'number' ? p.ref_strictness_delta : 0;
            totalRefDelta += d;
          }
          if (totalRefDelta !== 0 && refOverride) {
            const before = refOverride.strictness;
            // Clamp to the engine's 0..100 strictness scale so a
            // pile of decrees can't push the value off the cliff.
            refOverride.strictness = Math.max(0, Math.min(100, before + totalRefDelta));
            console.log(
              `[match-worker] political_decree: ref strictness ${before} → ${refOverride.strictness} ` +
              `(Σ delta ${totalRefDelta} across ${decrees.length} decree(s))`,
            );
          }
        }
      }
    } catch (err) {
      console.warn('[match-worker] political_decree aggregation threw:', (err as Error)?.message ?? err);
    }

    // ── Pre-match context ───────────────────────────────────────────────────
    // Fan boost + Architect lifecycle are both hydrated here in parallel and
    // threaded into simulateFullMatch.  Both falling back to no-ops (no
    // fans / empty lore) is the common case early in the DB's life and is
    // the deliberate degradation path — kickoff must never block on either.
    //
    // `prepareArchitectForMatch` REPLACES the previous `hydrateArchitectBridge`
    // wiring: it returns a full CosmicArchitect (not just the read-only
    // GhostArchitect) so the same instance can mint pre-match omens AND
    // accept the post-match `saveMatchToLore` call that closes the
    // architect_lore persistence loop.  See architect.ts for the rationale.
    const [fanBoost, prepared] = await Promise.all([
      computeFanBoost(supabase, match.home_team_id, match.away_team_id),
      prepareArchitectForMatch(supabase, {
        apiKey:   ANTHROPIC_API_KEY,
        homeTeam: {
          name:      home.name,
          shortName: home.shortName,
          color:     home.color,
          players:   home.players.map((p) => ({ name: p.name })),
        },
        awayTeam: {
          name:      away.name,
          shortName: away.shortName,
          color:     away.color,
          players:   away.players.map((p) => ({ name: p.name })),
        },
        homeManager: { name: home.manager.name },
        awayManager: { name: away.manager.name },
        // home.stadium is always populated by normalizeTeamForEngine — but
        // guard anyway in case future schema lets it be null.
        stadium: home.stadium
          ? { name: home.stadium.name, planet: home.stadium.planet }
          : null,
        // Weather is selected by gameEngine inside createAIManager once the
        // simulation starts; we don't have it at omen time and the omen
        // prompt only references it as flavour.  Empty string is acceptable.
        weather: '',
        // Phase 11.2: matchId drives the shadow-distribution load inside
        // prepareArchitectForMatch.  Without it the council would
        // deliberate without the alternate-timeline read.
        matchId: match.id,
      }),
    ]);
    const { architect, loreStore } = prepared;
    if (fanBoost.boostedSide !== 'none') {
      console.log(`[match-worker] Fan boost: +${fanBoost.boostAmount} to ${fanBoost.boostedSide}`);
    }

    // ── Pre-match Cosmic Omen ──────────────────────────────────────────────
    // Fire-and-forget Architect prologue: generate a cryptic omen +
    // matchTitle and write to `narratives` (kind='cosmic_omen') so the news
    // feed gets a pre-kickoff atmospheric beat.  Awaited so we don't race
    // with the worker isolate shutdown, but wrapped in its own try/catch so
    // an LLM or insert failure NEVER blocks the simulation.
    try {
      const omen = await architect.getPreMatchOmen();
      const { error: omenErr } = await supabase.from('narratives').insert({
        kind:              'cosmic_omen',
        summary:           `${omen.matchTitle}. ${omen.omen}`,
        entities_involved: [],
        source:            'match',
      });
      if (omenErr) {
        console.warn(`[match-worker] cosmic_omen insert failed: ${omenErr.message}`);
      }
    } catch (err) {
      console.warn('[match-worker] getPreMatchOmen threw:', (err as Error)?.message ?? err);
    }

    // ── Phase 8 reflex-hooks hydration (isl-5kx) ─────────────────────────
    // Collect every involved entity_id (players + referee + both
    // managers) and batch-fetch their personas + recent memories into
    // an in-memory corpus.  The engine's shoot_or_pass / card_severity
    // resolvers consult this corpus synchronously during the match —
    // a Supabase round-trip per decision would tank simulation speed
    // (thousands of in-match calls).  Failure modes degrade silently:
    // missing personas fall back to neutral 0.5 Big-Five values; the
    // resolvers remain well-behaved.
    const involvedEntityIds: string[] = [];
    for (const p of home.players ?? []) {
      if (p?.entity_id) involvedEntityIds.push(p.entity_id);
    }
    for (const p of away.players ?? []) {
      if (p?.entity_id) involvedEntityIds.push(p.entity_id);
    }
    if (refOverride?.entity_id) involvedEntityIds.push(refOverride.entity_id);
    if (home.manager?.entity_id) involvedEntityIds.push(home.manager.entity_id);
    if (away.manager?.entity_id) involvedEntityIds.push(away.manager.entity_id);

    let reflexHooks: { agentCorpus: unknown; runDecision: typeof runDecision } | null = null;
    try {
      const agentCorpus = await prepareCorpusForMatch(supabase, involvedEntityIds);
      reflexHooks = { agentCorpus, runDecision };
      console.log(
        `[match-worker] reflex corpus hydrated: ${agentCorpus.personas.size} personas, ` +
        `${[...agentCorpus.memories.values()].reduce((n, rows) => n + rows.length, 0)} memories ` +
        `(over ${involvedEntityIds.length} involved entities)`,
      );
    } catch (err) {
      console.warn('[match-worker] reflex corpus hydration threw:', (err as Error)?.message ?? err);
    }

    // ── Simulation dispatch ────────────────────────────────────────────────
    // Two engine paths share all downstream code (Architect interference,
    // event persist, stat rows) because both emit the same result shape:
    //   { events, finalScore, mvp, playerStats }
    //
    // PATH A — spatial engine (USE_SPATIAL_ENGINE=true)
    //   Full agent-based simulation: 22 autonomous players with Reynolds
    //   steering behaviours, formation slots, and possession physics.
    //   Events (goals, tackles, saves) emerge from geometry rather than
    //   probability rolls.  Returns real per-player (x,y) frames stored in
    //   `match_positions` for the high-res pitch viewer.
    //
    // PATH B — legacy dice-roller (USE_SPATIAL_ENGINE=false / default)
    //   `simulateFullMatch` wrapping `genEvent` probability rolls with
    //   Architect + reflex-hook wiring.  `refOverride` passes the assigned
    //   referee identity; `reflexHooks` powers the Phase 8 shoot_or_pass /
    //   card_severity resolvers.  `null` on either falls back gracefully.
    //
    // `result` is mutable because Architect interference may reassign
    // `result.events` and `result.finalScore` further down this function.
    // eslint-disable-next-line prefer-const
    let result: ReturnType<typeof simulateFullMatch>;
    // Position frames collected from the spatial engine; empty for Path B.
    let positionFrames: PositionFrame[] = [];

    if (USE_SPATIAL_ENGINE) {
      // Convert raw DB rows to the typed input the spatial engine expects.
      const homeInput = toSpatialTeamInput(homeData);
      const awayInput = toSpatialTeamInput(awayData);

      // Derive a deterministic 32-bit seed from the first 8 hex chars of the
      // match UUID.  Same match_id → identical simulation outcome on every
      // worker retry, which is the spatial engine's equivalent of the legacy
      // engine's seeded LCG guarantee.
      const seed = parseInt(match.id.replace(/-/g, '').slice(0, 8), 16);

      const spatialResult = simulateSpatialMatch(homeInput, awayInput, { seed });

      // Build the id → { name, teamName, side } index the adapter needs to
      // map spatial player ids back to names (which the worker's playerIndex
      // join is keyed on downstream).
      const playerIdx = buildPlayerIndex(homeData, awayData);

      // adaptSpatialResult derives team display names from the playerIndex
      // entries (buildPlayerIndex stamps each player's short team name), so it
      // takes only (result, playerIndex) — the home/away short names this call
      // used to pass were silently ignored.
      const adapted = adaptSpatialResult(spatialResult, playerIdx);
      // Cast is safe: AdaptedSpatialResult has the same runtime shape as
      // SimulatedMatchResult — events, finalScore, mvp, playerStats — and
      // all downstream consumers treat these fields as `any`.
      result = adapted as unknown as ReturnType<typeof simulateFullMatch>;
      positionFrames = spatialResult.frames;

      console.log(
        `[match-worker] Spatial sim: ${spatialResult.finalScore[0]}–${spatialResult.finalScore[1]}, ` +
        `${spatialResult.events.length} events, ${positionFrames.length} position frames`,
      );
    } else {
      // PATH B: legacy simulateFullMatch.
      // `refOverride` is the isl-84e wiring — passes the assigned referee's
      // identity (incl. entity_id) into createAIManager so the Phase 8
      // card_severity resolver can find the referee persona.  `null` (no
      // referee assigned to this match) falls back to a random fabricated
      // official with `entity_id: null`.
      // `reflexHooks` (isl-5kx) supplies the in-match shoot_or_pass +
      // card_severity dispatcher; null falls back to legacy stat-driven
      // decisions inside gameEngine.
      result = simulateFullMatch(home, away, fanBoost, architect, reflexHooks, refOverride);
    }

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

    // ── Architect interferences (#370) ─────────────────────────────────────
    // Close the audit's "headline mechanic is dark code" finding: ask the
    // Cosmic Architect to react to up to 3 dramatic moments in the just-
    // simulated match. Each successful call produces a synthetic
    // architect_interference event for the live commentary feed AND an
    // architect_interventions audit row.
    //
    // Runs POST-simulation rather than in the per-minute loop so the
    // worker doesn't add ~14s of in-line LLM latency per match. The
    // narrative-first scope (no engine-side mutation) is deliberate —
    // future slice wires the chosen interferenceType into a per-event
    // resolver that the engine reads during simulation.
    //
    // Fails soft: any LLM error logs and skips that slot; the rest of
    // the match proceeds unchanged.
    try {
      const interferences = await generateInterferences(
        ANTHROPIC_API_KEY,
        result.events,
        result.finalScore,
        home.name ?? home.shortName ?? 'Home',
        away.name ?? away.shortName ?? 'Away',
      );
      for (const inter of interferences) {
        result.events.push({
          minute:    inter.minute,
          subminute: inter.subminute,
          type:      'architect_interference',
          payload:   {
            interferenceType: inter.interferenceType,
            proclamation:     inter.proclamation,
            targetPlayer:     inter.targetPlayer,
            targetTeam:       inter.targetTeam,
            magnitude:        inter.magnitude,
          },
        });
        // Audit row — mirrors the shape mid-week intrusions use in
        // architect-galaxy-tick so a single dashboard query surfaces all
        // Architect actions (in-match + out-of-match).
        await supabase.from('architect_interventions').insert({
          target_table: 'matches',
          target_id:    match.id,
          field:        inter.interferenceType,
          old_value:    { minute: inter.minute },
          new_value:    { proclamation: inter.proclamation, magnitude: inter.magnitude },
          reason:       `In-match Architect interference at minute ${inter.minute}: ${inter.interferenceType}.`,
          meta:         {
            match_id:      match.id,
            kind:          'in_match_interference',
            source:        'match-worker',
            target_player: inter.targetPlayer,
            target_team:   inter.targetTeam,
          },
        });
      }
      if (interferences.length > 0) {
        console.log(`[match-worker] Architect emitted ${interferences.length} interference(s) for match ${match.id}`);
      }

      // ── Architect mechanical effects (#476) ──────────────────────────────
      // Up to this point `interferences` is purely narrative — each one
      // emitted an `architect_interference` row for live commentary but the
      // simulated match outcome was identical with or without it. This
      // block closes #428's "headline mechanic is dark code" by partitioning
      // the LLM-chosen interferences into the four resolver-input buckets
      // and applying the pure post-passes from interferenceResolver.ts:
      //
      //   curse_player    → InterferenceEffect on `ctx.curses`
      //   bless_player    → InterferenceEffect on `ctx.blesses`
      //   annul_goal      → AnnulGoalIntent (retrospective goal rewind)
      //   force_red_card  → ForceRedCardIntent (forward card promotion)
      //
      // ORDER OF PASSES matters: curse/bless first (so an annulled goal
      // doesn't get re-cursed), then annul_goal, then force_red_card.
      // The resolvers naturally skip narrative architect_interference
      // events (no `payload.player`, no `payload.isGoal`, not a card-able
      // type) so we can run the post-pass over the FULL events array —
      // engine events + narrative items — and only the engine events
      // mutate.
      //
      // ── targetTeam mapping ──
      // architectInterference returns 'home' | 'away' | null. The engine
      // stamps goals with `payload.team === posTeam.shortName`, so we
      // map at the partition step to keep the resolver string-compare
      // pure.
      //
      // ── annul_goal minute offset ──
      // The Architect speaks AT or just AFTER the trigger goal (subminute
      // = goal.subminute + 0.005). applyAnnulGoals walks AT or AFTER
      // intent.minute. To catch the just-occurred goal we subtract
      // ANNUL_BACKSCAN_MINUTES from the speak-minute so the walk picks
      // up the goal that triggered the proclamation. The window is small
      // (3) so we don't accidentally consume a much older goal.
      const ANNUL_BACKSCAN_MINUTES = 3;

      const curses:        InterferenceEffect[]  = [];
      const blesses:       InterferenceEffect[]  = [];
      const annulGoals:    AnnulGoalIntent[]     = [];
      const forceRedCards: ForceRedCardIntent[]  = [];

      for (const inter of interferences) {
        // Map 'home'/'away' → the engine's shortName for goal-team match.
        const targetTeamShortName = inter.targetTeam === 'home' ? (home.shortName ?? home.name)
                                  : inter.targetTeam === 'away' ? (away.shortName ?? away.name)
                                  : null;
        switch (inter.interferenceType) {
          case 'curse_player':
            if (inter.targetPlayer) {
              curses.push({
                playerName: inter.targetPlayer,
                magnitude:  inter.magnitude,
                startMin:   inter.minute,
              });
            }
            break;
          case 'bless_player':
            if (inter.targetPlayer) {
              blesses.push({
                playerName: inter.targetPlayer,
                magnitude:  inter.magnitude,
                startMin:   inter.minute,
              });
            }
            break;
          case 'annul_goal':
            // Without a target team we can't disambiguate which side's
            // goal to annul — skip rather than guess.
            if (targetTeamShortName) {
              annulGoals.push({
                team:      targetTeamShortName,
                minute:    Math.max(0, inter.minute - ANNUL_BACKSCAN_MINUTES),
                magnitude: inter.magnitude,
              });
            }
            break;
          case 'force_red_card':
            if (inter.targetPlayer) {
              forceRedCards.push({
                playerName: inter.targetPlayer,
                minute:     inter.minute,
                magnitude:  inter.magnitude,
              });
            }
            break;
          // All other interferenceTypes remain narrative-only in this slice.
          // Adding mechanics for them is straightforward — wire another
          // resolver in interferenceResolver.ts and another bucket here.
        }
      }

      // Apply the post-passes in sequence. Each takes a SimulatedEvent[]
      // and returns a (possibly new) SimulatedEvent[] — input is never
      // mutated. Production uses Math.random; the resolvers' magnitude*0.1
      // probability gate encodes the per-intent uncertainty so the
      // Architect's call is not always guaranteed to fire.
      let mutated = result.events;
      if (curses.length > 0 || blesses.length > 0) {
        mutated = resolveInterferenceStream(mutated, { curses, blesses }, Math.random);
      }
      if (annulGoals.length > 0) {
        mutated = applyAnnulGoals(mutated, annulGoals, Math.random);
      }
      if (forceRedCards.length > 0) {
        mutated = applyForceRedCards(mutated, forceRedCards, Math.random);
      }

      // Re-derive finalScore from the mutated stream so annulled / cursed
      // goals are removed from the scoreline. Engine-side score lives in
      // `result.finalScore`; mirrors the same shortName comparison the
      // simulator uses internally.
      if (mutated !== result.events) {
        const rederived: [number, number] = [0, 0];
        for (const ev of mutated) {
          const pl = ev.payload as Record<string, unknown>;
          if (pl['isGoal'] !== true) continue;
          if (pl['team'] === (home.shortName ?? home.name))      rederived[0]++;
          else if (pl['team'] === (away.shortName ?? away.name)) rederived[1]++;
        }
        const mutationCount = mutated.filter(
          ev => (ev.payload as Record<string, unknown>)['interferenceApplied'],
        ).length;
        console.log(
          `[match-worker] Architect mechanically mutated ${mutationCount} event(s); ` +
          `score ${result.finalScore[0]}–${result.finalScore[1]} → ${rederived[0]}–${rederived[1]}`,
        );
        result.events     = mutated;
        result.finalScore = rederived;
        // Reconcile per-player counters with the mutated stream so an annulled
        // goal leaves its scorer's tally and a forced red card reaches
        // match_player_stats / the idol leaderboard — otherwise statRows below
        // would persist the pre-interference counts, diverging from the
        // re-derived scoreline.
        result.playerStats = reconcileStatsAfterInterference(result.playerStats, mutated);
      }
    } catch (err) {
      console.warn('[match-worker] generateInterferences threw (non-fatal):', err);
    }

    // ── Trim the spatial event flood (#519) ────────────────────────────────
    // The spatial engine emits ~8,500 per-tick events/match (thousands of
    // tackles/interceptions/passes).  Persist + show only the notable beats
    // plus anything the Architect just touched.  Runs AFTER interference so
    // force_red_card still found its tackle to promote, and so cursed/annulled
    // goals (now interferenceApplied 'shot' events) survive the trim.  Stats
    // were accumulated over the full stream in adaptSpatialResult and are
    // unaffected.  Spatial-only; the legacy path already emits ~40-50 events.
    if (USE_SPATIAL_ENGINE) {
      const beforeCount = result.events.length;
      result.events = filterNotableEvents(result.events);
      if (beforeCount !== result.events.length) {
        console.log(`[match-worker] Significance filter: ${beforeCount} → ${result.events.length} events`);
      }
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

    // ── Persist spatial position frames ───────────────────────────────────
    // Only populated when USE_SPATIAL_ENGINE=true.  The frames are written
    // in the same batch-insert style as events (500 rows/call) and stored in
    // `match_positions` keyed by (match_id, minute, second).
    //
    // Frame → row mapping:
    //   minute  = floor(tSec / 60) + 1, clamped to [1, 120] (extra time)
    //   second  = floor(tSec % 60)          — second within the minute
    //   snapshots.players[].hasBall is derived here (not in PositionFrame)
    //   by comparing each player id against frame.ball.ownerId.
    //
    // Failure is non-fatal: the match is already committed as completed and
    // position data is cosmetic (viewer only).  A missing frame just means
    // the viewer interpolates across a wider gap.
    if (positionFrames.length > 0) {
      const posRows = positionFrames.map((frame) => {
        const minute = Math.min(120, Math.max(1, Math.floor(frame.tSec / 60) + 1));
        const second = Math.floor(frame.tSec % 60);
        return {
          match_id:  match.id,
          minute,
          second,
          snapshots: {
            players: frame.players.map((p) => ({
              id:      p.id,
              x:       p.x,
              y:       p.y,
              hasBall: frame.ball.ownerId === p.id,
            })),
            ball: frame.ball,
          },
        };
      });

      for (let i = 0; i < posRows.length; i += EVENT_INSERT_BATCH_SIZE) {
        const chunk = posRows.slice(i, i + EVENT_INSERT_BATCH_SIZE);
        const { error: posErr } = await supabase.from('match_positions').insert(chunk);
        if (posErr) {
          // Non-fatal: log and continue — position data is cosmetic.
          console.warn(`[match-worker] match_positions insert failed: ${posErr.message}`);
          break;
        }
      }
      console.log(`[match-worker] Persisted ${posRows.length} position frames`);
    }

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

    // ── Persist participation rows (isl-pfm) ───────────────────────────────
    // match_lineups carries one row per starter regardless of whether
    // they accrued a stat — gives the player_detail page true match
    // history (a defender with 30 clean sheets shows 30 lineups).
    // Worker writes both sides' starters at the same point in the
    // pipeline; match_player_stats stays contribution-only.
    //
    // ON CONFLICT DO NOTHING via the (match_id, player_id) PK so a
    // worker retry (rare but possible) doesn't double-insert.
    const lineupRows = [...(homeData.players ?? []), ...(awayData.players ?? [])]
      .filter((p): p is typeof p & { id: string; team_id: string } =>
        Boolean(p?.id && p?.team_id && p?.starter),
      )
      .map((p) => ({
        match_id:       match.id,
        player_id:      p.id,
        team_id:        p.team_id,
        position:       (p.position as string | null) ?? 'MF',
        jersey_number:  (p.jersey_number as number | null) ?? null,
        starter:        true,
        minutes_played: 90,
      }));
    if (lineupRows.length > 0) {
      const { error: lineupErr } = await supabase
        .from('match_lineups')
        .upsert(lineupRows, { onConflict: 'match_id,player_id', ignoreDuplicates: true });
      if (lineupErr) {
        // Best-effort: log + continue.  The match is still successfully
        // simulated even when the participation rows fail to land — the
        // historical backfill in migration 0047 covers existing matches
        // and a future re-run of this insert will re-fill missing rows.
        console.warn(`[match-worker] match_lineups insert failed: ${lineupErr.message}`);
      } else {
        console.log(`[match-worker] Persisted ${lineupRows.length} lineup rows`);
      }
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

    // Advance the cup bracket if this match belonged to one.  A no-op for
    // league matches (their competition has no bracket).  Draws are logged
    // but skipped — extra-time / penalty resolution is not yet simulated,
    // so a drawn cup match leaves the bracket frozen until a future slice
    // resolves the tie.
    await maybeAdvanceCupBracket(
      supabase,
      match.id,
      match.competition_id ?? null,
      match.home_team_id,
      match.away_team_id,
      result.finalScore[0],
      result.finalScore[1],
    );

    try {
      const seasonTx = await maybeTransitionSeasonForMatch(supabase, match.id);
      if (seasonTx.transitioned) {
        console.log(`[match-worker] Season opened for voting after match ${match.id}`);
      }
    } catch (err) {
      console.warn(`[match-worker] maybeTransitionSeasonForMatch threw for ${match.id}:`, (err as Error)?.message ?? err);
    }

    // ── Server-side memory writes ───────────────────────────────────────────
    // The browser-side MemoryWriteListener writes entity_memories rows for
    // every involved actor (referee + both managers) on `match.completed`,
    // but only when a user is online to receive the bus event.  This is the
    // server-side mirror — guarantees the corpus-enricher always has fresh
    // memories to consume, regardless of who's watching.  Dual writes
    // collapse to one row via the dedup unique index on
    // (entity_id, fact_kind, occurred_at, md5(payload)) in migration 0035.
    try {
      const memSummary = await writeMatchCompletionMemories(
        supabase,
        match.id,
        match.home_team_id,
        match.away_team_id,
        result.finalScore[0],
        result.finalScore[1],
        match.competition_id ?? '',
      );
      if (memSummary.inserted > 0) {
        console.log(`[match-worker] Wrote ${memSummary.inserted}/${memSummary.attempted} match_result memories for match ${match.id}`);
      }
    } catch (err) {
      console.warn(`[match-worker] writeMatchCompletionMemories threw for ${match.id}:`, (err as Error)?.message ?? err);
    }

    // ── Post-match Architect lore save ─────────────────────────────────────
    // Closes the architect_lore persistence loop: one Claude call to mint a
    // verdict + lore mutations (player arcs, manager fates, rivalry thread,
    // player relationships) which then feed every FUTURE match's
    // simulation via the synchronous getRelationshipFor / getFeaturedMortals
    // / getActiveRelationships reads gameEngine.js makes.
    //
    // Failures are non-blocking — the match is already recorded as completed
    // and a missed save just means the next match runs with the same lore
    // it would have had anyway.  We MUST await loreStore.flush() before
    // returning so the Deno isolate doesn't get reclaimed mid-upsert and
    // silently drop the mutations.
    try {
      await postMatchLoreSave(architect, loreStore, match, result, homeData, awayData);
    } catch (err) {
      console.warn(`[match-worker] postMatchLoreSave threw for ${match.id}:`, (err as Error)?.message ?? err);
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
    // Spatial position frames are cosmetic but must be cleaned up too so a
    // retry doesn't hit the (match_id, minute, second) primary-key conflict.
    await supabase.from('match_positions').delete().eq('match_id', match.id);

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

// ── Shared-secret auth (matches match-notify-worker, see migration 0052) ──
// Without this gate, anyone on the internet could POST and burn Anthropic
// tokens on every match-worker tick. The cron job (updated in 0052) sends
// `Authorization: Bearer <vault.worker_shared_secret>`; we compare in
// constant time. Fails closed when the env var is unset.

/** Hex-encoded shared secret; the deployed secret must match the vault row. */
const WORKER_SHARED_SECRET = Deno.env.get('WORKER_SHARED_SECRET') || '';

/** Constant-time string compare to defeat timing side-channels. */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aa = enc.encode(a);
  const bb = enc.encode(b);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i += 1) diff |= aa[i]! ^ bb[i]!;
  return diff === 0;
}

/** Reject if no env secret OR header missing OR token mismatched. */
function isAuthorized(req: Request): boolean {
  if (!WORKER_SHARED_SECRET) {
    console.warn('[match-worker] WORKER_SHARED_SECRET unset — rejecting all calls');
    return false;
  }
  const header = req.headers.get('Authorization') ?? '';
  if (!header.startsWith('Bearer ')) return false;
  return timingSafeEqual(header.slice('Bearer '.length).trim(), WORKER_SHARED_SECRET);
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
  if (!isAuthorized(req)) {
    return new Response('Unauthorized', { status: 401 });
  }
  try {
    console.log('[match-worker] Cron invocation');

    // ── Pre-claim: ensure odds exist for upcoming matches ──────────────────
    // Runs at the top of every cron tick (cheap when there's nothing new
    // to price — a few SELECTs against match_odds and out).  Without odds
    // the WagerWidget cannot render a bet form and placeWager has no
    // snapshot to lock in.  Failures are non-blocking: we still process
    // due matches even if pricing the horizon failed entirely.
    try {
      const oddsSummary = await ensureOddsForUpcoming(supabase);
      if (oddsSummary.priced > 0) {
        console.log(`[match-worker] Priced ${oddsSummary.priced} new matches (${oddsSummary.skipped} already had odds, ${oddsSummary.considered} considered)`);
      }
    } catch (err) {
      console.warn('[match-worker] ensureOddsForUpcoming threw:', (err as Error)?.message ?? err);
    }

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
