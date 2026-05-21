// ── match-worker / shadowDistribution.ts ────────────────────────────────────
// Edge-function copy of src/features/architect/api/shadowDistribution.ts.
// Edge functions cannot reach into src/ (Vite-bundled browser tree); the
// duplication is intentional and follows the same WHY block as
// postMatchEffects.ts.  Keep the two files in sync — change one, change
// the other AND add the matching unit test on the src/ side.
//
// PURPOSE
//   Load + aggregate `shadow_match_results` rows for one match into a
//   compact summary the Architect's pre-match council reads.  Service-
//   role only (the RLS on shadow_match_results blocks anon reads).

// deno-lint-ignore-file no-explicit-any

// ── Tuning constants (KEEP IN SYNC with src/) ──────────────────────────────

/**
 * Hard cap on rows loaded per match.
 *
 * MECHANICAL EFFECT: 16 is comfortably above the shadow-worker's per-match
 * cap (5) plus headroom; small enough that a misconfigured fixture with
 * runaway shadow counts can't blow up the pre-match payload.
 */
const MAX_SHADOW_ROWS = 16;

// ── Public shape ───────────────────────────────────────────────────────────

/**
 * Compact summary the council reads.  Identical to the src/ ShadowDistribution
 * shape — duplicate intentionally because Deno can't import from src/.
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
   * Perturbation breakdown — perturbation string ↔ row counts.  Lets the
   * council tell a real-engine distribution from a Poisson-only one.
   */
  perturbations: Record<string, number>;
}

interface ShadowRow {
  home_goals: number;
  away_goals: number;
  outcome: 'home' | 'draw' | 'away';
  perturbation: string;
}

// ── Aggregator ─────────────────────────────────────────────────────────────

/**
 * Pure aggregator — given raw shadow rows for a match, return the compact
 * summary.  Mirrors src/features/architect/api/shadowDistribution.ts.
 *
 * Edge cases mirror the src/ implementation:
 *   • Empty input → zeroed summary.
 *   • Unrecognised outcome strings → not counted under outcomes (silently
 *     skipped) but still counted in `n` and perturbations.
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
 * Load + aggregate the shadow distribution for one match.  Best-effort:
 * returns null on DB error or when no shadows exist for the match.
 *
 * @param db        Service-role Supabase client.
 * @param matchId   The match whose shadows to summarise.
 * @returns         The summary, or null when unavailable.
 */
export async function loadShadowDistribution(
  db: any,
  matchId: string,
): Promise<ShadowDistribution | null> {
  const { data, error } = await db
    .from('shadow_match_results')
    .select('home_goals, away_goals, outcome, perturbation')
    .eq('match_id', matchId)
    .limit(MAX_SHADOW_ROWS);

  if (error) {
    console.warn('[loadShadowDistribution] fetch failed:', error.message);
    return null;
  }
  if (!data || data.length === 0) return null;

  return aggregateShadowRows(data as ShadowRow[]);
}
