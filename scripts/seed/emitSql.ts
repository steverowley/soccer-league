// ── emitSql.ts ───────────────────────────────────────────────────────────────
// WHY THIS FILE EXISTS:
//   The seed generator (scripts/generate-seed.ts) produces an in-memory
//   array of GeneratedPlayer rows. This module is the thin layer that turns
//   that array into the exact SQL text that Supabase expects. The SQL format
//   must match what supabase/seed.sql has historically used so that:
//
//     1. Downstream scripts / hooks that grep the file for specific INSERT
//        patterns continue to work.
//     2. The DELETE + INSERT + UPDATE flow stays idempotent for re-runs —
//        we TRUNCATE players CASCADE before inserting (see PLAYERS section).
//     3. The stat-derivation UPDATE block (computing attacking/defending/
//        mental/athletic/technical from overall_rating + position) lives
//        next to the player INSERTs so the two never drift out of sync.
//
//   The emitter is intentionally dumb: it's just a string builder. All the
//   interesting decisions (22 per team, rating spreads, personalities) happen
//   in generatePlayers.ts. If you find yourself adding logic here, consider
//   whether it belongs in the generator instead.
//
// FORMATTING CONVENTIONS:
//   - Use single-quote escaped strings for all text literals. The SQL escape
//     rule is: a literal apostrophe becomes two apostrophes (''). The
//     `sqlEscape` helper handles this.
//   - Values in INSERT rows are aligned with simple 2-space indentation.
//     The hand-written seed.sql was visually aligned with column-by-column
//     spacing; we don't try to reproduce that — deterministic two-space
//     output is easier to diff.
//   - Every major section is preceded by a -- ─── header so the generated
//     file is navigable by eye and by grep.

import type { GeneratedPlayer } from './generatePlayers';
import { PLAYERS_PER_TEAM } from './generatePlayers';
import type { TeamDef } from './teamData';

// ── SQL escaping ────────────────────────────────────────────────────────────

/**
 * Escape a string value for inclusion in a single-quoted SQL literal.
 *
 * Postgres uses doubled apostrophes (`''`) to escape a single apostrophe
 * inside a `'…'` string. We do NOT attempt to handle backslash escapes,
 * null bytes, or any other dangerous characters because the generator only
 * ever emits names from our hand-curated pools — no user input reaches here.
 *
 * If a pool entry ever needs a backslash, switch the INSERT to use an
 * E'…' extended string literal. For now, the assumption holds.
 *
 * @param value  Untrusted string (in practice: player name, team id, etc.)
 * @returns      Escaped inner content, suitable for wrapping with quotes.
 */
function sqlEscape(value: string): string {
  return value.replace(/'/g, "''");
}

// ── Player INSERT block ─────────────────────────────────────────────────────

/**
 * Build the complete `-- ── PLAYERS ──` section of seed.sql, including:
 *
 *   1. A section header comment listing the player count.
 *   2. `TRUNCATE TABLE players CASCADE;` — idempotency guarantee. CASCADE
 *      drops any `match_player_stats` rows referencing old player UUIDs so
 *      re-running the seed on a populated DB doesn't hit FK violations.
 *   3. `INSERT INTO players (team_id, name, position, nationality, age,
 *      overall_rating, personality, starter) VALUES (...)` with all rows.
 *   4. The post-insert `UPDATE players SET attacking/defending/... = CASE
 *      position WHEN ... END` block that derives stat columns from
 *      overall_rating. Preserved verbatim from the original seed.sql —
 *      gameEngine.js depends on exact camelCase-matching stat shapes.
 *   5. The post-insert jersey-number assignment block (starters 1-11,
 *      bench 12+, sorted within position by rating DESC).
 *
 * Rows are grouped by team with a `-- <team_id>` comment between groups so
 * the diff against the existing hand-written seed.sql is readable.
 *
 * @param players  Flat array of GeneratedPlayer from generateAllPlayers().
 *                 Must be grouped by teamId in contiguous blocks — the
 *                 function inserts the section marker on teamId change but
 *                 does NOT re-sort.
 * @param teams    Ordered team list, used only to validate that every team
 *                 got exactly PLAYERS_PER_TEAM rows (defensive check).
 * @returns        A multi-line SQL string ready to concat into seed.sql.
 */
export function emitPlayersSection(
  players: readonly GeneratedPlayer[],
  teams: readonly TeamDef[],
): string {
  // ── Defensive sanity check ────────────────────────────────────────────────
  // A subtle bug in the generator could emit 21 or 23 players for one team.
  // We'd rather fail loudly at emit time than silently ship a broken seed.
  const expectedTotal = teams.length * PLAYERS_PER_TEAM;
  if (players.length !== expectedTotal) {
    throw new Error(
      `emitPlayersSection: expected ${expectedTotal} players ` +
        `(${teams.length} teams × ${PLAYERS_PER_TEAM}), got ${players.length}`,
    );
  }
  // Also verify per-team counts.
  const perTeam = new Map<string, number>();
  for (const p of players) {
    perTeam.set(p.teamId, (perTeam.get(p.teamId) ?? 0) + 1);
  }
  for (const team of teams) {
    const count = perTeam.get(team.id) ?? 0;
    if (count !== PLAYERS_PER_TEAM) {
      throw new Error(
        `emitPlayersSection: team ${team.id} has ${count} players, expected ${PLAYERS_PER_TEAM}`,
      );
    }
  }

  const lines: string[] = [];

  // ── Header ────────────────────────────────────────────────────────────────
  lines.push('-- ── PLAYERS ────────────────────────────────────────────────────────────────────────────');
  lines.push(`-- ${expectedTotal} players (${teams.length} teams × ${PLAYERS_PER_TEAM} each). TRUNCATE before insert keeps this`);
  lines.push('-- idempotent; CASCADE drops any match_player_stats referencing old UUIDs.');
  lines.push('TRUNCATE TABLE players CASCADE;');
  lines.push('');
  lines.push(
    'INSERT INTO players (team_id, name, position, nationality, age, overall_rating, personality, starter) VALUES',
  );

  // ── Emit one VALUES row per player ────────────────────────────────────────
  // Row format:
  //   ('team-id','First Last','FW','Martian',24,85,'aggressive',true),
  // The last row terminates with ';' not ','; we track that via the index.
  let currentTeam = '';
  for (let i = 0; i < players.length; i++) {
    const p = players[i]!;

    // Insert a section marker when the team changes — makes the generated
    // file navigable by eye when debugging a single team's roster.
    if (p.teamId !== currentTeam) {
      lines.push(`-- ${p.teamId}`);
      currentTeam = p.teamId;
    }

    const isLast = i === players.length - 1;
    const terminator = isLast ? ';' : ',';
    lines.push(
      `  ('${sqlEscape(p.teamId)}','${sqlEscape(p.name)}','${p.position}',` +
        `'${sqlEscape(p.nationality)}',${p.age},${p.overallRating},` +
        `'${p.personality}',${p.starter})${terminator}`,
    );
  }

  // ── Stat-derivation UPDATE ────────────────────────────────────────────────
  // This block is copied VERBATIM from the original hand-written seed.sql
  // (lines ~896-933). The thresholds below are tuned for the match engine's
  // resolveContest() rolls — see src/gameEngine.js for how these stats flow
  // into contest outcomes. Any change must be coordinated with the engine.
  //
  // WHY we emit this from the generator rather than leaving it in a static
  // suffix file: keeping the derivation NEXT to the INSERTs makes it obvious
  // that the seed produces fully-populated player rows in a single pass.
  // Splitting it out would leave a window where seeded players have null
  // stat columns, which the engine's defensive clamps would paper over but
  // which would subtly change match outcomes.
  lines.push('');
  lines.push('-- ── PLAYER SIMULATION STATS ───────────────────────────────────────────────────');
  lines.push('-- Derive attacking/defending/mental/athletic/technical from overall_rating and');
  lines.push('-- position.  Values are clamped to [38, 95] to keep the engine rolls balanced.');
  lines.push('-- GK:  high defending, low attacking');
  lines.push('-- DF:  high defending, moderate attacking');
  lines.push('-- MF:  balanced across all stats, slight mental/technical lean');
  lines.push('-- FW:  high attacking and athletic, low defending');
  lines.push('UPDATE players SET');
  lines.push('  attacking = CASE position');
  lines.push('    WHEN \'GK\' THEN GREATEST(38, overall_rating - 30)');
  lines.push('    WHEN \'DF\' THEN GREATEST(42, overall_rating - 15)');
  lines.push('    WHEN \'MF\' THEN GREATEST(48, overall_rating - 5)');
  lines.push('    WHEN \'FW\' THEN LEAST(95, overall_rating + 10)');
  lines.push('  END,');
  lines.push('  defending = CASE position');
  lines.push('    WHEN \'GK\' THEN LEAST(95, overall_rating + 10)');
  lines.push('    WHEN \'DF\' THEN LEAST(95, overall_rating + 8)');
  lines.push('    WHEN \'MF\' THEN GREATEST(42, overall_rating - 10)');
  lines.push('    WHEN \'FW\' THEN GREATEST(38, overall_rating - 20)');
  lines.push('  END,');
  lines.push('  mental = CASE position');
  lines.push('    WHEN \'GK\' THEN overall_rating');
  lines.push('    WHEN \'DF\' THEN overall_rating - 2');
  lines.push('    WHEN \'MF\' THEN LEAST(95, overall_rating + 5)');
  lines.push('    WHEN \'FW\' THEN overall_rating - 3');
  lines.push('  END,');
  lines.push('  athletic = CASE position');
  lines.push('    WHEN \'GK\' THEN GREATEST(38, overall_rating - 5)');
  lines.push('    WHEN \'DF\' THEN overall_rating');
  lines.push('    WHEN \'MF\' THEN overall_rating');
  lines.push('    WHEN \'FW\' THEN LEAST(95, overall_rating + 5)');
  lines.push('  END,');
  lines.push('  technical = CASE position');
  lines.push('    WHEN \'GK\' THEN GREATEST(38, overall_rating - 15)');
  lines.push('    WHEN \'DF\' THEN GREATEST(42, overall_rating - 10)');
  lines.push('    WHEN \'MF\' THEN LEAST(95, overall_rating + 3)');
  lines.push('    WHEN \'FW\' THEN GREATEST(42, overall_rating - 5)');
  lines.push('  END;');

  // ── Jersey-number assignment ──────────────────────────────────────────────
  // Also copied verbatim from the original seed.sql. The ordering rule:
  //   PARTITION BY team_id
  //   ORDER BY starter DESC, position (GK→DF→MF→FW), overall_rating DESC
  //
  // This means:
  //   - Starters get numbers 1..11 (best rated first within each position)
  //   - Bench gets 12..22 in the same position order
  //
  // The 22-player expansion widens the bench numbering to 12..22 instead of
  // 12..16, so the starter-number mental model (GK=1, CBs=2-3, etc.) stays
  // intact — Phase 0.5 only changes WHICH players fill 17..22.
  lines.push('');
  lines.push('-- ── JERSEY NUMBERS ────────────────────────────────────────────────────────────');
  lines.push('-- Assign shirt numbers per team: starters first (GK=1, DF=2–5, MF=6–8,');
  lines.push('-- FW=9–11), bench from 12 upward.  Within each position+starter group players');
  lines.push('-- are ordered by overall_rating DESC so the best player gets the lower number.');
  lines.push('UPDATE players p SET jersey_number = sub.rn');
  lines.push('FROM (');
  lines.push('  SELECT id,');
  lines.push('    ROW_NUMBER() OVER (');
  lines.push('      PARTITION BY team_id');
  lines.push('      ORDER BY');
  lines.push('        starter DESC,');
  lines.push('        CASE position WHEN \'GK\' THEN 1 WHEN \'DF\' THEN 2 WHEN \'MF\' THEN 3 WHEN \'FW\' THEN 4 END,');
  lines.push('        overall_rating DESC');
  lines.push('    ) AS rn');
  lines.push('  FROM players');
  lines.push(') sub');
  lines.push('WHERE p.id = sub.id;');

  return lines.join('\n');
}
