// ── architect/api/shadowDistribution.ts ─────────────────────────────────────
// Pre-match read of the shadow_match_results table so the Architect's
// council can deliberate against the distribution before kickoff.
//
// WHY THIS LIVES HERE
//   shadow_match_results is populated asynchronously by the
//   shadow-match-worker edge function (Phase 11 + 11.1).  By the time a
//   match's processMatch loop starts, the row set is usually already
//   complete.  prepareArchitectForMatch reads them ONCE here (single DB
//   round-trip), summarises the outcome / scoreline distribution, and
//   parks the result on CosmicArchitect so every in-match synchronous
//   getContext() call can reference it without further I/O.
//
// PURE BOUNDARY
//   This file owns the DB read; aggregation is a pure helper.  The
//   summary shape is intentionally compact — the council needs a
//   distribution, not the raw rows — so prompt budgets stay small.

import type { IslSupabaseClient } from '@shared/supabase/client';

// ── Tuning constants ───────────────────────────────────────────────────────

/**
 * Hard cap on rows loaded per match.
 *
 * MECHANICAL EFFECT: 16 is comfortably above the shadow-worker's per-match
 * cap (5) plus headroom for a future increase, but small enough that a
 * misconfigured fixture with hundreds of shadow rows doesn't blow up the
 * pre-match payload.
 */
const MAX_SHADOW_ROWS = 16;

// ── Public shape ───────────────────────────────────────────────────────────

/**
 * Summary the council reads.  Counts + averages + perturbation tags —
 * everything needed to phrase "the alternate timelines mostly see a
 * home win, with one outlier where the away side took it 3-1".
 */
export interface ShadowDistribution {
  /** Total number of shadows summarised. */
  n: number;
  /** Outcome counts.  Sums to `n`. */
  outcomes: { home: number; draw: number; away: number };
  /** Mean home goals across the shadows.  Rounded to 1 decimal. */
  avgHomeGoals: number;
  /** Mean away goals across the shadows.  Rounded to 1 decimal. */
  avgAwayGoals: number;
  /**
   * Perturbation breakdown — entries are perturbation strings ↔ row counts.
   * Lets the council distinguish a Poisson-only distribution from a
   * real-engine distribution when phrasing its deliberation.
   */
  perturbations: Record<string, number>;
}

// ── Raw row shape ──────────────────────────────────────────────────────────

interface ShadowRow {
  home_goals: number;
  away_goals: number;
  outcome: 'home' | 'draw' | 'away';
  perturbation: string;
}

// ── Aggregator (pure) ──────────────────────────────────────────────────────

/**
 * Pure aggregator — given the raw shadow rows for a match, return the
 * compact distribution summary the council reads.  Exported separately
 * from the fetcher for unit-test access.
 *
 * Edge cases:
 *   • Empty input → n=0, zeroed outcomes, zero averages, empty perturbations.
 *   • Rows with unrecognised outcome strings → counted under outcomes only
 *     if they match a known key; otherwise silently skipped from outcome
 *     totals (still counted in `n` and perturbations).
 *
 * @param rows  Raw shadow rows for one match.
 * @returns     Compact summary.
 */
export function aggregateShadowRows(rows: readonly ShadowRow[]): ShadowDistribution {
  if (rows.length === 0) {
    return {
      n: 0,
      outcomes: { home: 0, draw: 0, away: 0 },
      avgHomeGoals: 0,
      avgAwayGoals: 0,
      perturbations: {},
    };
  }

  let homeGoalSum = 0;
  let awayGoalSum = 0;
  const outcomes: ShadowDistribution['outcomes'] = { home: 0, draw: 0, away: 0 };
  const perturbations: Record<string, number> = {};

  for (const row of rows) {
    homeGoalSum += row.home_goals;
    awayGoalSum += row.away_goals;
    if (row.outcome === 'home' || row.outcome === 'draw' || row.outcome === 'away') {
      outcomes[row.outcome] += 1;
    }
    perturbations[row.perturbation] = (perturbations[row.perturbation] ?? 0) + 1;
  }

  return {
    n: rows.length,
    outcomes,
    avgHomeGoals: Math.round((homeGoalSum / rows.length) * 10) / 10,
    avgAwayGoals: Math.round((awayGoalSum / rows.length) * 10) / 10,
    perturbations,
  };
}

// ── Fetcher ────────────────────────────────────────────────────────────────

/**
 * Load + aggregate the shadow distribution for one match.
 *
 * Best-effort: returns null on DB error or when no shadows exist for the
 * match.  Callers treat null as "council has no alternate-timeline read"
 * — the architect proceeds without the shading.
 *
 * @param db        Injected Supabase client (anon or service-role; reads
 *                  are service-role-only per migration 0037 RLS, so in
 *                  practice this is called from worker context).
 * @param matchId   The match whose shadows to summarise.
 * @returns         The summary, or null when nothing is available.
 */
export async function loadShadowDistribution(
  db: IslSupabaseClient,
  matchId: string,
): Promise<ShadowDistribution | null> {
  // DETERMINISM: pair LIMIT with a stable ORDER BY.  Without the
  // `.order(...)`, Postgres returns rows in undefined heap order — two
  // calls on the same row set can yield different first-N subsets, and
  // `aggregateShadowRows` would produce different averages between them.
  // The module docstring promises "deterministic given the same row
  // set"; the docstring is only honest when the truncation is too.
  // `created_at` is monotonic (worker writes one row at a time) and
  // present on every shadow_match_results row, so it's the right anchor.
  const { data, error } = await db
    .from('shadow_match_results')
    .select('home_goals, away_goals, outcome, perturbation')
    .eq('match_id', matchId)
    .order('created_at', { ascending: true })
    .limit(MAX_SHADOW_ROWS);

  if (error) {
    console.warn('[loadShadowDistribution] fetch failed:', error.message);
    return null;
  }
  if (!data || data.length === 0) return null;

  return aggregateShadowRows(data as ShadowRow[]);
}
