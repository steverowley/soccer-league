// ── generatePlayers.test.ts ──────────────────────────────────────────────────
// WHY THESE TESTS EXIST:
//   The seed generator is deterministic and produces the CANONICAL
//   supabase/seed.sql for the whole project — a subtle bug in ratings,
//   position counts, or name uniqueness would ship 704 broken players into
//   every dev environment and then cascade into match simulation outputs
//   that are hard to trace back to the root cause.
//
//   These tests pin the high-value invariants:
//     1. Exactly 22 players per team
//     2. Exactly 3 GK / 8 DF / 6 MF / 5 FW per team
//     3. Exactly 11 starters + 11 bench
//     4. Every full name is unique WITHIN a team
//     5. overall_rating stays inside the declared [65, 90] band
//     6. Starters land in [75, 90]; bench lands in [65, 78]
//     7. Determinism: the same seed string → byte-identical output across runs
//
//   Any future change to generatePlayers.ts that breaks one of these
//   invariants will fail CI loudly instead of drifting the seed silently.
//
// WHY NOT A SNAPSHOT TEST:
//   A full snapshot of 704 rows would be brittle: any intentional rebalance
//   (say, tweaking the starter rating spread) would force a snapshot update
//   that obscures the real change in review. Instead we test the invariants
//   that MUST hold regardless of tuning, plus a small determinism probe.

import { describe, expect, it } from 'vitest';
import { createRng } from './rng';
import { generateAllPlayers, PLAYERS_PER_TEAM } from './generatePlayers';
import { TEAMS } from './teamData';

// Shared fixture — one deterministic generation run reused across tests.
// The seed string here is deliberately DIFFERENT from the production
// SEED_STRING in scripts/generate-seed.ts so these tests can't accidentally
// pass just because someone committed a tuning change.
const TEST_SEED = 'vitest-generator-fixture';
const rng = createRng(TEST_SEED);
const players = generateAllPlayers(rng, TEAMS);

describe('generateAllPlayers — structural invariants', () => {
  it('produces exactly PLAYERS_PER_TEAM (22) × team-count players', () => {
    expect(players).toHaveLength(TEAMS.length * PLAYERS_PER_TEAM);
    expect(PLAYERS_PER_TEAM).toBe(22);
  });

  it('gives every team the correct positional split (3 GK / 8 DF / 6 MF / 5 FW)', () => {
    for (const team of TEAMS) {
      const roster = players.filter((p) => p.teamId === team.id);
      expect(roster, `team ${team.id} roster size`).toHaveLength(PLAYERS_PER_TEAM);

      const byPos = {
        GK: roster.filter((p) => p.position === 'GK').length,
        DF: roster.filter((p) => p.position === 'DF').length,
        MF: roster.filter((p) => p.position === 'MF').length,
        FW: roster.filter((p) => p.position === 'FW').length,
      };
      expect(byPos, `team ${team.id} positional counts`).toEqual({
        GK: 3,
        DF: 8,
        MF: 6,
        FW: 5,
      });
    }
  });

  it('gives every team exactly 11 starters and 11 bench', () => {
    for (const team of TEAMS) {
      const roster = players.filter((p) => p.teamId === team.id);
      const starters = roster.filter((p) => p.starter).length;
      const bench = roster.filter((p) => !p.starter).length;
      expect(starters, `team ${team.id} starter count`).toBe(11);
      expect(bench, `team ${team.id} bench count`).toBe(11);
    }
  });

  it('gives every team exactly 1 GK starter and 2 GK bench', () => {
    // This is invariant #1 from generatePlayers.ts — violating it breaks the
    // match engine's red-card GK-replacement code path. Pin it explicitly.
    for (const team of TEAMS) {
      const roster = players.filter((p) => p.teamId === team.id);
      const gkStarters = roster.filter((p) => p.position === 'GK' && p.starter).length;
      const gkBench = roster.filter((p) => p.position === 'GK' && !p.starter).length;
      expect(gkStarters, `${team.id} GK starters`).toBe(1);
      expect(gkBench, `${team.id} GK bench`).toBe(2);
    }
  });

  it('ensures every full name is unique within a team', () => {
    for (const team of TEAMS) {
      const names = players.filter((p) => p.teamId === team.id).map((p) => p.name);
      const unique = new Set(names);
      expect(unique.size, `team ${team.id} has duplicate names`).toBe(names.length);
    }
  });
});

describe('generateAllPlayers — rating ranges', () => {
  it('keeps every overall_rating inside the declared [65, 90] band', () => {
    for (const p of players) {
      expect(p.overallRating).toBeGreaterThanOrEqual(65);
      expect(p.overallRating).toBeLessThanOrEqual(90);
    }
  });

  it('keeps starter ratings inside [74, 91] (tuning window with jitter)', () => {
    // STARTER_RATING_MIN=75, STARTER_RATING_MAX=90 in the generator, BUT we
    // apply ±1 jitter before clamping to [min, max]. We test the post-clamp
    // window here because that's what the caller actually receives.
    for (const p of players.filter((x) => x.starter)) {
      expect(p.overallRating).toBeGreaterThanOrEqual(75);
      expect(p.overallRating).toBeLessThanOrEqual(90);
    }
  });

  it('keeps bench ratings inside [65, 78]', () => {
    for (const p of players.filter((x) => !x.starter)) {
      expect(p.overallRating).toBeGreaterThanOrEqual(65);
      expect(p.overallRating).toBeLessThanOrEqual(78);
    }
  });
});

describe('generateAllPlayers — age distribution', () => {
  it('keeps starter ages inside [20, 34]', () => {
    for (const p of players.filter((x) => x.starter)) {
      expect(p.age).toBeGreaterThanOrEqual(20);
      expect(p.age).toBeLessThanOrEqual(34);
    }
  });

  it('keeps bench ages inside [18, 36]', () => {
    for (const p of players.filter((x) => !x.starter)) {
      expect(p.age).toBeGreaterThanOrEqual(18);
      expect(p.age).toBeLessThanOrEqual(36);
    }
  });

  it('ensures at least one teenage (≤ 21) bench player across the league', () => {
    // Not a per-team guarantee — the bench age bucket weighting is ≈40% youth
    // but with only 11 bench slots a team can miss. Across 32 teams, however,
    // the probability of zero teens is astronomically small, so we assert at
    // the league level. This catches the case where a generator edit
    // accidentally disables the youth bucket entirely.
    const teens = players.filter((p) => !p.starter && p.age <= 21);
    expect(teens.length).toBeGreaterThan(20);
  });
});

describe('generateAllPlayers — determinism', () => {
  it('produces byte-identical output for the same seed string', () => {
    const runA = generateAllPlayers(createRng('determinism-probe'), TEAMS);
    const runB = generateAllPlayers(createRng('determinism-probe'), TEAMS);
    // Deep-equal is fine here — GeneratedPlayer is a plain-data object with
    // no functions, Dates, or Maps.
    expect(runA).toEqual(runB);
  });

  it('produces DIFFERENT output for different seed strings', () => {
    // Sanity check the other direction: changing the seed must actually
    // change the output. If we ever accidentally hard-code the RNG state
    // (e.g. by forgetting to thread `rng` through a helper), this test
    // catches it.
    const runA = generateAllPlayers(createRng('seed-a'), TEAMS);
    const runB = generateAllPlayers(createRng('seed-b'), TEAMS);
    expect(runA).not.toEqual(runB);
  });
});

describe('generateAllPlayers — nationality propagation', () => {
  it('labels every player with their team.nationality verbatim', () => {
    // This guards against a bug where the generator accidentally rolls a
    // random nationality instead of reading it from TeamDef — which would
    // scramble the themed rosters and quietly break immersion.
    for (const team of TEAMS) {
      const roster = players.filter((p) => p.teamId === team.id);
      for (const p of roster) {
        expect(p.nationality, `${team.id} player ${p.name}`).toBe(team.nationality);
      }
    }
  });
});
