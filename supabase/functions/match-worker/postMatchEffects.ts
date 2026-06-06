// ── match-worker/postMatchEffects.ts ─────────────────────────────────────────
// Server-side post-match orchestration that used to be wired through the
// browser-side event bus (`match.completed`).  That bus is an in-memory
// singleton on the client; the production worker runs in Deno on Supabase's
// edge runtime, so the bus is unreachable and every listener went silent.
// Phase 2 moves the side-effects directly into the worker, called from
// processMatch in service-role context.
//
// FUNCTIONS HERE ARE DELIBERATELY DUPLICATED from the corresponding
// src/features/*/api/*.ts implementations because:
//   1. Deno cannot resolve the project's TypeScript path aliases
//      (`@shared/*`, `@features/*`).
//   2. The src/* versions import generated `database.ts` types and Zod
//      schemas that would bloat the worker bundle for marginal type-safety
//      benefit (the worker already trusts the DB schema explicitly).
//   3. CLAUDE.md principle 9: don't extract a helper for the second consumer
//      until a third appears.  This is the second consumer.
//
// If a third consumer arrives, extract the pure logic (determineOutcome,
// resolveWager) into a shared package consumable by both runtimes.
//
// DEPENDENCY INJECTION
// ────────────────────
// Every function takes the Supabase client as its first parameter (per
// CLAUDE.md principle 6) so they're trivially testable with mocks and so
// the worker can pass its service-role client without leaking the key.

// We type the client loosely (`any`) because the worker has no access to the
// generated Database types — see the WHY above.  Strict typing belongs to the
// browser-side callers.
// deno-lint-ignore-file no-explicit-any

import { ensureFocusOptionsForSeason } from './focusOptionsGenerator.ts';
import { seedCupCompetitions, advanceCupRound } from './cupSeeder.ts';

// ── Tuning constants (KEEP IN SYNC with src/features/agents/logic/memoryWriter.ts) ──
// Two separate runtimes, one canonical scale.  When either constant moves
// in src/, update it here too — the dedup index on (entity_id, fact_kind,
// occurred_at, md5(payload)) only merges rows with identical payloads, so
// salience drift would split the dual writes into two rows.

/**
 * Default salience for `match_result` memories.
 *
 * MECHANICAL EFFECT: 4 of 10.  Routine results are ambient texture in the
 * 448-match season; the corpus-enricher's "top-N high-salience memories"
 * prompt slice prefers career beats over weekly fixtures.  Trouncings
 * escalate to 6 via LOPSIDED_SCORE_DELTA.
 */
const MATCH_RESULT_SALIENCE = 4;

/**
 * Score delta (in goals) above which a match memory escalates to salience 6.
 *
 * MECHANICAL EFFECT: 3 goals.  A 3-0 or 4-1 result is a story; a 1-0 is
 * Tuesday.  Drives the same threshold as src/features/agents — see the
 * MATCH_RESULT_SALIENCE / LOPSIDED_SCORE_DELTA pair in memoryWriter.ts.
 */
const LOPSIDED_SCORE_DELTA = 3;

// ── Pure logic: wager outcome resolution ─────────────────────────────────

export type MatchOutcome = 'home' | 'away' | 'draw';

/**
 * Map a final score to the three-way outcome used by the wager-resolution
 * predicate.  Equal scores are 'draw' — a deliberate three-way market.
 */
export function determineOutcome(homeScore: number, awayScore: number): MatchOutcome {
  if (homeScore > awayScore) return 'home';
  if (awayScore > homeScore) return 'away';
  return 'draw';
}

export interface ResolvedWager {
  status: 'won' | 'lost';
  /** Whole-credit payout; 0 on a loss.  Floor()'d because credits are integers. */
  payout: number;
}

/**
 * Resolve a single wager given the match outcome.  Pure — no I/O.
 *
 * `oddsSnapshot` is the decimal multiplier the user accepted at placement
 * time on their chosen side (DB column `wagers.odds_snapshot`, single
 * numeric > 1).  Payout on a win is `floor(stake * odds)`; stake is the
 * user's original wager amount.  Their stake was already deducted at
 * placement, so the payout represents the FULL return (stake + profit) on
 * a win and zero on a loss — we credit the profile by `payout` directly.
 */
export function resolveWager(
  teamChoice: MatchOutcome,
  outcome: MatchOutcome,
  stake: number,
  oddsSnapshot: number,
): ResolvedWager {
  if (teamChoice === outcome) {
    return { status: 'won', payout: Math.floor(stake * oddsSnapshot) };
  }
  return { status: 'lost', payout: 0 };
}

// ── Side-effect: settle every open wager on a completed match ────────────

export interface SettlementSummary {
  settled: number;
  totalPayout: number;
}

/**
 * Resolve every `status='open'` wager on this match, mark it won/lost, and
 * credit winning users' profiles in a read-modify-write loop.  Returns a
 * count so the worker can log it.  No-op (returns {0,0}) when there are no
 * open wagers — the common case during early-season cron ticks.
 *
 * @param db          Supabase service-role client.
 * @param matchId     Match UUID whose wagers should be settled.
 * @param homeScore   Final home goals.
 * @param awayScore   Final away goals.
 */
export async function settleMatchWagers(
  db: any,
  matchId: string,
  homeScore: number,
  awayScore: number,
): Promise<SettlementSummary> {
  const outcome = determineOutcome(homeScore, awayScore);

  const { data: openWagers, error: fetchErr } = await db
    .from('wagers')
    .select('id, user_id, team_choice, stake, odds_snapshot')
    .eq('match_id', matchId)
    .eq('status', 'open');

  if (fetchErr) {
    console.warn(`[settleMatchWagers] fetch failed: ${fetchErr.message}`);
    return { settled: 0, totalPayout: 0 };
  }
  if (!openWagers || openWagers.length === 0) return { settled: 0, totalPayout: 0 };

  let settled = 0;
  let totalPayout = 0;

  for (const wager of openWagers) {
    const { status, payout } = resolveWager(
      wager.team_choice as MatchOutcome,
      outcome,
      Number(wager.stake),
      Number(wager.odds_snapshot),
    );

    // payout=0 is stored as null per the legacy convention (the column is
    // nullable and downstream reports use NULL to distinguish "lost" from
    // "settled-but-zero").
    const { error: updateErr } = await db
      .from('wagers')
      .update({ status, payout: payout || null })
      .eq('id', wager.id);

    if (updateErr) {
      console.warn(`[settleMatchWagers] update wager ${wager.id} failed: ${updateErr.message}`);
      continue;
    }

    if (status === 'won' && payout > 0) {
      // Credit the winner's profile balance.  Read-modify-write — safe at
      // current traffic levels because settlement is single-writer
      // (service-role worker, no concurrent settlement of the same wager).
      const { data: profile } = await db
        .from('profiles')
        .select('credits')
        .eq('id', wager.user_id)
        .single();

      if (profile) {
        await db
          .from('profiles')
          .update({ credits: (profile.credits ?? 0) + payout })
          .eq('id', wager.user_id);
      }
    }

    settled += 1;
    totalPayout += payout;
  }

  return { settled, totalPayout };
}

// ── Side-effect: transition season status when its league phase finishes ──

export interface SeasonTransitionResult {
  transitioned: boolean;
  /** Diagnostic reason so worker logs can explain why no transition fired. */
  reason: string;
}

/**
 * If this match was the last incomplete league fixture of its season, flip
 * the season status from 'active' to 'voting' atomically.  Idempotent — the
 * status='active' predicate on the UPDATE guarantees only one caller wins
 * the race when multiple workers complete the final-ever match concurrently.
 *
 * Returns a small diagnostic so callers can log progress; the worker never
 * acts on the result beyond logging.
 *
 * SCOPE RULES
 * ───────────
 * Only LEAGUE competitions count toward the transition; cup completion has
 * no effect on the season lifecycle (cup runs continue inside the voting/
 * enacted phases).  We walk the match's competition.season_id, find all
 * league competitions in that season, and count their remaining non-
 * completed matches.
 *
 * @param db       Supabase service-role client.
 * @param matchId  Match that just completed (drives the season lookup).
 */
export async function maybeTransitionSeasonForMatch(
  db: any,
  matchId: string,
): Promise<SeasonTransitionResult> {
  const { data: match } = await db
    .from('matches')
    .select('competition_id')
    .eq('id', matchId)
    .single();

  if (!match?.competition_id) {
    return { transitioned: false, reason: 'match_has_no_competition' };
  }

  const { data: competition } = await db
    .from('competitions')
    .select('id, type, season_id')
    .eq('id', match.competition_id)
    .single();

  if (!competition?.season_id) {
    return { transitioned: false, reason: 'competition_has_no_season' };
  }
  if (competition.type !== 'league') {
    return { transitioned: false, reason: 'completed_match_was_not_league' };
  }

  const { data: leagueComps } = await db
    .from('competitions')
    .select('id')
    .eq('season_id', competition.season_id)
    .eq('type', 'league');

  if (!leagueComps || leagueComps.length === 0) {
    return { transitioned: false, reason: 'no_league_competitions_for_season' };
  }

  const compIds = leagueComps.map((c: { id: string }) => c.id);
  const { count: remaining } = await db
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .in('competition_id', compIds)
    .neq('status', 'completed');

  if ((remaining ?? 0) > 0) {
    return { transitioned: false, reason: `${remaining}_remaining_league_matches` };
  }

  // Atomic CAS: only flip if still 'active'.
  // Stamp election_opens_at alongside ended_at so the server-side enactment
  // scheduler (#529, scripts/enact-due-seasons.ts) has a reliable voting-window
  // anchor — the admin path stamps it via admin_set_season_status, but this
  // worker transition is the production path and previously left it null.
  const openedAt = new Date().toISOString();
  const { data: updated, error } = await db
    .from('seasons')
    .update({ status: 'voting', ended_at: openedAt, election_opens_at: openedAt })
    .eq('id', competition.season_id)
    .eq('status', 'active')
    .select('id');

  if (error) {
    console.warn(`[maybeTransitionSeasonForMatch] update failed: ${error.message}`);
    return { transitioned: false, reason: 'update_error' };
  }

  const wonRace = Array.isArray(updated) && updated.length > 0;

  // ── Auto-generate focus_options for the new voting phase ───────────────
  // The `/voting` UI lists rows from focus_options for the active season;
  // if we transition without seeding them the page renders empty until a
  // human runs the rollover script.  Generating them here means voting is
  // live the instant the last league match completes.
  //
  // Run on BOTH the won-race and lost-race branches: only one worker wins
  // the CAS that flips status to 'voting', so if that single seed attempt
  // hits a transient DB error every other worker would skip and the
  // season would stay in 'voting' with empty options until a human noticed.
  // The upsert is idempotent on (team_id, season_id, option_key), so
  // re-running from the lost-race branch is harmless when the winner
  // already seeded and is automatic-recovery when it didn't.
  try {
    const focusSummary = await ensureFocusOptionsForSeason(db, competition.season_id);
    if (focusSummary.rowsUpserted > 0) {
      console.log(`[maybeTransitionSeasonForMatch] Generated focus_options: ${focusSummary.rowsUpserted} rows across ${focusSummary.teams} teams`);
    }
  } catch (e) {
    console.warn('[maybeTransitionSeasonForMatch] focus-options generation failed:', e);
  }

  // ── Auto-seed cup brackets for the new voting phase ────────────────────
  // The Celestial Cup (top 3 per league) and Solar Shield (4th–6th) draw
  // off the final league standings.  Standings are stable now that every
  // league fixture is `completed`, so this is the canonical moment to
  // compute qualifiers + draw the bracket.  Same lost-race recovery story
  // as the focus-options call above: seedCupCompetitions is idempotent
  // (the readBracket early-return short-circuits when a bracket already
  // exists), so it's safe to fire from any worker that reaches this point.
  try {
    const cupSummary = await seedCupCompetitions(db, competition.season_id);
    const c = cupSummary.celestial;
    const s = cupSummary.solarShield;
    if (c.status === 'seeded' || s.status === 'seeded') {
      console.log(`[maybeTransitionSeasonForMatch] Seeded cups: Celestial ${c.status} (${c.qualifiers} teams, ${c.round1Matches} R1 matches); Shield ${s.status} (${s.qualifiers} teams, ${s.round1Matches} R1 matches)`);
    }
  } catch (e) {
    console.warn('[maybeTransitionSeasonForMatch] cup seeding failed:', e);
  }

  return {
    transitioned: wonRace,
    reason: wonRace ? 'season_opened_for_voting' : 'season_already_transitioned',
  };
}

// ── Side-effect: write entity_memories rows for the completed match ─────
// Mirrors the browser-side MemoryWriteListener (src/features/agents/ui/
// MemoryWriteListener.tsx) so the corpus-enricher receives memories even
// when no user happens to be online at match-completion time.
//
// DUPLICATION RATIONALE
//   The browser listener imports from src/features/agents/logic/memoryWriter.ts
//   (pure builder) + src/features/agents/api/memories.ts (insertMemory).
//   Edge functions can't reach either path — see the WHY block at the top
//   of this file.  We duplicate `buildMatchCompletionMemories` as a pure
//   helper here so the two runtimes produce IDENTICAL rows that the dedup
//   unique index on (entity_id, fact_kind, occurred_at, md5(payload))
//   silently merges into a single record.  Keep this in sync with the
//   source-of-truth implementation in src/features/agents/logic/memoryWriter.ts.
//
// FACT KINDS WRITTEN
//   - 'match_result' for the referee (when assigned) and both managers.
//     One row each, identical JSONB payload skeleton, differentiated by
//     `perspective: 'home' | 'away'` on the manager rows.

/** Subset of an `entity_memories` row this duplicated builder produces. */
interface MatchMemoryInsert {
  entity_id: string;
  fact_kind: string;
  payload: Record<string, unknown>;
  salience: number;
  subjects: string[];
  occurred_at: string;
}

/** Inputs the duplicated builder needs.  Mirrors `MatchCompletedPayload`. */
interface MatchMemoryEventInput {
  matchId: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  competitionId: string;
}

/** DB-resolved entity IDs the builder ties memories to. */
interface MatchMemoryContext {
  refereeId: string | null;
  homeManagerId: string | null;
  awayManagerId: string | null;
  occurredAt: string;
}

/**
 * Pure mapping from a completed-match event + resolved involved-entities
 * context to the memory rows that need writing.  Mirrors
 * `buildMatchCompletionMemories` in src/features/agents/logic/memoryWriter.ts
 * — identical inputs MUST yield identical outputs so the dedup index can
 * collapse the dual-write to one row.
 *
 * @param event  Match-completion event data.
 * @param ctx    Resolved entity IDs + the canonical occurred_at timestamp.
 * @returns      Memory rows for whichever entity IDs are non-null.  Empty
 *               when no involved entities were resolved.
 */
function buildMatchCompletionMemories(
  event: MatchMemoryEventInput,
  ctx: MatchMemoryContext,
): MatchMemoryInsert[] {
  // Salience escalates for lopsided results — see LOPSIDED_SCORE_DELTA
  // for the rationale.
  const scoreDelta = Math.abs(event.homeScore - event.awayScore);
  const salience = scoreDelta >= LOPSIDED_SCORE_DELTA ? 6 : MATCH_RESULT_SALIENCE;

  // Common JSONB body — every involved entity records the same factual
  // skeleton so the enricher can quote "your 3-0 win at Mars Athletic"
  // without joining out to matches.
  const commonPayload: Record<string, unknown> = {
    matchId: event.matchId,
    homeTeamId: event.homeTeamId,
    awayTeamId: event.awayTeamId,
    homeScore: event.homeScore,
    awayScore: event.awayScore,
    competitionId: event.competitionId,
  };

  const memories: MatchMemoryInsert[] = [];

  // The referee remembers the match.  `subjects` stays empty because team
  // slugs aren't UUIDs and the column expects entity_id UUIDs only.
  if (ctx.refereeId) {
    memories.push({
      entity_id: ctx.refereeId,
      fact_kind: 'match_result',
      payload: commonPayload,
      salience,
      subjects: [],
      occurred_at: ctx.occurredAt,
    });
  }

  // Each manager remembers the match from their perspective — `perspective`
  // tags the JSONB body so the enricher can frame win/loss/draw correctly.
  if (ctx.homeManagerId) {
    memories.push({
      entity_id: ctx.homeManagerId,
      fact_kind: 'match_result',
      payload: { ...commonPayload, perspective: 'home' },
      salience,
      subjects: [],
      occurred_at: ctx.occurredAt,
    });
  }

  if (ctx.awayManagerId) {
    memories.push({
      entity_id: ctx.awayManagerId,
      fact_kind: 'match_result',
      payload: { ...commonPayload, perspective: 'away' },
      salience,
      subjects: [],
      occurred_at: ctx.occurredAt,
    });
  }

  return memories;
}

/** Diagnostic returned by {@link writeMatchCompletionMemories}. */
export interface MemoryWriteSummary {
  /** Number of `entity_memories` rows attempted (referee + managers actually resolved). */
  attempted: number;
  /** Number of inserts the DB accepted (the rest were either errors or no-op duplicates). */
  inserted: number;
}

/**
 * Resolve the involved entities for a just-completed match (referee + both
 * managers), build the matching `match_result` memory rows, and bulk-insert.
 *
 * Safe to call multiple times for the same match — the dedup unique index
 * on (entity_id, fact_kind, occurred_at, md5(payload)) makes repeat inserts
 * a no-op.
 *
 * Best-effort throughout: missing lookups are silently skipped (no
 * involved entity → no orphan memory) and insertion failures are
 * warn-logged without throwing.  The caller does not act on the result
 * beyond logging.
 *
 * @param db              Supabase service-role client.
 * @param matchId         UUID of the completed match (drives the referee lookup).
 * @param homeTeamId      Home team slug.
 * @param awayTeamId      Away team slug.
 * @param homeScore       Final home goals.
 * @param awayScore       Final away goals.
 * @param competitionId   UUID of the match's competition (carried in payload only).
 * @returns               Summary with attempted + inserted counts.
 */
export async function writeMatchCompletionMemories(
  db: any,
  matchId: string,
  homeTeamId: string,
  awayTeamId: string,
  homeScore: number,
  awayScore: number,
  competitionId: string,
): Promise<MemoryWriteSummary> {
  // STEP 1: referee_id + canonical timestamp from the match row.
  // `played_at` is the schema's "match finished" timestamp; fallback to
  // wall clock when null keeps memories aligned with reality without
  // crashing.
  const matchRow = await db
    .from('matches')
    .select('referee_id, played_at')
    .eq('id', matchId)
    .maybeSingle();

  if (matchRow.error) {
    console.warn('[writeMatchCompletionMemories] match fetch failed:', matchRow.error.message);
  }
  const refereeId: string | null = matchRow.data?.referee_id ?? null;
  const occurredAt: string =
    matchRow.data?.played_at ?? new Date().toISOString();

  // STEP 2: manager entity_ids for both teams.  One query covers both —
  // managers are 1:1 with teams.
  const managersRow = await db
    .from('managers')
    .select('team_id, entity_id')
    .in('team_id', [homeTeamId, awayTeamId]);

  if (managersRow.error) {
    console.warn('[writeMatchCompletionMemories] managers fetch failed:', managersRow.error.message);
  }
  const managerRows: Array<{ team_id: string; entity_id: string | null }> =
    managersRow.data ?? [];
  const homeManagerId: string | null =
    managerRows.find((m) => m.team_id === homeTeamId)?.entity_id ?? null;
  const awayManagerId: string | null =
    managerRows.find((m) => m.team_id === awayTeamId)?.entity_id ?? null;

  // STEP 3: build the rows.
  const memories = buildMatchCompletionMemories(
    {
      matchId,
      homeTeamId,
      awayTeamId,
      homeScore,
      awayScore,
      competitionId,
    },
    { refereeId, homeManagerId, awayManagerId, occurredAt },
  );

  if (memories.length === 0) {
    return { attempted: 0, inserted: 0 };
  }

  // STEP 4: bulk insert.  Single batched insert keeps the round-trip count
  // at 3 (match fetch + managers fetch + insert) regardless of how many
  // entities turned up.  Dedup index makes this safe to retry.
  const { error: insertErr, count } = await db
    .from('entity_memories')
    .insert(memories, { count: 'exact' });

  if (insertErr) {
    // 23505 = unique_violation — every row was a duplicate of a prior
    // browser-side write.  That's the expected happy path when a user was
    // online; log at debug-only level once we have one.
    if (insertErr.code === '23505') {
      return { attempted: memories.length, inserted: 0 };
    }
    console.warn('[writeMatchCompletionMemories] insert failed:', insertErr.message);
    return { attempted: memories.length, inserted: 0 };
  }

  return { attempted: memories.length, inserted: count ?? memories.length };
}

// ── Side-effect: advance the cup bracket after a cup match completes ─────

/**
 * After a match is marked `completed` by the worker, slot the winner into
 * the next-round cup bracket position if the match was part of a cup.
 * No-op for league matches (their competition has no bracket so
 * advanceCupRound's readBracket early-returns null).
 *
 * Draws have no winner in single-elimination knockout football; in the
 * absence of an engine extra-time / penalty-shootout path, we log a
 * warning and leave the bracket untouched so a future extra-time slice
 * can resolve the tie without losing the match data.
 *
 * @param db              Supabase service-role client.
 * @param matchId         UUID of the just-completed match.
 * @param competitionId   The match's competition (may belong to a league).
 * @param homeTeamId      Match's home team slug.
 * @param awayTeamId      Match's away team slug.
 * @param homeScore       Final home goals.
 * @param awayScore       Final away goals.
 */
export async function maybeAdvanceCupBracket(
  db: any,
  matchId: string,
  competitionId: string | null,
  homeTeamId: string,
  awayTeamId: string,
  homeScore: number,
  awayScore: number,
): Promise<void> {
  if (!competitionId) return;

  if (homeScore === awayScore) {
    console.warn(`[maybeAdvanceCupBracket] match ${matchId} ended in a draw; bracket left untouched (extra-time/penalties not yet simulated)`);
    return;
  }
  const winnerTeamId = homeScore > awayScore ? homeTeamId : awayTeamId;

  try {
    const result = await advanceCupRound(db, competitionId, matchId, winnerTeamId);
    if (result) {
      if (result.nextMatchId && !result.nextMatchAlreadyExisted) {
        console.log(`[maybeAdvanceCupBracket] R${result.completedRound} match ${matchId} → scheduled next-round match ${result.nextMatchId} (slot ${result.nextMatchSlot})`);
      } else if (result.nextMatchSlot === null) {
        console.log(`[maybeAdvanceCupBracket] Final completed for cup ${competitionId}; winner=${winnerTeamId}`);
      }
    }
  } catch (e) {
    console.warn(`[maybeAdvanceCupBracket] advance failed for match ${matchId}:`, e);
  }
}
