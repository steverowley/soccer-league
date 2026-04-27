// ── match/logic/cupDraw.ts ────────────────────────────────────────────────────
// WHY: The Celestial Cup and Solar Shield are single-elimination tournaments.
// This module is the pure, stateless draw engine — it takes a list of qualified
// teams, assigns bracket positions using standard tournament seeding, and returns
// the full bracket structure for all rounds (including future TBD rounds).
//
// DETERMINISM: The caller passes a `seed` string (e.g. `${seasonId}:celestial`)
// used for within-tier tiebreaking, making draws reproducible and debuggable.
//
// BRACKET ALGORITHM: Standard single-elimination with balanced seeding:
//   - Teams are sorted by `seed` (1 = best, n = worst).
//   - Bracket positions are assigned via recursive interleaving so the two
//     top seeds can only meet in the Final, and the top seed always plays the
//     weakest qualifier in their first round.
//   - When n is not a power of 2, the top `bracketSize - n` seeds receive
//     byes and skip the first playable round.
//
// STORAGE FORMAT: The returned `StoredBracket` is the JSON that gets stored in
// `competitions.bracket`. Each match records its home/away team IDs (or null
// for TBD) plus references (`home_from_round`, `home_from_slot`) pointing to
// which prior match feeds each TBD slot. After a match is inserted into the DB,
// its `match_db_id` is filled in. After it completes, `winner_team_id` is set.
// The cupSeeder reads this structure to know what to insert next.
//
// ROUND NAMING:
//   bracketSize=2  → Final
//   bracketSize=4  → Semi Final, Final
//   bracketSize=8  → Quarter Final, Semi Final, Final
//   bracketSize=16 → Round of 16, Quarter Final, Semi Final, Final

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * A team qualified for the cup draw.
 * `seed` determines bracket position: 1 = top seed, n = bottom.
 * Seeds must be unique and consecutive starting at 1.
 */
export interface BracketTeam {
  /** Supabase team slug (primary key of `teams` table). */
  team_id: string;
  /** Human-readable team name for display. */
  team_name: string;
  /**
   * Seeding position (1 = best). Used for bracket position assignment so top
   * seeds avoid each other until the Final. Must be unique per draw.
   */
  seed: number;
}

/**
 * One match within the stored bracket JSON.
 * Home/away team IDs are null when the team is determined by a prior match.
 * `home_from_round` + `home_from_slot` (and away equivalents) reference which
 * prior match feeds this slot — used by `advanceCupRound` to determine when
 * a match is ready to insert.
 */
export interface StoredBracketMatch {
  /** 0-indexed position within the round. */
  slot: number;
  /**
   * Known home team, or null if the home team is the winner of a prior match.
   * Null for all matches beyond round 1 unless a bye team is home.
   */
  home_team_id: string | null;
  /**
   * Known away team, or null if the away team is the winner of a prior match.
   * Null for all matches beyond round 1 (and some round 1 matches with byes).
   */
  away_team_id: string | null;
  /** Round number of the prior match whose winner is home. null if home_team_id is known. */
  home_from_round: number | null;
  /** Slot of the prior match whose winner is home. null if home_team_id is known. */
  home_from_slot: number | null;
  /** Round number of the prior match whose winner is away. null if away_team_id is known. */
  away_from_round: number | null;
  /** Slot of the prior match whose winner is away. null if away_team_id is known. */
  away_from_slot: number | null;
  /**
   * UUID of the `matches` DB row for this fixture, or null before insertion.
   * Set by the cupSeeder after inserting the match.
   */
  match_db_id: string | null;
  /**
   * Winner team_id once the match is completed, or null if still to be played.
   * Set by `advanceCupRound` after match.completed fires.
   */
  winner_team_id: string | null;
}

/**
 * One round of the bracket.
 * `round_number` is 1-indexed and stable across the whole bracket
 * (round 1 = first playable round, regardless of byes).
 */
export interface StoredBracketRound {
  /** 1-indexed; determines round name and 'from' references in later rounds. */
  round_number: number;
  /**
   * Human-readable round label used in the UI and DB `matches.round` column.
   * e.g. 'Round of 16', 'Quarter Final', 'Semi Final', 'Final'.
   */
  name: string;
  /** All matches in this round. */
  matches: StoredBracketMatch[];
}

/**
 * The full bracket structure stored as JSONB in `competitions.bracket`.
 * Contains every round from the first playable round to the Final, with
 * TBD slots linked via `from_round`/`from_slot` references.
 */
export interface StoredBracket {
  /**
   * Next power of 2 ≥ number of teams.
   * Determines how many byes are awarded and how rounds are named.
   */
  bracket_size: number;
  /** Total matches across all rounds: bracket_size - 1. */
  total_matches: number;
  /** All rounds in chronological order (index 0 = first playable round). */
  rounds: StoredBracketRound[];
}

// ── Internal slot reference ───────────────────────────────────────────────────

type SlotRef =
  | { type: 'known'; team_id: string }
  | { type: 'bye' }
  | { type: 'from'; round_number: number; slot: number };

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Generate bracket seed positions using recursive interleaving.
 *
 * Produces an array of length `size` where each element is the seed number
 * (1-indexed) that occupies that bracket leaf position. Adjacent pairs are
 * R1 matchups; the structure guarantees seed 1 and seed 2 can only meet in
 * the Final if seedings hold.
 *
 * Example — size=8: [1, 8, 4, 5, 2, 7, 3, 6]
 *   → R1 pairs: (1,8), (4,5), (2,7), (3,6)
 *   → QF: winner(1v8) vs winner(4v5), winner(2v7) vs winner(3v6)
 *   → Final: always seeds 1 vs 2 if seedings hold
 *
 * @param size  Must be a power of 2.
 */
function makeBracketSeeds(size: number): number[] {
  if (size === 1) return [1];
  const half = makeBracketSeeds(size / 2);
  const result: number[] = [];
  for (const s of half) {
    result.push(s);
    result.push(size + 1 - s);
  }
  return result;
}

/**
 * Derive a human-readable round name from position within the bracket.
 *
 * @param roundNumber   1-indexed round (1 = first playable round).
 * @param bracketSize   The total bracket size (power of 2).
 */
function getRoundName(roundNumber: number, bracketSize: number): string {
  // Total playable rounds = log2(bracketSize).
  // Rounds are named from the Final backwards.
  const totalRounds = Math.log2(bracketSize);
  const roundsFromFinal = totalRounds - roundNumber;
  switch (roundsFromFinal) {
    case 0:  return 'Final';
    case 1:  return 'Semi Final';
    case 2:  return 'Quarter Final';
    default: {
      // 'Round of N' where N = number of teams entering this stage of the bracket.
      const teamsInStage = bracketSize / Math.pow(2, roundNumber - 1);
      return `Round of ${teamsInStage}`;
    }
  }
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Draw a single-elimination bracket for the given teams.
 *
 * Teams must be supplied with unique `seed` values (1 = best seed).
 * The `seed` string is used for deterministic within-tier shuffling if seeds
 * are equal — in practice the caller assigns distinct integer seeds from the
 * league standings, so the RNG is a belt-and-suspenders measure.
 *
 * Returns a `StoredBracket` describing every round from the first playable
 * round to the Final. TBD slots carry `from_round`/`from_slot` references
 * so `advanceCupRound` can resolve them after each match completes.
 *
 * @param _seed     Seed string for determinism (reserved for within-tier
 *                  randomisation; not yet consumed in v1 since seeds are
 *                  distinct integers from standings).
 * @param teams     Qualified teams with distinct integer `seed` values.
 * @returns         Full bracket structure for storage in `competitions.bracket`.
 *
 * @throws          If fewer than 2 teams are provided.
 */
export function drawSingleElim(
  _seed: string,
  teams: BracketTeam[],
): StoredBracket {
  const n = teams.length;
  if (n < 2) throw new Error(`drawSingleElim requires at least 2 teams; got ${n}`);

  // Compute the smallest power of 2 ≥ n. This is the bracket "size" — the
  // number of leaf positions in the full tree (including bye positions).
  let bracketSize = 1;
  while (bracketSize < n) bracketSize *= 2;

  // Sort by seed (ascending: 1 = top) and build a lookup map.
  const sorted = [...teams].sort((a, b) => a.seed - b.seed);
  const seedToTeam = new Map<number, BracketTeam>(sorted.map((t, i) => [i + 1, t]));

  // Assign teams to bracket leaf positions using the standard interleaving
  // algorithm. Positions beyond n have no team (bye positions).
  const leafSeeds  = makeBracketSeeds(bracketSize);
  const leafRefs: SlotRef[] = leafSeeds.map((s) => {
    const team = seedToTeam.get(s);
    return team ? { type: 'known', team_id: team.team_id } : { type: 'bye' };
  });

  // Process levels bottom-up. Each iteration pairs adjacent `SlotRef`s:
  //   known vs known  → real match (inserted into current round)
  //   known vs bye    → auto-advance (the real team moves up without a match)
  //   from  vs from   → real match (both teams TBD; resolved later)
  //   known vs from   → real match (one team known; the other TBD)
  //   bye   vs bye    → should not occur for n ≥ bracketSize / 2
  const rounds: StoredBracketRound[] = [];
  let currentLevel: SlotRef[] = leafRefs;
  let roundNumber = 0;

  while (currentLevel.length > 1) {
    roundNumber++;
    const nextLevel: SlotRef[] = [];
    const roundMatches: StoredBracketMatch[] = [];
    let slotInRound = 0;

    for (let i = 0; i < currentLevel.length; i += 2) {
      const left  = currentLevel[i]!;
      const right = currentLevel[i + 1]!;

      // ── Auto-advance: one side is a bye ────────────────────────────────────
      if (left.type === 'bye' || right.type === 'bye') {
        // The non-bye side advances without playing. If both are byes (can't
        // happen in practice), propagate bye upwards.
        const survivor = left.type === 'bye' ? right : left;
        nextLevel.push(survivor);
        continue; // no match generated for this pair
      }

      // ── Real match: both sides are real teams or TBD winners ───────────────
      const slot = slotInRound++;
      roundMatches.push({
        slot,
        home_team_id:   left.type  === 'known' ? left.team_id  : null,
        away_team_id:   right.type === 'known' ? right.team_id : null,
        home_from_round: left.type  === 'from'  ? left.round_number  : null,
        home_from_slot:  left.type  === 'from'  ? left.slot          : null,
        away_from_round: right.type === 'from'  ? right.round_number : null,
        away_from_slot:  right.type === 'from'  ? right.slot         : null,
        match_db_id:    null,
        winner_team_id: null,
      });
      nextLevel.push({ type: 'from', round_number: roundNumber, slot });
    }

    if (roundMatches.length > 0) {
      rounds.push({
        round_number: roundNumber,
        name: getRoundName(roundNumber, bracketSize),
        matches: roundMatches,
      });
    }

    currentLevel = nextLevel;
  }

  // Renumber rounds to be consecutive 1..k (gaps can appear when intermediate
  // levels produce only auto-advances, though this doesn't happen in practice
  // for single-leg cups where byes are only at the leaf level).
  const renumbered = rounds.map((r, idx) => ({
    ...r,
    round_number: idx + 1,
    // Update 'from' references in match slots to use renumbered round numbers.
    matches: r.matches.map((m) => ({
      ...m,
      home_from_round: m.home_from_round !== null
        ? rounds.findIndex((rr) => rr.round_number === m.home_from_round) + 1
        : null,
      away_from_round: m.away_from_round !== null
        ? rounds.findIndex((rr) => rr.round_number === m.away_from_round) + 1
        : null,
    })),
  }));

  return {
    bracket_size:  bracketSize,
    // A full single-elimination bracket with bracketSize leaves has
    // bracketSize - 1 total matches (regardless of byes).
    total_matches: bracketSize - 1,
    rounds:        renumbered,
  };
}
