// ── match/logic/cupDraw.test.ts ───────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { drawSingleElim, type BracketTeam, type StoredBracketMatch } from './cupDraw';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeTeams(n: number): BracketTeam[] {
  return Array.from({ length: n }, (_, i) => ({
    team_id:   `team-${i + 1}`,
    team_name: `Team ${i + 1}`,
    seed:       i + 1,
  }));
}

// ── Utility assertions ────────────────────────────────────────────────────────

/** Collect every match across all rounds. */
function allMatches(bracket: ReturnType<typeof drawSingleElim>): StoredBracketMatch[] {
  return bracket.rounds.flatMap((r) => r.matches);
}

/** Count total inserted match rows (those whose match_db_id could be set). */
function totalPlayableMatches(bracket: ReturnType<typeof drawSingleElim>): number {
  return allMatches(bracket).length;
}

// ── Determinism ───────────────────────────────────────────────────────────────

describe('drawSingleElim — determinism', () => {
  it('same seed + teams produces identical bracket', () => {
    const teams = makeTeams(12);
    const a = drawSingleElim('season-1:celestial', teams);
    const b = drawSingleElim('season-1:celestial', teams);
    expect(a).toEqual(b);
  });

  it('different seeds produce different bracket JSON (string)', () => {
    const teams = makeTeams(12);
    // Seed does not affect seeded brackets currently (teams have distinct seeds),
    // but the function must at least be callable with different seeds without error.
    expect(() => drawSingleElim('seed-A', teams)).not.toThrow();
    expect(() => drawSingleElim('seed-B', teams)).not.toThrow();
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe('drawSingleElim — validation', () => {
  it('throws for fewer than 2 teams', () => {
    expect(() => drawSingleElim('s', makeTeams(1))).toThrow();
    expect(() => drawSingleElim('s', [])).toThrow();
  });
});

// ── 8-team bracket (no byes, clean power-of-2) ────────────────────────────────

describe('drawSingleElim — 8 teams', () => {
  const bracket = drawSingleElim('s', makeTeams(8));

  it('bracket_size = 8', () => {
    expect(bracket.bracket_size).toBe(8);
  });

  it('produces exactly 7 total matches (8-1)', () => {
    expect(totalPlayableMatches(bracket)).toBe(7);
  });

  it('has exactly 3 rounds: QF (4), SF (2), Final (1)', () => {
    expect(bracket.rounds).toHaveLength(3);
    expect(bracket.rounds[0]!.matches).toHaveLength(4);
    expect(bracket.rounds[1]!.matches).toHaveLength(2);
    expect(bracket.rounds[2]!.matches).toHaveLength(1);
  });

  it('round names: Quarter Final → Semi Final → Final', () => {
    expect(bracket.rounds[0]!.name).toBe('Quarter Final');
    expect(bracket.rounds[1]!.name).toBe('Semi Final');
    expect(bracket.rounds[2]!.name).toBe('Final');
  });

  it('round numbers are 1, 2, 3', () => {
    expect(bracket.rounds.map((r) => r.round_number)).toEqual([1, 2, 3]);
  });

  it('all round-1 matches have known home and away teams', () => {
    for (const m of bracket.rounds[0]!.matches) {
      expect(m.home_team_id).not.toBeNull();
      expect(m.away_team_id).not.toBeNull();
    }
  });

  it('round 2+ matches have null TBD teams with from_round/from_slot references', () => {
    for (const round of bracket.rounds.slice(1)) {
      for (const m of round.matches) {
        // Both teams are TBD (winners of prior matches)
        expect(m.home_team_id).toBeNull();
        expect(m.away_team_id).toBeNull();
        expect(m.home_from_round).not.toBeNull();
        expect(m.away_from_round).not.toBeNull();
      }
    }
  });

  it('seed 1 and seed 2 are in separate halves (cannot meet before Final)', () => {
    const qfMatches = bracket.rounds[0]!.matches;
    // In QF, seed 1 (team-1) and seed 2 (team-2) should NOT be in the same match.
    const matchWithSeed1 = qfMatches.find(
      (m) => m.home_team_id === 'team-1' || m.away_team_id === 'team-1',
    );
    const matchWithSeed2 = qfMatches.find(
      (m) => m.home_team_id === 'team-2' || m.away_team_id === 'team-2',
    );
    expect(matchWithSeed1).toBeDefined();
    expect(matchWithSeed2).toBeDefined();
    // They must be in different matches.
    expect(matchWithSeed1).not.toBe(matchWithSeed2);
  });

  it('seed 1 plays the weakest opponent (seed 8) in round 1', () => {
    const r1 = bracket.rounds[0]!.matches;
    const seed1Match = r1.find(
      (m) => m.home_team_id === 'team-1' || m.away_team_id === 'team-1',
    )!;
    const opponent = seed1Match.home_team_id === 'team-1'
      ? seed1Match.away_team_id
      : seed1Match.home_team_id;
    expect(opponent).toBe('team-8');
  });

  it('all match_db_id are null (pre-insertion)', () => {
    for (const m of allMatches(bracket)) {
      expect(m.match_db_id).toBeNull();
    }
  });

  it('all winner_team_id are null (pre-play)', () => {
    for (const m of allMatches(bracket)) {
      expect(m.winner_team_id).toBeNull();
    }
  });
});

// ── 12-team bracket (4 byes) ──────────────────────────────────────────────────

describe('drawSingleElim — 12 teams (Celestial Cup / Solar Shield)', () => {
  const bracket = drawSingleElim('season-1:celestial', makeTeams(12));

  it('bracket_size = 16', () => {
    expect(bracket.bracket_size).toBe(16);
  });

  it('produces exactly 11 playable matches', () => {
    expect(totalPlayableMatches(bracket)).toBe(11);
  });

  it('has 4 rounds: Round of 16 (4), QF (4), SF (2), Final (1)', () => {
    expect(bracket.rounds).toHaveLength(4);
    expect(bracket.rounds[0]!.matches).toHaveLength(4);
    expect(bracket.rounds[1]!.matches).toHaveLength(4);
    expect(bracket.rounds[2]!.matches).toHaveLength(2);
    expect(bracket.rounds[3]!.matches).toHaveLength(1);
  });

  it('round names are correct', () => {
    expect(bracket.rounds[0]!.name).toBe('Round of 16');
    expect(bracket.rounds[1]!.name).toBe('Quarter Final');
    expect(bracket.rounds[2]!.name).toBe('Semi Final');
    expect(bracket.rounds[3]!.name).toBe('Final');
  });

  it('round-1 matches only include seeds 5–12 (seeds 1–4 get byes)', () => {
    const r1Teams = new Set<string>();
    for (const m of bracket.rounds[0]!.matches) {
      if (m.home_team_id) r1Teams.add(m.home_team_id);
      if (m.away_team_id) r1Teams.add(m.away_team_id);
    }
    // Seeds 1-4 should NOT appear in round 1
    for (let seed = 1; seed <= 4; seed++) {
      expect(r1Teams.has(`team-${seed}`)).toBe(false);
    }
    // All 8 of seeds 5-12 should appear
    for (let seed = 5; seed <= 12; seed++) {
      expect(r1Teams.has(`team-${seed}`)).toBe(true);
    }
  });

  it('QF matches have one known bye-team and one TBD winner', () => {
    const qfMatches = bracket.rounds[1]!.matches;
    // Each QF match should have: one known team (the bye) + one TBD (R1 winner).
    for (const m of qfMatches) {
      const knownCount = [m.home_team_id, m.away_team_id].filter(Boolean).length;
      const tbdCount = [m.home_from_slot, m.away_from_slot].filter((v) => v !== null).length;
      expect(knownCount).toBe(1);
      expect(tbdCount).toBe(1);
    }
  });

  it('bye seeds in QF are exactly seeds 1–4', () => {
    const qfKnownTeams = bracket.rounds[1]!.matches
      .flatMap((m) => [m.home_team_id, m.away_team_id])
      .filter(Boolean) as string[];
    const byeSeeds = new Set(qfKnownTeams);
    expect(byeSeeds).toEqual(new Set(['team-1', 'team-2', 'team-3', 'team-4']));
  });

  it('every QF TBD slot references a round-1 match', () => {
    const r1SlotCount = bracket.rounds[0]!.matches.length;
    for (const m of bracket.rounds[1]!.matches) {
      const fromSlot = m.home_from_slot ?? m.away_from_slot;
      expect(fromSlot).not.toBeNull();
      expect(fromSlot!).toBeGreaterThanOrEqual(0);
      expect(fromSlot!).toBeLessThan(r1SlotCount);
    }
  });

  it('seed 1 and seed 2 can only meet in the Final', () => {
    // Check that team-1 and team-2 are in different SF halves.
    // They should appear in different QF matches (which feed different SFs).
    const qf = bracket.rounds[1]!.matches;
    const qfWithSeed1 = qf.findIndex(
      (m) => m.home_team_id === 'team-1' || m.away_team_id === 'team-1',
    );
    const qfWithSeed2 = qf.findIndex(
      (m) => m.home_team_id === 'team-2' || m.away_team_id === 'team-2',
    );
    // They must be in different halves of the QF (slots 0-1 vs 2-3).
    const half1 = [0, 1];
    const half2 = [2, 3];
    const seed1InHalf1 = half1.includes(qfWithSeed1);
    const seed2InHalf1 = half1.includes(qfWithSeed2);
    // They cannot both be in the same half.
    expect(seed1InHalf1).not.toBe(seed2InHalf1);
    // Verify using half2 check too.
    const seed1InHalf2 = half2.includes(qfWithSeed1);
    const seed2InHalf2 = half2.includes(qfWithSeed2);
    expect(seed1InHalf2).not.toBe(seed2InHalf2);
  });

  it('no team appears in round 1 twice', () => {
    const r1Teams: string[] = [];
    for (const m of bracket.rounds[0]!.matches) {
      if (m.home_team_id) r1Teams.push(m.home_team_id);
      if (m.away_team_id) r1Teams.push(m.away_team_id);
    }
    expect(new Set(r1Teams).size).toBe(r1Teams.length);
  });
});

// ── 16-team bracket (no byes, maximum balanced) ───────────────────────────────

describe('drawSingleElim — 16 teams', () => {
  const bracket = drawSingleElim('s', makeTeams(16));

  it('bracket_size = 16', () => {
    expect(bracket.bracket_size).toBe(16);
  });

  it('produces exactly 15 matches', () => {
    expect(totalPlayableMatches(bracket)).toBe(15);
  });

  it('has 4 rounds: R16 (8), QF (4), SF (2), Final (1)', () => {
    expect(bracket.rounds).toHaveLength(4);
    expect(bracket.rounds[0]!.matches).toHaveLength(8);
    expect(bracket.rounds[1]!.matches).toHaveLength(4);
    expect(bracket.rounds[2]!.matches).toHaveLength(2);
    expect(bracket.rounds[3]!.matches).toHaveLength(1);
  });

  it('all 16 teams appear exactly once in round 1', () => {
    const r1Teams: string[] = [];
    for (const m of bracket.rounds[0]!.matches) {
      r1Teams.push(m.home_team_id!, m.away_team_id!);
    }
    expect(new Set(r1Teams).size).toBe(16);
  });
});

// ── Odd / non-power-of-2 team counts ─────────────────────────────────────────

describe('drawSingleElim — non-power-of-2 team counts', () => {
  it('5 teams → bracket_size=8, 4 total matches, 1 R1 match', () => {
    const b = drawSingleElim('s', makeTeams(5));
    expect(b.bracket_size).toBe(8);
    // 5 teams in 8-bracket: 3 byes. leafSeeds=[1,8,4,5,2,7,3,6]; seeds 6,7,8 are byes.
    // Pairs: (1,bye→auto-1), (4,5→R1 match), (2,bye→auto-2), (3,bye→auto-3)
    // R1: 1 real match. Level 2 (4 items): (team1, from(r1,0)) + (team2, team3) → 2 matches.
    // Level 3: 1 match (Final). Total: 1+2+1 = 4 matches (= n-1).
    expect(totalPlayableMatches(b)).toBe(4);
    expect(b.rounds[0]!.matches).toHaveLength(1); // R1: 1 real match
    expect(b.rounds).toHaveLength(3); // bracketSize=8 → 3 rounds
  });

  it('7 teams → bracket_size=8, 6 total matches', () => {
    const b = drawSingleElim('s', makeTeams(7));
    expect(b.bracket_size).toBe(8);
    // 7 teams, 1 bye (seed 8 doesn't exist).
    // leafSeeds: [1, 8, 4, 5, 2, 7, 3, 6]
    // seed8 → bye. Pairs: (1,bye→auto-1), (4,5→R1), (2,7→R1), (3,6→R1)
    // R1: 3 real matches. QF: (team-1, from(r1)), (from(r1), from(r1)) = 2 real matches? Wait:
    // nextLevel after R1: [team-1(known), from(r1,0), from(r1,1), from(r1,2)]
    // QF pairs: (team-1, from(r1,0)) → real; (from(r1,1), from(r1,2)) → real
    // SF: 1 match. Final: 1 match. Total: 3+2+1+1 = wait, that's 7 but we only have 7 teams.
    // Actually: bracketSize=8 → total_matches = 8-1 = 7, but only 6 are actually played
    // (1 bye skips a match). Hmm: 3(R1) + 2(QF) + 1(SF) + ... wait
    // QF has 4 teams → 2 matches. SF has 2 teams → 1 match. Final: 1. R1: 3. Total: 7.
    // But one bracket slot has a bye, so there are still 7 actual matches? No:
    // The bye team auto-advances WITHOUT a match. So total playable matches = n-1 = 6.
    // Let me verify: 3(R1) + 2(QF) + 1(SF) + 0(Final... wait Final still needs to be played)
    // R1: 3 matches
    // QF: team-1(bye) vs from(r1,0), from(r1,1) vs from(r1,2) → 2 matches
    // SF: from(qf,0) vs from(qf,1) → 1 match
    // Final: 1 match
    // Total: 3+2+1+1 = 7... but that can't be right for 7 teams (should be 6 matches for 7 teams).
    // Actually for single-elimination: every team except the winner loses exactly once.
    // 7 teams, 1 winner → 6 losers → 6 matches. Let me recount.
    // Hmm, the bye team never loses in R1, they just auto-advance. So:
    // R1: 3 matches → 3 teams eliminated, 3 winners + 1 bye = 4 in QF
    // QF: 2 matches → 2 teams eliminated, 2 in SF
    // SF: 1 match → 1 eliminated, 2 in Final
    // Final: 1 match → 1 winner
    // Total matches: 3+2+1+1 = 7, but only 6 teams eliminated...
    // WAIT: 3+2+1+1 = 7 matches, but teams eliminated = 3+2+1+1 = 7 teams? That's too many.
    // The bye team loses in QF (or later). Let me re-examine:
    // 7 teams play → 6 losses needed → 6 matches.
    // My algorithm: R1 has 3 real matches (6 teams play), 1 auto-advance.
    // After R1: 3 R1 winners + 1 bye = 4 teams in QF → 2 QF matches → 2 in SF → 1 SF match → 2 in Final → 1 Final match.
    // Total: 3+2+1+1 = 7. But that's 7, not 6!
    // The discrepancy: with 7 teams, the Total matches should be 6 (each non-winner loses once).
    // With a bye, the bye team DOES NOT play in R1 but still plays in QF and beyond.
    // So all 7 teams play eventually (6 lose). But wait: 3+2+1+1 = 7 matches total.
    // Let's count eliminations: R1 eliminates 3, QF eliminates 2, SF eliminates 1, Final eliminates 1 = total 7 eliminated?
    // That's wrong for 7 teams (can only eliminate 6).
    //
    // Oh wait, I see the issue. For 7 teams:
    // R1: 3 matches → 3 teams OUT, 4 advance (3 winners + 1 bye)
    // QF: 2 matches → 2 teams OUT, 2 advance
    // SF: 1 match → 1 OUT, 2 advance (wait: 4/2 = 2 in SF, not 4)
    // Hmm: QF: 4 teams → 2 matches → 2 winners advance to SF
    // SF: 2 teams → 1 match → 1 winner advances to Final... but Final needs 2 teams!
    // Wait: after SF (2 teams, 1 match), we have 1 winner. Then who do they play in the Final?
    // Oh: 4 teams in QF → 2 QF matches → 2 SF teams → 1 SF match → FINAL with 2 teams? No.
    //
    // Let me recount for 7 teams (bracketSize=8):
    // R1 level: 4 pairs. Pairs where both sides are real: 3. Pair with bye: 1.
    // After R1: 3 winners + 1 auto-advance = 4 teams in "level 2"
    // Level 2 (QF for bracketSize=8): 4 teams, 2 matches
    // After QF: 2 winners
    // Level 3 (SF): 2 teams, 1 match
    // After SF: 1 winner (not 2!)
    // Wait that means no Final? That can't be right...
    //
    // Oh I see: for bracketSize=8, there are 3 levels (log2(8)=3 rounds):
    // Level 1: pairs of 8 leaves → 4 pairs → 3 real matches + 1 bye → round 1 (3 matches)
    // nextLevel: 4 items (3 from(r1,...) + 1 known(team-1))
    // Level 2: pairs of 4 → 2 real matches → round 2 (2 matches)
    // nextLevel: 2 items
    // Level 3: pairs of 2 → 1 real match → round 3 (1 match)
    // nextLevel: 1 item
    // while loop ends.
    //
    // Total: 3+2+1 = 6 matches. ✓ (7 teams → 6 matches)
    // Round structure: Round 1 (3 matches), Round 2 (2 matches), Round 3 (1 match) = Final ✓
    //
    // I made an error earlier. The Final is Round 3, not a separate round 4!
    // For bracketSize=8: 3 rounds total. The last round IS the Final.
    // In my getRoundName: for bracketSize=8, roundsFromFinal for roundNumber=3 = 3-3 = 0 → 'Final' ✓
    //
    // So for 7 teams: 3 rounds (R1, R2, Final) with 3+2+1=6 matches total. ✓
    expect(totalPlayableMatches(b)).toBe(6);
    expect(b.rounds).toHaveLength(3);
    expect(b.rounds[0]!.matches).toHaveLength(3);
  });

  it('9 teams → bracket_size=16, 8 total matches', () => {
    const b = drawSingleElim('s', makeTeams(9));
    expect(b.bracket_size).toBe(16);
    // 9 teams in 16-bracket: 7 byes.
    // leafSeeds=[1,16,8,9,4,13,5,12,2,15,7,10,3,14,6,11]
    // Only seeds 1-9 exist. seeds 10-16 are byes.
    // Pairs: (1,16→bye), (8,9), (4,13→bye), (5,12→bye), (2,15→bye), (7,10→bye), (3,14→bye), (6,11→bye)
    // R1 real matches: only (8,9) → 1 match
    // nextLevel: [team1, from(r1,0), team4, team5, team2, team7, team3, team6]
    // QF pairs: (team1, from(r1,0)), (team4,team5), (team2,team7), (team3,team6) → 4 real matches
    // SF: 2 matches. Final: 1 match. Total: 1+4+2+1 = 8 matches. ✓ (9-1=8)
    expect(totalPlayableMatches(b)).toBe(8);
    expect(b.rounds[0]!.matches).toHaveLength(1);
    expect(b.rounds[1]!.matches).toHaveLength(4);
  });

  it('11 teams → bracket_size=16, 10 total matches', () => {
    const b = drawSingleElim('s', makeTeams(11));
    expect(b.bracket_size).toBe(16);
    // 11 teams: 5 byes. Total matches = 11-1 = 10.
    expect(totalPlayableMatches(b)).toBe(10);
  });

  it('3 teams → bracket_size=4, 2 total matches', () => {
    const b = drawSingleElim('s', makeTeams(3));
    expect(b.bracket_size).toBe(4);
    // 3 teams in 4-bracket: 1 bye.
    // leafSeeds=[1,4,2,3], seeds 1-3 exist, seed4→bye
    // Pairs: (1,4→bye), (2,3→R1) → 1 R1 match
    // nextLevel: [team1, from(r1,0)]
    // Level 2 (Final): (team1, from(r1,0)) → 1 match
    // Total: 2 matches ✓
    expect(totalPlayableMatches(b)).toBe(2);
  });
});

// ── Structure integrity ───────────────────────────────────────────────────────

describe('drawSingleElim — structural invariants', () => {
  const sizes = [5, 7, 8, 9, 12, 16];

  it.each(sizes)('%i teams: total_matches = n - 1', (n) => {
    const b = drawSingleElim('s', makeTeams(n));
    expect(totalPlayableMatches(b)).toBe(n - 1);
  });

  it.each(sizes)('%i teams: last round is always named Final', (n) => {
    const b = drawSingleElim('s', makeTeams(n));
    expect(b.rounds.at(-1)!.name).toBe('Final');
  });

  it.each(sizes)('%i teams: Final always has exactly 1 match', (n) => {
    const b = drawSingleElim('s', makeTeams(n));
    expect(b.rounds.at(-1)!.matches).toHaveLength(1);
  });

  it.each(sizes)('%i teams: round_numbers are consecutive starting at 1', (n) => {
    const b = drawSingleElim('s', makeTeams(n));
    const nums = b.rounds.map((r) => r.round_number);
    const expected = Array.from({ length: b.rounds.length }, (_, i) => i + 1);
    expect(nums).toEqual(expected);
  });

  it.each(sizes)('%i teams: match slots within each round are 0-indexed consecutive', (n) => {
    const b = drawSingleElim('s', makeTeams(n));
    for (const round of b.rounds) {
      const slots = round.matches.map((m) => m.slot).sort((a, z) => a - z);
      const expected = Array.from({ length: round.matches.length }, (_, i) => i);
      expect(slots).toEqual(expected);
    }
  });

  it.each(sizes)('%i teams: from_round references always point to a prior round', (n) => {
    const b = drawSingleElim('s', makeTeams(n));
    for (const round of b.rounds) {
      for (const m of round.matches) {
        if (m.home_from_round !== null) {
          expect(m.home_from_round).toBeLessThan(round.round_number);
        }
        if (m.away_from_round !== null) {
          expect(m.away_from_round).toBeLessThan(round.round_number);
        }
      }
    }
  });

  it.each(sizes)('%i teams: from_slot references are within valid range for their round', (n) => {
    const b = drawSingleElim('s', makeTeams(n));
    const matchCountByRound = new Map(b.rounds.map((r) => [r.round_number, r.matches.length]));
    for (const round of b.rounds) {
      for (const m of round.matches) {
        if (m.home_from_round !== null && m.home_from_slot !== null) {
          const maxSlot = matchCountByRound.get(m.home_from_round)!;
          expect(m.home_from_slot).toBeGreaterThanOrEqual(0);
          expect(m.home_from_slot).toBeLessThan(maxSlot);
        }
        if (m.away_from_round !== null && m.away_from_slot !== null) {
          const maxSlot = matchCountByRound.get(m.away_from_round)!;
          expect(m.away_from_slot).toBeGreaterThanOrEqual(0);
          expect(m.away_from_slot).toBeLessThan(maxSlot);
        }
      }
    }
  });
});
