// ── match/logic/roundRobinDraw.test.ts ───────────────────────────────────────
// Unit tests for generateRoundRobinFixtures().
//
// WHY THESE TESTS EXIST
// ──────────────────────
// The round-robin generator is the single most structurally critical piece of
// the season rollover: wrong pair counts, duplicate fixtures, or bad scheduling
// would silently corrupt an entire season.  Pure function + deterministic output
// makes exhaustive property testing cheap and reliable here.
//
// TEST STRATEGY
// ─────────────
// Property tests rather than snapshot tests: we assert structural invariants
// (total count, no duplicate pairs, correct round labels, valid timestamps) so
// the tests survive any future calendar parameter changes without needing
// brittle snapshot updates.

import { describe, it, expect } from 'vitest';
import {
  generateRoundRobinFixtures,
  DEFAULT_PAIRS_PER_MATCHDAY,
  PRODUCTION_CADENCE_MS,
  type FixtureCalendar,
} from './roundRobinDraw';

// ── Test fixture helpers ──────────────────────────────────────────────────────

/** Canonical 8-team league — matches the ISL production setup. */
const EIGHT_TEAMS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'];

/** Minimal 2-team league for boundary testing. */
const TWO_TEAMS = ['team-a', 'team-b'];

/** A stable anchor timestamp for all scheduling assertions. */
const ANCHOR_MS = new Date('2601-01-01T12:00:00Z').getTime();

/** Calendar used in most tests: production cadence, stable anchor. */
const STANDARD_CALENDAR: FixtureCalendar = {
  pairsPerMatchday: DEFAULT_PAIRS_PER_MATCHDAY,
  firstKickoffMs:   ANCHOR_MS,
  cadenceMs:        PRODUCTION_CADENCE_MS,
};

// ── Fixture count invariants ──────────────────────────────────────────────────

describe('generateRoundRobinFixtures — fixture counts', () => {
  it('returns 0 fixtures for fewer than 2 teams', () => {
    expect(generateRoundRobinFixtures('comp-1', [], STANDARD_CALENDAR)).toHaveLength(0);
    expect(generateRoundRobinFixtures('comp-1', ['solo'], STANDARD_CALENDAR)).toHaveLength(0);
  });

  it('returns 2 fixtures for 2 teams (1 unique pair × 2 legs)', () => {
    const fixtures = generateRoundRobinFixtures('comp-1', TWO_TEAMS, STANDARD_CALENDAR);
    expect(fixtures).toHaveLength(2);
  });

  it('returns 56 fixtures for 8 teams (28 unique pairs × 2 legs)', () => {
    // This is the production ISL setup: 8 teams, 28 pairs, 2 legs.
    const fixtures = generateRoundRobinFixtures('comp-1', EIGHT_TEAMS, STANDARD_CALENDAR);
    expect(fixtures).toHaveLength(56);
  });

  it('returns N×(N-1) fixtures for arbitrary team counts', () => {
    for (const n of [3, 4, 5, 6]) {
      const teams = Array.from({ length: n }, (_, i) => `team-${i}`);
      const fixtures = generateRoundRobinFixtures('comp-x', teams, STANDARD_CALENDAR);
      // N×(N-1) = unique pairs × 2 legs
      expect(fixtures).toHaveLength(n * (n - 1));
    }
  });
});

// ── Pair uniqueness and completeness ─────────────────────────────────────────

describe('generateRoundRobinFixtures — pair integrity', () => {
  it('each ordered pair (home, away) appears exactly once', () => {
    const fixtures = generateRoundRobinFixtures('comp-1', EIGHT_TEAMS, STANDARD_CALENDAR);
    const pairKeys = fixtures.map((f) => `${f.home_team_id}|${f.away_team_id}`);
    const unique   = new Set(pairKeys);
    expect(unique.size).toBe(pairKeys.length);
  });

  it('every team plays every other team exactly twice (once home, once away)', () => {
    const fixtures = generateRoundRobinFixtures('comp-1', EIGHT_TEAMS, STANDARD_CALENDAR);

    for (const team of EIGHT_TEAMS) {
      const homeGames = fixtures.filter((f) => f.home_team_id === team);
      const awayGames = fixtures.filter((f) => f.away_team_id === team);
      // 7 opponents × 1 home fixture each
      expect(homeGames).toHaveLength(7);
      // 7 opponents × 1 away fixture each
      expect(awayGames).toHaveLength(7);
    }
  });

  it('no team plays itself', () => {
    const fixtures = generateRoundRobinFixtures('comp-1', EIGHT_TEAMS, STANDARD_CALENDAR);
    for (const f of fixtures) {
      expect(f.home_team_id).not.toBe(f.away_team_id);
    }
  });

  it('output is deterministic regardless of teamIds input order', () => {
    const forward  = generateRoundRobinFixtures('comp-1', EIGHT_TEAMS,           STANDARD_CALENDAR);
    const reversed = generateRoundRobinFixtures('comp-1', [...EIGHT_TEAMS].reverse(), STANDARD_CALENDAR);
    // The pair keys should be identical sets (same fixtures, possibly in the same order).
    const keySet = (rows: typeof forward) =>
      new Set(rows.map((f) => `${f.home_team_id}|${f.away_team_id}`));
    expect(keySet(forward)).toEqual(keySet(reversed));
  });
});

// ── Matchday labelling ────────────────────────────────────────────────────────

describe('generateRoundRobinFixtures — round labels', () => {
  it('first-leg fixtures are labelled Matchday 1–7 for 8 teams', () => {
    const fixtures   = generateRoundRobinFixtures('comp-1', EIGHT_TEAMS, STANDARD_CALENDAR);
    const roundNums  = fixtures.map((f) => parseInt(f.round.replace('Matchday ', ''), 10));
    const firstLeg   = roundNums.filter((n) => n <= 7);
    const returnLeg  = roundNums.filter((n) => n >= 8);
    // 28 pairs × 2 legs, split evenly
    expect(firstLeg).toHaveLength(28);
    expect(returnLeg).toHaveLength(28);
  });

  it('return-leg matchday numbers are 7 higher than the corresponding first-leg matchday', () => {
    const fixtures = generateRoundRobinFixtures('comp-1', EIGHT_TEAMS, STANDARD_CALENDAR);

    // Build a lookup: canonical pair → {first-leg matchday, return-leg matchday}
    const pairDays = new Map<string, { first: number; ret: number }>();
    for (const f of fixtures) {
      const [a, b]  = [f.home_team_id, f.away_team_id].sort();
      const key     = `${a}|${b}`;
      const day     = parseInt(f.round.replace('Matchday ', ''), 10);
      const entry   = pairDays.get(key) ?? { first: 0, ret: 0 };
      if (day <= 7) entry.first = day; else entry.ret = day;
      pairDays.set(key, entry);
    }

    for (const { first, ret } of pairDays.values()) {
      expect(ret - first).toBe(7);
    }
  });

  it('all fixtures have status "scheduled"', () => {
    const fixtures = generateRoundRobinFixtures('comp-1', EIGHT_TEAMS, STANDARD_CALENDAR);
    for (const f of fixtures) {
      expect(f.status).toBe('scheduled');
    }
  });

  it('all fixtures carry the correct competition_id', () => {
    const compId   = 'test-competition-uuid';
    const fixtures = generateRoundRobinFixtures(compId, EIGHT_TEAMS, STANDARD_CALENDAR);
    for (const f of fixtures) {
      expect(f.competition_id).toBe(compId);
    }
  });
});

// ── Scheduling ────────────────────────────────────────────────────────────────

describe('generateRoundRobinFixtures — scheduling', () => {
  it('matchday 1 fixtures are scheduled at firstKickoffMs', () => {
    const fixtures  = generateRoundRobinFixtures('comp-1', EIGHT_TEAMS, STANDARD_CALENDAR);
    const md1       = fixtures.filter((f) => f.round === 'Matchday 1');
    const expected  = new Date(ANCHOR_MS).toISOString();
    for (const f of md1) {
      expect(f.scheduled_at).toBe(expected);
    }
  });

  it('each successive matchday is exactly cadenceMs later', () => {
    const cadenceMs = 5 * 60_000; // 5 minutes — fast-cadence for test clarity
    const cal: FixtureCalendar = { ...STANDARD_CALENDAR, cadenceMs };
    const fixtures  = generateRoundRobinFixtures('comp-1', EIGHT_TEAMS, cal);

    // Collect one timestamp per matchday and verify spacing.
    const byMatchday = new Map<number, number>();
    for (const f of fixtures) {
      const day = parseInt(f.round.replace('Matchday ', ''), 10);
      byMatchday.set(day, Date.parse(f.scheduled_at));
    }

    const days = [...byMatchday.keys()].sort((a, b) => a - b);
    for (let i = 1; i < days.length; i++) {
      const prev = byMatchday.get(days[i - 1]!)!;
      const curr = byMatchday.get(days[i]!)!;
      expect(curr - prev).toBe(cadenceMs);
    }
  });

  it('matchday 14 is scheduled at firstKickoffMs + 13 × cadenceMs', () => {
    const cal      = { ...STANDARD_CALENDAR, cadenceMs: 60_000 }; // 1-min cadence
    const fixtures = generateRoundRobinFixtures('comp-1', EIGHT_TEAMS, cal);
    const md14     = fixtures.filter((f) => f.round === 'Matchday 14');
    const expected = new Date(ANCHOR_MS + 13 * 60_000).toISOString();
    expect(md14.length).toBeGreaterThan(0);
    for (const f of md14) {
      expect(f.scheduled_at).toBe(expected);
    }
  });

  it('all fixtures produce valid ISO-8601 timestamps', () => {
    const fixtures = generateRoundRobinFixtures('comp-1', EIGHT_TEAMS, STANDARD_CALENDAR);
    for (const f of fixtures) {
      expect(Date.parse(f.scheduled_at)).not.toBeNaN();
    }
  });
});

// ── Kickoff stagger (post-2026-07-16: never a whole matchday at one instant) ──

describe('generateRoundRobinFixtures — kickoffStaggerMs', () => {
  const STAGGER_MS = 15 * 60_000; // production stagger: 15 minutes between slots

  it('staggers the fixtures within a matchday into distinct slots, staggerMs apart', () => {
    const cal: FixtureCalendar = { ...STANDARD_CALENDAR, kickoffStaggerMs: STAGGER_MS };
    const fixtures = generateRoundRobinFixtures('comp-1', EIGHT_TEAMS, cal);
    const md1 = fixtures
      .filter((f) => f.round === 'Matchday 1')
      .map((f) => Date.parse(f.scheduled_at))
      .sort((a, b) => a - b);

    // 4 pairs/matchday → slots 0..3, one kickoff every STAGGER_MS from the anchor.
    expect(md1).toEqual([0, 1, 2, 3].map((slot) => ANCHOR_MS + slot * STAGGER_MS));
  });

  it('return-leg fixtures reuse the same slot offsets as their first-leg matchday', () => {
    const cadenceMs = 60 * 60_000; // 1-hour cadence keeps matchdays visually distinct
    const cal: FixtureCalendar = { ...STANDARD_CALENDAR, cadenceMs, kickoffStaggerMs: STAGGER_MS };
    const fixtures = generateRoundRobinFixtures('comp-1', EIGHT_TEAMS, cal);

    // Matchday 8 is the return leg of matchday 1 (7 first-leg matchdays for 8
    // teams), so its slot offsets from its own base must match matchday 1's.
    const offsets = (round: string, baseMs: number) =>
      fixtures
        .filter((f) => f.round === round)
        .map((f) => Date.parse(f.scheduled_at) - baseMs)
        .sort((a, b) => a - b);

    expect(offsets('Matchday 8', ANCHOR_MS + 7 * cadenceMs)).toEqual(
      offsets('Matchday 1', ANCHOR_MS),
    );
  });

  it('omitting kickoffStaggerMs keeps the legacy everyone-at-once dating', () => {
    const fixtures = generateRoundRobinFixtures('comp-1', EIGHT_TEAMS, STANDARD_CALENDAR);
    const md1 = new Set(
      fixtures.filter((f) => f.round === 'Matchday 1').map((f) => f.scheduled_at),
    );
    expect(md1.size).toBe(1); // all four kickoffs share the anchor timestamp
  });

  it('stagger never bleeds into the next matchday at production values', () => {
    // Worst slot (3) × 15 min = 45 min — far inside the 1-day cadence, so
    // matchday ordering is preserved: every MD-N fixture precedes every MD-N+1.
    const cal: FixtureCalendar = {
      ...STANDARD_CALENDAR,
      cadenceMs:        PRODUCTION_CADENCE_MS,
      kickoffStaggerMs: STAGGER_MS,
    };
    const fixtures = generateRoundRobinFixtures('comp-1', EIGHT_TEAMS, cal);
    const maxByDay = new Map<number, number>();
    const minByDay = new Map<number, number>();
    for (const f of fixtures) {
      const day = parseInt(f.round.replace('Matchday ', ''), 10);
      const ts  = Date.parse(f.scheduled_at);
      maxByDay.set(day, Math.max(maxByDay.get(day) ?? -Infinity, ts));
      minByDay.set(day, Math.min(minByDay.get(day) ?? Infinity, ts));
    }
    const days = [...maxByDay.keys()].sort((a, b) => a - b);
    for (let i = 1; i < days.length; i++) {
      expect(maxByDay.get(days[i - 1]!)!).toBeLessThan(minByDay.get(days[i]!)!);
    }
  });
});

// ── Custom pairsPerMatchday ───────────────────────────────────────────────────

describe('generateRoundRobinFixtures — custom pairsPerMatchday', () => {
  it('2 pairs/matchday doubles the number of matchdays but keeps fixture count the same', () => {
    const cal2     = { ...STANDARD_CALENDAR, pairsPerMatchday: 2 };
    const fixtures = generateRoundRobinFixtures('comp-1', EIGHT_TEAMS, cal2);
    // Total fixture count is unaffected by pairsPerMatchday
    expect(fixtures).toHaveLength(56);

    // With 28 pairs and 2 per matchday → 14 first-leg matchdays, 14 return-leg
    const rounds = new Set(fixtures.map((f) => f.round));
    expect(rounds.size).toBe(28); // matchdays 1..14 + 15..28
  });
});
