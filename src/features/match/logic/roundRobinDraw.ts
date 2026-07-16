// ── features/match/logic/roundRobinDraw.ts ────────────────────────────────────
// Pure round-robin fixture generator.  No I/O, no Supabase — takes a list of
// team IDs and scheduling parameters, returns fixture rows ready to INSERT.
//
// WHY THIS IS A SEPARATE MODULE
// ──────────────────────────────
// The rollover script (scripts/rollover-season.ts) needs this logic, as does
// any future fixture re-seeding tool.  Keeping it pure + exported makes it
// trivially unit-testable without mocking the DB, and matches the pattern
// established by cupDraw.ts and seasonLifecycle.ts.
//
// ALGORITHM (mirrors 0009_seed_league_fixtures.sql exactly)
// ──────────────────────────────────────────────────────────
// Given N teams (e.g. N=8) and P pairs per matchday (default 4):
//   • Unique pairs: N×(N-1)/2 = 28.
//   • CEIL(28/P) matchdays per leg  →  e.g. CEIL(28/4)=7 with default P.
//   • Two legs: first leg (matchdays 1..L) + return leg (home/away swapped,
//     matchdays L+1..2L), where L = CEIL(pairs/P).
//   • scheduled_at = firstKickoffMs + (matchday_number - 1) × cadenceMs.
//
// The return-leg matchday offset (L + matchday) keeps return-leg matchdays
// strictly above first-leg matchdays without a gap, regardless of P.

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * A single fixture row, shaped for direct INSERT into `matches`.
 * All fields are strings/literals so the type is DB-portable.
 */
export interface FixtureRow {
  competition_id: string;
  home_team_id:   string;
  away_team_id:   string;
  /** "Matchday N" label written to matches.round. */
  round:          string;
  /** Always 'scheduled' — the worker flips this as it processes each match. */
  status:         'scheduled';
  /** UTC ISO-8601 kickoff timestamp. */
  scheduled_at:   string;
}

/**
 * Scheduling parameters for a fixture calendar.
 */
export interface FixtureCalendar {
  /**
   * Number of unique fixture pairs assigned to each matchday.
   * For 8 teams (28 pairs): 4 pairs/matchday → 7 matchdays/leg → 14 total.
   * Increasing this compresses the season calendar; decreasing it lengthens it.
   */
  pairsPerMatchday: number;
  /**
   * UTC timestamp (ms since epoch) of matchday 1.  All matchday timestamps
   * are computed as `firstKickoffMs + (matchday - 1) × cadenceMs`.
   */
  firstKickoffMs: number;
  /**
   * Milliseconds between kickoffs WITHIN a matchday.  Slot n of a matchday
   * kicks off at `matchday_base + n × kickoffStaggerMs`, so the match worker
   * claims a rolling trickle instead of a whole matchday at the same instant —
   * 16 simultaneous kickoffs starved the worker/database on 2026-07-16.
   * Omit (or 0) for the legacy everyone-at-once behaviour.
   */
  kickoffStaggerMs?: number;
  /**
   * Milliseconds between consecutive matchdays.
   * 1,209,600,000 ms = 14 days matches the original Season 1 production cadence.
   * Use 300,000 ms (5 min) for fast-cadence test runs.
   */
  cadenceMs: number;
}

// ── Constants ──────────────────────────────────────────────────────────────────

/**
 * Default pairs-per-matchday for an 8-team league.
 * 28 unique pairs / 4 per matchday = 7 matchdays per leg, 14 total.
 * Exported so callers can reference the same constant rather than
 * duplicating the magic number.
 */
export const DEFAULT_PAIRS_PER_MATCHDAY = 4;

/**
 * Production matchday interval in milliseconds.
 * 1 day × 24 h × 60 min × 60 s × 1000 ms = 86,400,000 ms.
 * A matchday every real-world day: a 14-matchday league season plays out in
 * two weeks and there is always a match to watch or bet on.  (Was 14 days
 * until 2026-07-16 — a misreading of Season 1's actual daily cadence.)
 */
export const PRODUCTION_CADENCE_MS = 24 * 60 * 60 * 1_000;

// ── Core function ─────────────────────────────────────────────────────────────

/**
 * Generate the complete round-robin fixture list for one league competition.
 *
 * @param competitionId  UUID of the competition these fixtures belong to.
 * @param teamIds        All team IDs participating in this competition.
 *                       Order is irrelevant — the function sorts them
 *                       internally to ensure deterministic pair generation.
 * @param calendar       Scheduling parameters (kickoff anchor, cadence,
 *                       pairs-per-matchday).
 * @returns              Fixture rows ready for INSERT/UPSERT into `matches`.
 *                       Returns an empty array if fewer than 2 teams are
 *                       supplied (no pairs possible).
 *
 * @example
 * const fixtures = generateRoundRobinFixtures(compId, ['a', 'b', 'c', 'd'], {
 *   pairsPerMatchday: 2,
 *   firstKickoffMs: Date.now(),
 *   cadenceMs: 60_000,
 * });
 * // → 12 fixtures: 6 unique pairs × 2 legs
 */
export function generateRoundRobinFixtures(
  competitionId: string,
  teamIds:        string[],
  calendar:       FixtureCalendar,
): FixtureRow[] {
  if (teamIds.length < 2) return [];

  const { pairsPerMatchday, firstKickoffMs, cadenceMs, kickoffStaggerMs = 0 } = calendar;

  // Sort IDs so pair generation is deterministic across runs and machines.
  // The SQL equivalent is `ct1.team_id < ct2.team_id` in migration 0009.
  const sorted = [...teamIds].sort();

  // Enumerate every unique unordered pair — same result as a Cartesian
  // product filtered by `a < b`.
  const pairs: [string, string][] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      pairs.push([sorted[i]!, sorted[j]!]);
    }
  }

  // Number of matchdays in the first leg — drives the return-leg offset.
  // For 28 pairs with 4 per matchday this is 7; with 2 per matchday it is 14.
  // Computing it dynamically means the function stays correct for any
  // (team count, pairsPerMatchday) combination, not just the 8-team default.
  const firstLegDays = Math.ceil(pairs.length / pairsPerMatchday);

  const rows: FixtureRow[] = [];

  pairs.forEach(([home, away], idx) => {
    // Convert 0-based index to 1-based pair number so the matchday math is
    // readable: pairs 1–4 → MD1, pairs 5–8 → MD2, … (ceil(n/pairsPerMatchday)).
    const pairNum1  = idx + 1;
    const matchday  = Math.ceil(pairNum1 / pairsPerMatchday); // first-leg matchday (1..firstLegDays)
    const returnDay = firstLegDays + matchday;                // return-leg matchday, no overlap

    // Kickoff slot WITHIN the matchday: pairs fill matchdays in blocks
    // (pairs 1–4 → MD1, 5–8 → MD2, …), so a pair's 0-based position inside its
    // block is its slot.  The return leg reuses the same slot — the block maps
    // 1:1 onto its return matchday — so both legs stagger identically.
    const slotInDay = (pairNum1 - 1) % pairsPerMatchday;

    // scheduled_at = firstKickoff + (matchday_index) × cadence + slot × stagger
    // matchday_index is 0-based: matchday 1 → index 0, matchday 14 → index 13.
    // The slot term spreads a matchday's kickoffs (e.g. 15 min apart) so the
    // worker never faces the whole day's fixtures at one instant.
    const schedFirst  = new Date(firstKickoffMs + (matchday  - 1) * cadenceMs + slotInDay * kickoffStaggerMs).toISOString();
    const schedReturn = new Date(firstKickoffMs + (returnDay - 1) * cadenceMs + slotInDay * kickoffStaggerMs).toISOString();

    // First leg: original home/away assignment.
    rows.push({
      competition_id: competitionId,
      home_team_id:   home,
      away_team_id:   away,
      round:          `Matchday ${matchday}`,
      status:         'scheduled',
      scheduled_at:   schedFirst,
    });

    // Return leg: home ↔ away swapped so each team gets a home fixture.
    rows.push({
      competition_id: competitionId,
      home_team_id:   away,
      away_team_id:   home,
      round:          `Matchday ${returnDay}`,
      status:         'scheduled',
      scheduled_at:   schedReturn,
    });
  });

  return rows;
}
