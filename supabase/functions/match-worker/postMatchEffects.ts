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
  const { data: updated, error } = await db
    .from('seasons')
    .update({ status: 'voting', ended_at: new Date().toISOString() })
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

  return {
    transitioned: wonRace,
    reason: wonRace ? 'season_opened_for_voting' : 'season_already_transitioned',
  };
}
