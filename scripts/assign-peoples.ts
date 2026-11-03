// ── scripts/assign-peoples.ts ────────────────────────────────────────────────
// Writes every player's people (species) into his authored bio, and generates
// the backfill migration for the live database from the same assignment.
//
// USAGE
//   npx tsx scripts/assign-peoples.ts          rewrite content/profiles/*.json
//   npx tsx scripts/assign-peoples.ts --sql    also (re)write
//                                              supabase/migrations/0099_player_peoples.sql
//   npx tsx scripts/assign-peoples.ts --check  fail if anything is out of date
//
// WHAT IT DOES
//   For each club file: species per player from
//   assignSquadSpecies(team_id, `${team_id}#${jersey_number}`) (src/data/peoples.ts),
//   race line from raceLine(species, existing race). `species` is written right
//   after `race`, keeping each file's own layout and line endings. Idempotent:
//   a second run changes nothing. Re-run it whenever the peoples module changes
//   (a new people, a changed squad mix) and commit the result.
//
//   Players with no authored profile (content/peoples/unauthored-players.json)
//   get speciesForNewPlayer(team_id, player_id), the creation rule.
//
// It never touches the database: the parent applies the generated migration.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  applyToContentText,
  assignClub,
  assignUnauthored,
  buildMigrationSql,
  speciesTotals,
  type ClubContent,
  type PeopleAssignment,
  type UnauthoredPlayer,
} from './lib/peoplesAssignment';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PROFILES_DIR = join(ROOT, 'content', 'profiles');
export const UNAUTHORED_FILE = join(ROOT, 'content', 'peoples', 'unauthored-players.json');
export const MIGRATION_FILE = join(ROOT, 'supabase', 'migrations', '0099_player_peoples.sql');

/** Club content files (those carrying a team_id and a players array), sorted. */
export function clubFiles(): string[] {
  return readdirSync(PROFILES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => join(PROFILES_DIR, f))
    .filter((path) => {
      const j = JSON.parse(readFileSync(path, 'utf8')) as Partial<ClubContent>;
      return typeof j.team_id === 'string' && Array.isArray(j.players);
    });
}

/** Read the players with no authored profile. */
export function readUnauthored(): UnauthoredPlayer[] {
  const j = JSON.parse(readFileSync(UNAUTHORED_FILE, 'utf8')) as { players: UnauthoredPlayer[] };
  return j.players.map(({ player_id, team_id }) => ({ player_id, team_id }));
}

/** The full league assignment, computed from the content files as they stand. */
export function leagueAssignment(): { squads: PeopleAssignment[]; byFile: Map<string, PeopleAssignment[]> } {
  const byFile = new Map<string, PeopleAssignment[]>();
  for (const path of clubFiles()) {
    byFile.set(path, assignClub(JSON.parse(readFileSync(path, 'utf8')) as ClubContent));
  }
  return { squads: [...byFile.values()].flat(), byFile };
}

/** Generate the migration text from the current content files. */
export function generateMigration(): string {
  return buildMigrationSql(leagueAssignment().squads, assignUnauthored(readUnauthored()));
}

function main(argv: readonly string[]): void {
  const check = argv.includes('--check');
  const sql = argv.includes('--sql');
  const stale: string[] = [];

  const { byFile } = leagueAssignment();
  for (const [path, assignments] of byFile) {
    const text = readFileSync(path, 'utf8');
    const next = applyToContentText(text, assignments);
    if (next === text) continue;
    if (check) stale.push(path);
    else writeFileSync(path, next);
  }

  // Recompute after the rewrite so the SQL reflects the files on disk.
  const squads = leagueAssignment().squads;
  const unauthored = assignUnauthored(readUnauthored());
  if (sql || check) {
    const migration = buildMigrationSql(squads, unauthored);
    let current = '';
    try {
      current = readFileSync(MIGRATION_FILE, 'utf8');
    } catch {
      current = '';
    }
    if (current !== migration) {
      if (check) stale.push(MIGRATION_FILE);
      else writeFileSync(MIGRATION_FILE, migration);
    }
  }

  const totals = speciesTotals([...squads, ...unauthored]);
  console.log(`[assign-peoples] ${squads.length} squad players + ${unauthored.length} unauthored`);
  console.log(JSON.stringify(totals));
  if (stale.length > 0) {
    console.error(`[assign-peoples] out of date:\n  ${stale.join('\n  ')}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
