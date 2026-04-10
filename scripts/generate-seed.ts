#!/usr/bin/env tsx
// ── generate-seed.ts ─────────────────────────────────────────────────────────
// WHY THIS SCRIPT EXISTS:
//   Phase 0.5 of the plan (/root/.claude/plans/nifty-brewing-pixel.md) calls
//   for a deterministic seed generator that expands rosters from 16 to 22
//   players per team (512 → 704). Hand-editing supabase/seed.sql to add 6
//   more players to each of 32 teams would be:
//     - Tedious and error-prone
//     - Non-reproducible (every edit diverges the file from any stored state)
//     - A one-off: the moment we need to regenerate (e.g. for a new season
//       or to add entity kinds per Phase 5), we're stuck re-editing by hand
//
//   This script is the canonical source for the players section of the seed
//   file from Phase 0.5 onward. It does NOT yet regenerate the static
//   sections (leagues, teams, competitions, managers) — those are preserved
//   verbatim from the existing seed.sql to minimise diff surface area while
//   the project still has other moving parts. As the generator grows it will
//   absorb those sections too.
//
// USAGE:
//   npx tsx scripts/generate-seed.ts          # writes to supabase/seed.sql
//   npx tsx scripts/generate-seed.ts --dry    # prints the new players block to stdout
//
// DETERMINISM:
//   The SEED_STRING constant below is the ONLY source of randomness. Change
//   it to intentionally reshuffle every player name/age/rating; otherwise
//   leave it alone so re-runs are byte-identical and the diff against the
//   committed seed.sql stays empty.
//
// STRATEGY (surgical replacement):
//   1. Read the current supabase/seed.sql verbatim.
//   2. Locate the PLAYERS section via two sentinel comments that already
//      exist in the file ("-- ── PLAYERS" and "-- ── MANAGERS ─"). Splicing
//      between these markers preserves everything outside the section.
//   3. Generate the new players block (via generatePlayers + emitSql).
//   4. Write the spliced file back (unless --dry).
//
// IF THE SENTINELS CHANGE:
//   The markers below must match the existing seed.sql literally. If a
//   future edit changes the comment wording, update SECTION_START_MARKER
//   and SECTION_END_MARKER in lockstep with that edit.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { createRng } from './seed/rng';
import { generateAllPlayers } from './seed/generatePlayers';
import { emitPlayersSection } from './seed/emitSql';
import { TEAMS } from './seed/teamData';

// ── Constants ───────────────────────────────────────────────────────────────

/**
 * Deterministic seed string. NEVER reuse the same string with a different
 * generator version or you'll produce subtly different output under the
 * same label. Versioning convention: "isl-{phase}-{iteration}".
 *
 * Phase 0.5 first cut → `isl-phase-0.5-v1`.
 */
const SEED_STRING = 'isl-phase-0.5-v1';

/**
 * Sentinel used to locate the start of the players block in seed.sql. We
 * look for the section header comment that the existing hand-written file
 * uses. Matching is exact (no regex wildcards) so any future edit to the
 * header text must be mirrored here.
 */
const SECTION_START_MARKER = '-- ── PLAYERS ──';

/**
 * Sentinel used to locate the end of the players block (= the start of the
 * next section, MANAGERS). The generator replaces everything between
 * SECTION_START_MARKER (inclusive) and SECTION_END_MARKER (exclusive).
 */
const SECTION_END_MARKER = '-- ── MANAGERS ';

// ── Path resolution ─────────────────────────────────────────────────────────

/**
 * Resolve the absolute path to supabase/seed.sql relative to this script.
 * Using import.meta.url keeps the script runnable from any CWD (e.g. from
 * a pre-commit hook in the root or from a CI workdir).
 */
function resolveSeedPath(): string {
  // __dirname equivalent for ESM — import.meta.url is the script's file: URL.
  const here = dirname(fileURLToPath(import.meta.url));
  // scripts/ lives next to supabase/, so go up one level.
  return resolve(here, '..', 'supabase', 'seed.sql');
}

// ── Splicer ─────────────────────────────────────────────────────────────────

/**
 * Replace the PLAYERS section of an existing seed.sql string with a freshly
 * generated one. Keeps the file's byte ordering intact outside the block so
 * the diff against the previous version is minimal and easy to review.
 *
 * Throws if either sentinel is missing — this is intentional: we'd rather
 * fail loudly than silently produce an invalid seed file by appending.
 *
 * @param existingSql         Full contents of the current supabase/seed.sql.
 * @param newPlayersSection   Output of emitPlayersSection(), already trimmed
 *                            of trailing newlines.
 * @returns                   The updated file content ready to write back.
 */
function spliceSeedFile(existingSql: string, newPlayersSection: string): string {
  const startIdx = existingSql.indexOf(SECTION_START_MARKER);
  if (startIdx === -1) {
    throw new Error(
      `spliceSeedFile: could not find section start marker "${SECTION_START_MARKER}" in seed.sql. ` +
        'Check that the file has not been reorganised — if it has, update SECTION_START_MARKER.',
    );
  }

  const endIdx = existingSql.indexOf(SECTION_END_MARKER, startIdx);
  if (endIdx === -1) {
    throw new Error(
      `spliceSeedFile: could not find section end marker "${SECTION_END_MARKER}" after the players section. ` +
        'Check that the MANAGERS section header is intact.',
    );
  }

  // ── Compose the new file ────────────────────────────────────────────────
  // Everything before startIdx is preserved verbatim. Between startIdx and
  // endIdx we substitute the new players block. Everything from endIdx
  // onwards is preserved verbatim.
  //
  // We add a blank line + newline after the new section so the MANAGERS
  // header starts cleanly — the old section ended with a trailing blank
  // line, and preserving that is necessary to keep git diffs minimal for
  // files outside the spliced region.
  const head = existingSql.slice(0, startIdx);
  const tail = existingSql.slice(endIdx);
  return `${head}${newPlayersSection}\n\n${tail}`;
}

// ── Main entry point ────────────────────────────────────────────────────────

/**
 * Orchestrate a full generation run:
 *
 *   1. Parse CLI flags (`--dry` for stdout-only mode).
 *   2. Read the current supabase/seed.sql.
 *   3. Create a seeded RNG and generate 22 × 32 = 704 players.
 *   4. Emit the SQL block.
 *   5. Splice it back into the file and write (or print to stdout in dry mode).
 *   6. Print a summary so CI/human runs have a clear signal of what changed.
 *
 * Exits with a non-zero status on any error so CI fails loudly.
 */
async function main(): Promise<void> {
  // ── Parse CLI ───────────────────────────────────────────────────────────
  const isDryRun = process.argv.includes('--dry');

  // ── Load the existing seed.sql ──────────────────────────────────────────
  const seedPath = resolveSeedPath();
  const existingSql = await readFile(seedPath, 'utf8');

  // ── Generate players deterministically ──────────────────────────────────
  const rng = createRng(SEED_STRING);
  const players = generateAllPlayers(rng, TEAMS);

  // ── Emit SQL ────────────────────────────────────────────────────────────
  const newSection = emitPlayersSection(players, TEAMS);

  if (isDryRun) {
    // In dry mode we only print the new players block, not the whole file —
    // diffs in other sections aren't interesting and would flood stdout.
    process.stdout.write(newSection);
    process.stdout.write('\n');
    console.error(
      `\n[generate-seed] dry run: ${players.length} players across ${TEAMS.length} teams ` +
        `(${players.length / TEAMS.length} per team). Not writing to disk.`,
    );
    return;
  }

  // ── Splice and write ────────────────────────────────────────────────────
  const newSql = spliceSeedFile(existingSql, newSection);
  await writeFile(seedPath, newSql, 'utf8');

  // ── Summary ─────────────────────────────────────────────────────────────
  // Print to stderr so stdout stays clean for any future piping use-case.
  console.error(
    `[generate-seed] wrote ${players.length} players across ${TEAMS.length} teams ` +
      `(${players.length / TEAMS.length} per team) to ${seedPath}`,
  );
  console.error(`[generate-seed] seed string: ${SEED_STRING}`);
}

// Top-level await is cleanest, but we use .catch() here so the script exits
// with an explicit non-zero code on any thrown error. Unhandled promise
// rejections would otherwise log-and-continue on older Node, silently
// leaving the seed file unchanged.
main().catch((err) => {
  console.error('[generate-seed] FAILED:', err);
  process.exit(1);
});
