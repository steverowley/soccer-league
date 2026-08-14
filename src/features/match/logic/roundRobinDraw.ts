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
// ALGORITHM — Berger circle (mirrors berger_round_robin_fixtures, migration 0082)
// ───────────────────────────────────────────────────────────────────────────────
// Given N teams (even; odd N gets a bye seat — see `BYE`):
//   • N-1 matchdays per leg, each holding exactly N/2 fixtures.
//   • Every team appears EXACTLY ONCE per matchday. That is the defining
//     property of a round-robin and the thing the old implementation lacked.
//   • Two legs: first leg (matchdays 1..N-1) + return leg with home/away
//     swapped (matchdays N..2(N-1)).
//   • scheduled_at = firstKickoffMs + (matchday - 1) × cadenceMs
//                                   + slot × kickoffStaggerMs.
//
// WHY THIS REPLACED THE ORIGINAL (2026-08-14)
// ────────────────────────────────────────────
// This module used to "mirror 0009_seed_league_fixtures.sql" — enumerating all
// N(N-1)/2 unique pairs in sorted-id order and chunking them into matchdays of
// P by index. That is not a round-robin: because the first N-1 pairs all start
// with the alphabetically-first team, that team played its whole season up
// front (four fixtures on Matchday 1) while later teams idled for weeks.
//
// Migration 0029 had already replaced exactly that algorithm on the SQL side
// with the circle method; this module reintroduced the bug on the TypeScript
// side, and `seasonRollover.ts` used it to seed Seasons 2 and 3 in production.
// Season 1 (seeded by the SQL RPC) had every team on 3 played; Seasons 2 and 3
// ranged from 1 to 7. The two paths now implement the same algorithm.

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
  /**
   * Which half of the double round-robin this fixture belongs to:
   * 1 = first leg, 2 = return leg (same pair, home and away reversed).
   * The SQL path has always written this; the TypeScript path did not, so
   * rollover-seeded seasons had a null `leg` and could not be split by half.
   */
  leg:            1 | 2;
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
 * Sentinel inserted into the rotation ring when the league has an odd number
 * of teams.  The circle method needs an even ring, so one seat holds this
 * placeholder and whichever real team is paired against it that round simply
 * has no fixture (a bye).  Fixtures touching it are dropped before returning.
 *
 * The value is not a valid team id, so it can never collide with a real one.
 */
const BYE = '__bye__';

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
 * Generate the complete double round-robin fixture list for one league
 * competition, using the Berger circle method.
 *
 * Guarantees (all asserted in the test suite):
 *   • Every unordered pair meets exactly twice — once home, once away.
 *   • Every team appears exactly once per matchday.
 *   • Output is identical regardless of the order `teamIds` arrives in.
 *
 * Odd team counts are supported: a bye seat joins the rotation, so one team
 * sits out each matchday and that matchday holds one fewer fixture.
 *
 * @param competitionId  UUID of the competition these fixtures belong to.
 * @param teamIds        All team IDs participating in this competition.
 *                       Order is irrelevant — the function sorts them
 *                       internally so the draw is deterministic.
 * @param calendar       Scheduling parameters (kickoff anchor, cadence,
 *                       within-matchday stagger).
 * @returns              Fixture rows ready for INSERT/UPSERT into `matches`,
 *                       ordered matchday-ascending. Empty when fewer than two
 *                       teams are supplied (no pairs possible).
 *
 * @example
 * const fixtures = generateRoundRobinFixtures(compId, ['a', 'b', 'c', 'd'], {
 *   firstKickoffMs: Date.now(),
 *   cadenceMs: 60_000,
 * });
 * // → 12 fixtures: 6 unique pairs × 2 legs, across 6 matchdays of 2
 */
export function generateRoundRobinFixtures(
  competitionId: string,
  teamIds:        string[],
  calendar:       FixtureCalendar,
): FixtureRow[] {
  if (teamIds.length < 2) return [];

  const { firstKickoffMs, cadenceMs, kickoffStaggerMs = 0 } = calendar;

  // Sort so the draw is deterministic across runs and machines, then pad to an
  // even ring — the circle method pairs seat-against-seat and needs both sides
  // of the ring to be the same size.
  const sorted = [...teamIds].sort();
  const ring   = sorted.length % 2 === 0 ? sorted : [...sorted, BYE];

  const n           = ring.length;      // always even
  const roundsPerLeg = n - 1;           // circle method: N-1 matchdays per leg
  const fixturesPerRound = n / 2;

  const rows: FixtureRow[] = [];

  /**
   * Emit one fixture, dropping it if either seat is the bye placeholder.
   *
   * @param home     Team id in the home seat.
   * @param away     Team id in the away seat.
   * @param matchday 1-based matchday number, written to `matches.round`.
   * @param leg      1 = first leg, 2 = return leg (home/away reversed).
   * @param slot     0-based kickoff slot within the matchday; slot s kicks off
   *                 `s × kickoffStaggerMs` after the matchday's base time so the
   *                 worker gets a trickle rather than a thundering herd.
   */
  const emit = (home: string, away: string, matchday: number, leg: 1 | 2, slot: number): void => {
    if (home === BYE || away === BYE) return;
    rows.push({
      competition_id: competitionId,
      home_team_id:   home,
      away_team_id:   away,
      round:          `Matchday ${matchday}`,
      leg,
      status:         'scheduled',
      scheduled_at:   new Date(
        firstKickoffMs + (matchday - 1) * cadenceMs + slot * kickoffStaggerMs,
      ).toISOString(),
    });
  };

  // ── The circle ───────────────────────────────────────────────────────────
  // One seat (the last) is the fixed anchor; the other n-1 seats rotate around
  // it. In round r the anchor faces seat r, and pair k pits seat (r+k) against
  // seat (r-k), both taken modulo the rotating ring. Home/away for the anchor
  // fixture alternates by round parity so no team collects every home game.
  //
  // Index note: the SQL is 1-based (`p_teams[n]`), this is 0-based, so every
  // position here is the SQL's minus one.
  for (let leg = 1 as 1 | 2; leg <= 2; leg = (leg + 1) as 1 | 2) {
    for (let r = 0; r < roundsPerLeg; r++) {
      const matchday = leg === 1 ? r + 1 : roundsPerLeg + r + 1;

      // Anchor fixture, slot 0 — opens the matchday.
      const anchorIsHome = r % 2 === 0;
      const anchorHome   = anchorIsHome ? ring[n - 1]! : ring[r]!;
      const anchorAway   = anchorIsHome ? ring[r]!     : ring[n - 1]!;
      // The return leg swaps every seat, so each pair gets one fixture at each
      // team's ground across the season.
      emit(
        leg === 1 ? anchorHome : anchorAway,
        leg === 1 ? anchorAway : anchorHome,
        matchday,
        leg,
        0,
      );

      for (let k = 1; k < fixturesPerRound; k++) {
        const homeSeat = (r + k) % roundsPerLeg;
        const awaySeat = (r - k + roundsPerLeg) % roundsPerLeg;
        emit(
          leg === 1 ? ring[homeSeat]! : ring[awaySeat]!,
          leg === 1 ? ring[awaySeat]! : ring[homeSeat]!,
          matchday,
          leg,
          k,
        );
      }
    }
  }

  return rows;
}
