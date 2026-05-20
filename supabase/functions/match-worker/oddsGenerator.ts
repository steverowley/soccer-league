// ── match-worker/oddsGenerator.ts ────────────────────────────────────────────
// Server-side odds computation called at the top of every cron tick.  Ensures
// every upcoming match has a fresh `match_odds` row well before kickoff so
// the WagerWidget UI can render a bet form and `wagers.odds_snapshot` carries
// a real number at placement time.  Without this, `match_odds` stays empty
// and betting is structurally impossible — `placeWager` requires an odds
// snapshot per row.
//
// DUPLICATED LOGIC NOTE
// ─────────────────────
// The math here is intentionally identical to
// src/features/betting/logic/odds.ts (HOME_ADVANTAGE / LOGISTIC_SCALE /
// BASE_DRAW_PROB / DRAW_DECAY / MIN_DRAW_PROB / FORM_RATING_SHIFT /
// HOUSE_MARGIN / FORM_WINDOW).  Deno cannot resolve the src tree's path
// aliases, and the betting/api/oddsRepo + scripts/compute-odds.ts pipeline
// uses the typed Database client.  The second consumer (this worker) ports
// the pure math + a thin loop per CLAUDE.md principle 9.  If a third
// consumer arrives, extract the constants and core fns into a shared
// cross-runtime package consumable by both.
//
// HORIZON RATIONALE
// ─────────────────
// The current schedule is one matchday per UTC day.  Pricing 72 hours ahead
// means a user looking at the upcoming-matches view always sees odds on at
// least the next 3 matchdays.  Pricing the entire season at once would be
// wasteful — odds drift after every result, so the 30-minute-effective
// re-pricing (one match-worker invocation per minute, repricing horizon
// matches that have stale or missing rows) keeps everything fresh without
// blowing the bookie's prompt-context budget.

// deno-lint-ignore-file no-explicit-any

// ── Tuning constants (must match src/features/betting/logic/odds.ts) ─────

/** Home advantage in equivalent rating points (1–99 scale).  4 ≈ small but
 *  meaningful tilt that prevents away wins from being rare without making
 *  home wins trivial. */
const HOME_ADVANTAGE = 4;

/** Logistic sigmoid scale.  At 30, a 10-point rating gap produces ~60/40
 *  odds; at 20 points, ~73/27.  Higher = flatter (less extreme odds). */
const LOGISTIC_SCALE = 30;

/** Peak draw probability (teams perfectly matched).  Matches the real-world
 *  ~25% draw rate observed across top-flight football leagues. */
const BASE_DRAW_PROB = 0.25;

/** Gaussian decay rate for draw probability.  At 0.003, a 10-point gap
 *  reduces the draw chance by ~26%, a 20-point gap by ~70%. */
const DRAW_DECAY = 0.003;

/** Minimum draw probability floor.  Even wildly mismatched teams can draw —
 *  5% matches the lowest observed real-world frequencies. */
const MIN_DRAW_PROB = 0.05;

/** Form modifier per net result (wins − losses) applied to effective rating.
 *  At 1.5 a 5-win streak adds +7.5 rating ≈ half a tier. */
const FORM_RATING_SHIFT = 1.5;

/** House margin (overround).  0.05 = 5% — typical real-bookmaker football
 *  margin.  Sum of implied probabilities lands at 1.05 instead of 1.00 so
 *  the bookie wins ~5% on average regardless of outcome. */
const HOUSE_MARGIN = 0.05;

/** Recent matches included in form calculation.  5 is the football-analytics
 *  standard — enough to detect trends, short enough to react to streaks. */
const FORM_WINDOW = 5;

/** How far ahead to price.  See HORIZON RATIONALE above. */
const ODDS_HORIZON_HOURS = 72;

/** Stats averaged into a team's effective rating.  Mirrors the engine's
 *  contest-resolution surface so the odds reflect the same numbers that
 *  drive simulation. */
const STAT_FIELDS = ['attacking', 'defending', 'mental', 'athletic', 'technical'] as const;

// ── Types ────────────────────────────────────────────────────────────────

interface FormRecord { wins: number; draws: number; losses: number }
interface TeamOddsInput { avgRating: number; form: FormRecord }
interface ComputedOdds { homeOdds: number; drawOdds: number; awayOdds: number }

// ── Pure math (mirror of src/features/betting/logic/odds.ts) ──────────────

/** Round decimal odds to 2 places.  `Math.round(x*100)/100` avoids the
 *  floating-point artefacts that creep in with `toFixed` round-trips. */
function roundOdds(odds: number): number {
  return Math.round(odds * 100) / 100;
}

/**
 * Form-adjusted effective rating: raw average plus FORM_RATING_SHIFT per
 * net (wins − losses).  Draws contribute nothing, matching the engine's
 * "draws are stalemates" semantic.
 */
function effectiveRating(input: TeamOddsInput): number {
  const netResult = input.form.wins - input.form.losses;
  return input.avgRating + netResult * FORM_RATING_SHIFT;
}

/**
 * True three-way match probabilities summing to 1.0.  Home/away derived
 * from logistic sigmoid over rating diff (with HOME_ADVANTAGE bias); draw
 * derived from Gaussian decay over the same diff.
 */
function computeProbabilities(home: TeamOddsInput, away: TeamOddsInput) {
  const diff = effectiveRating(home) - effectiveRating(away);
  const rawHomeProb = 1 / (1 + Math.exp(-(diff + HOME_ADVANTAGE) / LOGISTIC_SCALE));
  const drawProb = Math.max(
    MIN_DRAW_PROB,
    BASE_DRAW_PROB * Math.exp(-DRAW_DECAY * diff * diff),
  );
  const remaining = 1 - drawProb;
  return {
    home: remaining * rawHomeProb,
    draw: drawProb,
    away: remaining * (1 - rawHomeProb),
  };
}

/**
 * Convert true probabilities to decimal odds with HOUSE_MARGIN baked in.
 * Decimal odds = total return per unit staked (a 2.50 bet returning 250 on
 * a 100 stake = 150 profit + 100 stake).
 */
function probsToOdds(probs: { home: number; draw: number; away: number }): ComputedOdds {
  const overround = 1 + HOUSE_MARGIN;
  return {
    homeOdds: roundOdds(1 / (probs.home * overround)),
    drawOdds: roundOdds(1 / (probs.draw * overround)),
    awayOdds: roundOdds(1 / (probs.away * overround)),
  };
}

/** Full pipeline: probabilities → odds.  Stateless. */
function computeMatchOdds(home: TeamOddsInput, away: TeamOddsInput): ComputedOdds {
  return probsToOdds(computeProbabilities(home, away));
}

// ── Roster + form helpers ────────────────────────────────────────────────

/**
 * Average each player's five stat fields, default 70 for missing values
 * (mirrors normalizeTeamForEngine's STAT_FALLBACK so an unseeded team gets
 * a neutral rating rather than NaN).  Filters to starters because reserves
 * aren't on the pitch at kickoff.
 */
function computeAvgRating(players: Array<Record<string, any>>): number {
  const starters = players.filter((p) => p?.starter !== false);
  if (starters.length === 0) return 70;
  let total = 0;
  let count = 0;
  for (const p of starters) {
    for (const field of STAT_FIELDS) {
      total += typeof p?.[field] === 'number' ? p[field] : 70;
      count += 1;
    }
  }
  return count === 0 ? 70 : total / count;
}

/**
 * Compute W/D/L record for `teamId` across the supplied completed-match
 * rows.  The caller is responsible for fetching `FORM_WINDOW` most-recent
 * matches; this function just tallies them.
 */
function computeForm(
  teamId: string,
  matches: Array<{ home_team_id: string; away_team_id: string; home_score: number; away_score: number }>,
): FormRecord {
  let wins = 0;
  let draws = 0;
  let losses = 0;
  for (const m of matches) {
    const isHome = m.home_team_id === teamId;
    const isAway = m.away_team_id === teamId;
    if (!isHome && !isAway) continue;
    if (m.home_score === m.away_score) { draws += 1; continue; }
    const homeWon = m.home_score > m.away_score;
    if ((isHome && homeWon) || (isAway && !homeWon)) wins += 1;
    else losses += 1;
  }
  return { wins, draws, losses };
}

// ── Orchestration ────────────────────────────────────────────────────────

export interface OddsGenerationSummary {
  considered: number;
  priced: number;
  skipped: number;
}

/**
 * Ensure every scheduled match in the next ODDS_HORIZON_HOURS has a fresh
 * `match_odds` row.  Idempotent — re-running against an already-priced
 * match overwrites with fresh numbers (so a fan-boost or form swing between
 * cron ticks is reflected before kickoff).
 *
 * This function is intentionally tolerant: if any single match's roster
 * fetch fails, the loop logs and continues to the next match.  Bulk
 * pricing must never block the worker's main job (claim + simulate due
 * matches).
 *
 * @param supabase  Service-role client.
 * @returns         Counts for log diagnostics.
 */
export async function ensureOddsForUpcoming(supabase: any): Promise<OddsGenerationSummary> {
  const nowISO = new Date().toISOString();
  const horizonISO = new Date(Date.now() + ODDS_HORIZON_HOURS * 3_600_000).toISOString();

  // Pull every scheduled match strictly inside the [now, now+horizon] window.
  // We don't pre-filter to "missing odds" because PostgREST left-joins are
  // awkward; instead we check existence per-match (a tiny SELECT each) which
  // keeps the SQL straightforward and is still fast at 16 matches/day × 3
  // days = ~48 rows.
  //
  // The `.gte(scheduled_at, nowISO)` lower bound is essential: without it,
  // any stale `status='scheduled'` rows from the past (delayed/backlogged
  // fixtures, post-reset backlog) would be iterated on every cron tick, each
  // one running a per-match SELECT against match_odds before claimDueMatches
  // even gets to fire.  Overdue matches don't need fresh odds either — the
  // betting UI closes the market at kickoff, so pricing them is wasted work.
  const { data: upcoming, error: upcomingErr } = await supabase
    .from('matches')
    .select('id, home_team_id, away_team_id, scheduled_at, competition_id')
    .eq('status', 'scheduled')
    .gte('scheduled_at', nowISO)
    .lte('scheduled_at', horizonISO)
    .order('scheduled_at', { ascending: true });

  if (upcomingErr) {
    console.warn(`[ensureOddsForUpcoming] fetch upcoming failed: ${upcomingErr.message}`);
    return { considered: 0, priced: 0, skipped: 0 };
  }
  if (!upcoming || upcoming.length === 0) return { considered: 0, priced: 0, skipped: 0 };

  let priced = 0;
  let skipped = 0;

  for (const match of upcoming) {
    try {
      // Skip matches that already have an odds row.  Re-pricing on every
      // cron tick would overwhelm the DB with no real benefit — once is
      // plenty.  A future "refresh" path can DELETE+recompute on roster
      // changes.
      const { data: existing } = await supabase
        .from('match_odds')
        .select('match_id')
        .eq('match_id', match.id)
        .maybeSingle();
      if (existing) { skipped += 1; continue; }

      // Fetch both rosters in parallel — minimal columns for the rating
      // average + starter filter.
      const [homeRes, awayRes] = await Promise.all([
        supabase
          .from('players')
          .select('starter, attacking, defending, mental, athletic, technical')
          .eq('team_id', match.home_team_id)
          .eq('is_active', true),
        supabase
          .from('players')
          .select('starter, attacking, defending, mental, athletic, technical')
          .eq('team_id', match.away_team_id)
          .eq('is_active', true),
      ]);
      if (homeRes.error || awayRes.error) {
        console.warn(`[ensureOddsForUpcoming] roster fetch failed for ${match.id}`);
        skipped += 1;
        continue;
      }
      const homeAvg = computeAvgRating(homeRes.data ?? []);
      const awayAvg = computeAvgRating(awayRes.data ?? []);

      // Last FORM_WINDOW completed matches per team across all
      // competitions.  Querying both teams in a single UNION-shaped call
      // would save a round-trip but PostgREST doesn't expose UNION; two
      // ordered selects is fine at this volume.
      const [homeFormRes, awayFormRes] = await Promise.all([
        supabase
          .from('matches')
          .select('home_team_id, away_team_id, home_score, away_score, scheduled_at')
          .eq('status', 'completed')
          .or(`home_team_id.eq.${match.home_team_id},away_team_id.eq.${match.home_team_id}`)
          .order('scheduled_at', { ascending: false })
          .limit(FORM_WINDOW),
        supabase
          .from('matches')
          .select('home_team_id, away_team_id, home_score, away_score, scheduled_at')
          .eq('status', 'completed')
          .or(`home_team_id.eq.${match.away_team_id},away_team_id.eq.${match.away_team_id}`)
          .order('scheduled_at', { ascending: false })
          .limit(FORM_WINDOW),
      ]);
      const homeForm = computeForm(match.home_team_id, homeFormRes.data ?? []);
      const awayForm = computeForm(match.away_team_id, awayFormRes.data ?? []);

      const odds = computeMatchOdds(
        { avgRating: homeAvg, form: homeForm },
        { avgRating: awayAvg, form: awayForm },
      );

      const { error: upsertErr } = await supabase
        .from('match_odds')
        .upsert(
          {
            match_id: match.id,
            home_odds: odds.homeOdds,
            draw_odds: odds.drawOdds,
            away_odds: odds.awayOdds,
            computed_at: new Date().toISOString(),
          },
          { onConflict: 'match_id' },
        );

      if (upsertErr) {
        console.warn(`[ensureOddsForUpcoming] upsert failed for ${match.id}: ${upsertErr.message}`);
        skipped += 1;
        continue;
      }
      priced += 1;
    } catch (e) {
      console.warn(`[ensureOddsForUpcoming] threw for ${match.id}:`, e);
      skipped += 1;
    }
  }

  return { considered: upcoming.length, priced, skipped };
}
