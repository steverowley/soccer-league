// ── scripts/lib/peoplesAssignment.ts ─────────────────────────────────────────
// WHY: A player's people (species) is canon and lives in his bio
// (`entities.meta.profile.species`, with a matching human-readable `race`
// line). The authored bios live in content/profiles/<club>.json, keyed by the
// natural key (team_id, jersey_number); the database knows both that key and
// the player's entity. This module is the ONE place that turns the rules in
// src/data/peoples.ts into concrete per-player values, so the content files
// and the backfill migration (0099) are generated from the same function and
// can never drift apart.
//
// Pure: no file system, no database. scripts/assign-peoples.ts does the I/O.
//
// Nothing here hard-codes a people or a count: every species, mix and race
// line comes from src/data/peoples.ts, so a new people or a changed squad mix
// is picked up by re-running the script.

import {
  assignSquadSpecies,
  isSpecies,
  PEOPLE,
  raceLine,
  speciesForNewPlayer,
  SPECIES,
  type Species,
} from '../../src/data/peoples';

/** One player's people as written into his bio. */
export interface PeopleAssignment {
  team_id: string;
  jersey_number: number;
  species: Species;
  race: string;
}

/** A player with no authored profile (a signing made before creation assigned peoples). */
export interface UnauthoredPlayer {
  player_id: string;
  team_id: string;
}

/** The people for an unauthored player, keyed by his `players.id`. */
export interface UnauthoredAssignment extends UnauthoredPlayer {
  species: Species;
  race: string;
}

/** The fields of a content file this module reads. */
export interface ClubContent {
  team_id: string;
  players?: Array<{ jersey_number: number; race?: unknown } & Record<string, unknown>>;
}

/**
 * The id handed to `assignSquadSpecies` for an existing squad player. The
 * content files carry no UUIDs, so both the files and the database are keyed
 * by the natural key, which both sides know.
 */
export function naturalKey(teamId: string, jerseyNumber: number): string {
  return `${teamId}#${jerseyNumber}`;
}

/** Every non-Terran people's generated race line ("Cephalid (Europa)"). */
const GENERATED_RACE_LINES: ReadonlySet<string> = new Set(
  SPECIES.filter((s) => s !== 'terran').map((s) => raceLine(s)),
);

/** True when a race line was written by `raceLine` for a non-Terran people. */
export function isGeneratedPeopleLine(race: unknown): boolean {
  return typeof race === 'string' && GENERATED_RACE_LINES.has(race);
}

/**
 * The Terran race line a club's squad uses ("Human (Belt-adapted)"): the most
 * common line among its players that is not another people's line, ties
 * broken alphabetically, else "Human". Used only for a player who becomes
 * Terran after a re-run moved him off another people, whose old human line is
 * no longer in the file.
 */
export function clubTerranRace(club: ClubContent): string {
  const counts = new Map<string, number>();
  for (const p of club.players ?? []) {
    if (typeof p.race !== 'string' || !p.race.trim() || isGeneratedPeopleLine(p.race)) continue;
    counts.set(p.race, (counts.get(p.race) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return ranked[0]?.[0] ?? 'Human';
}

/**
 * Assign every player of one club file. Deterministic and idempotent: the
 * species comes from `assignSquadSpecies(team_id, natural keys)` (order
 * independent), and the race line from `raceLine(species, existing race)`, so
 * Terrans keep their authored line and running it twice changes nothing.
 */
export function assignClub(club: ClubContent): PeopleAssignment[] {
  const players = club.players ?? [];
  const keys = players.map((p) => naturalKey(club.team_id, p.jersey_number));
  if (new Set(keys).size !== keys.length) {
    throw new Error(`[peoples] duplicate jersey_number in ${club.team_id}`);
  }
  const bySpecies = assignSquadSpecies(club.team_id, keys);
  const terranFallback = clubTerranRace(club);
  return players.map((p) => {
    const species = bySpecies.get(naturalKey(club.team_id, p.jersey_number));
    if (!species) throw new Error(`[peoples] no species for ${club.team_id} #${p.jersey_number}`);
    const existing = typeof p.race === 'string' ? p.race : null;
    // A Terran whose current line belongs to another people (a re-run after
    // the mix changed) falls back to his club's Terran line.
    const keep = species === 'terran' && isGeneratedPeopleLine(existing) ? terranFallback : existing;
    return { team_id: club.team_id, jersey_number: p.jersey_number, species, race: raceLine(species, keep) };
  });
}

/** People for players with no authored profile, by the creation rule. */
export function assignUnauthored(players: readonly UnauthoredPlayer[]): UnauthoredAssignment[] {
  return players.map((p) => {
    const species = speciesForNewPlayer(p.team_id, p.player_id);
    return { ...p, species, race: raceLine(species) };
  });
}

// ── Content-file rewrite (formatting preserved) ─────────────────────────────

/** JSON-encode a value the way the content files write strings. */
const enc = (v: string): string => JSON.stringify(v);

/**
 * Write `species` (right after `race`) and the new `race` line into every
 * player of one content file, editing the text in place so the file keeps its
 * own layout (one-line player objects in most files, one key per line in
 * others) and line endings. Re-running replaces the values, never duplicates.
 *
 * Throws if the edited text does not parse to exactly the expected object
 * (the original with those two keys set), so a layout this cannot handle
 * fails loud instead of corrupting a bio.
 */
export function applyToContentText(text: string, assignments: readonly PeopleAssignment[]): string {
  const parsed = JSON.parse(text) as ClubContent;
  const byJersey = new Map(assignments.map((a) => [a.jersey_number, a]));
  const playersAt = text.indexOf('"players"');
  if (playersAt < 0) throw new Error('[peoples] content file has no players array');

  // Every player object, in order, is the n-th `"jersey_number": N` after
  // the players key; its `race` is the first `"race":` after that.
  const jerseyRe = /"jersey_number"\s*:\s*(\d+)/g;
  jerseyRe.lastIndex = playersAt;
  const edits: Array<{ start: number; end: number; replacement: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = jerseyRe.exec(text)) !== null) {
    const jersey = Number(m[1]);
    const a = byJersey.get(jersey);
    if (!a) throw new Error(`[peoples] no assignment for jersey ${jersey}`);
    const raceRe = /"race"\s*:\s*("(?:[^"\\]|\\.)*")(\s*,\s*)(?:"species"\s*:\s*"(?:[^"\\]|\\.)*"\s*,\s*)?/g;
    raceRe.lastIndex = m.index;
    const r = raceRe.exec(text);
    const nextJersey = text.indexOf('"jersey_number"', m.index + 1);
    if (!r || (nextJersey >= 0 && r.index > nextJersey)) {
      throw new Error(`[peoples] player #${jersey} has no race field`);
    }
    const sep = r[2] ?? ', ';
    edits.push({
      start: r.index,
      end: r.index + r[0].length,
      replacement: `"race": ${enc(a.race)}${sep}"species": ${enc(a.species)}${sep}`,
    });
  }

  let out = text;
  for (const e of edits.reverse()) out = out.slice(0, e.start) + e.replacement + out.slice(e.end);

  // Safety net: the result must be the original object with race + species
  // set (species placed right after race), and nothing else changed.
  const expected = {
    ...parsed,
    players: (parsed.players ?? []).map((p) => {
      const a = byJersey.get(p.jersey_number)!;
      const next: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(p)) {
        if (k === 'species') continue;
        if (k === 'race') {
          next['race'] = a.race;
          next['species'] = a.species;
        } else next[k] = v;
      }
      return next;
    }),
  };
  if (JSON.stringify(JSON.parse(out)) !== JSON.stringify(expected)) {
    throw new Error(`[peoples] rewrite of ${parsed.team_id} did not round-trip`);
  }
  return out;
}

// ── Migration SQL ────────────────────────────────────────────────────────────

/** Escape a SQL string literal (standard_conforming_strings: double the quote). */
export function sqlText(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

const SLUG = /^[a-z0-9-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Per-species totals for a set of assignments, in `SPECIES` order, with every
 * people listed (zero included).
 */
export function speciesTotals(rows: ReadonlyArray<{ species: Species }>): Record<Species, number> {
  const out = Object.fromEntries(SPECIES.map((s) => [s, 0])) as Record<Species, number>;
  for (const r of rows) out[r.species] += 1;
  return out;
}

/** The SET expression shared by both updates: only `profile.race` and `profile.species`. */
const SET_PROFILE = `meta = jsonb_set(
  jsonb_set(
    CASE
      WHEN jsonb_typeof(e.meta -> 'profile') = 'object' THEN e.meta
      ELSE jsonb_set(COALESCE(e.meta, '{}'::jsonb), '{profile}', '{}'::jsonb)
    END,
    '{profile,race}', to_jsonb(target.race)
  ),
  '{profile,species}', to_jsonb(target.species)
)`;

/** The guard shared by both updates: only rows whose values differ. */
const GUARD = `e.kind = 'player'
  AND (e.meta IS NULL OR jsonb_typeof(e.meta) = 'object')
  AND (
    (e.meta -> 'profile' ->> 'species') IS DISTINCT FROM target.species
    OR (e.meta -> 'profile' ->> 'race') IS DISTINCT FROM target.race
  )`;

/**
 * Build migration 0099 from the assignments. Idempotent (IS DISTINCT FROM
 * guard), touches only `meta.profile.race` and `meta.profile.species`
 * (creating `meta.profile` with just those two keys when absent), and every
 * value is validated and quoted before it is written.
 */
export function buildMigrationSql(
  squads: readonly PeopleAssignment[],
  unauthored: readonly UnauthoredAssignment[],
): string {
  for (const a of squads) {
    if (!SLUG.test(a.team_id) || !Number.isInteger(a.jersey_number) || !isSpecies(a.species)) {
      throw new Error(`[peoples] refusing to emit a malformed row: ${JSON.stringify(a)}`);
    }
  }
  for (const a of unauthored) {
    if (!UUID.test(a.player_id) || !SLUG.test(a.team_id) || !isSpecies(a.species)) {
      throw new Error(`[peoples] refusing to emit a malformed row: ${JSON.stringify(a)}`);
    }
  }

  const totals = speciesTotals([...squads, ...unauthored]);
  const totalsLines = SPECIES.map((s) => `--   ${PEOPLE[s].plural.padEnd(12)} ${String(totals[s]).padStart(3)}`);
  const squadValues = squads
    .map((a) => `    (${sqlText(a.team_id)}, ${a.jersey_number}, ${sqlText(a.species)}, ${sqlText(a.race)})`)
    .join(',\n');
  const unauthoredValues = unauthored
    .map((a) => `    (${sqlText(a.player_id)}::uuid, ${sqlText(a.species)}, ${sqlText(a.race)})`)
    .join(',\n');

  const lines = [
    '-- 0099_player_peoples.sql',
    '--',
    "-- Every player's people (species) becomes canon in his bio. Owner decision",
    `-- (2026-10-28): ${SPECIES.length} peoples play in the league, Terrans plus the`,
    '-- peoples who always lived on their own worlds and were taught football by',
    "-- the colonists. A player's people lives in entities.meta.profile.species,",
    '-- with a matching human-readable entities.meta.profile.race line; the match',
    '-- viewer draws him from it and the match engine never reads it.',
    '--',
    '-- GENERATED by `npx tsx scripts/assign-peoples.ts --sql` from',
    '-- content/profiles/*.json and src/data/peoples.ts. Do not edit by hand:',
    '-- change the module or the content and regenerate (a test holds this file',
    '-- equal to the generator output).',
    '--',
    '-- 1. Squad players: species from assignSquadSpecies(team_id, natural keys',
    "--    `team_id#jersey_number`), which honours each club's SQUAD_MIX exactly.",
    '--    Joined to players on (team_id, jersey_number) to reach entity_id.',
    '-- 2. Players with no authored profile: species from',
    '--    speciesForNewPlayer(team_id, players.id), the rule every creation path',
    '--    now applies at signing.',
    '--',
    '-- Safe to re-run: only rows whose species or race differ are written, and',
    '-- only those two keys of meta.profile change (meta.profile is created with',
    '-- just those keys when a player has none).',
    '--',
    `-- Players covered: ${squads.length + unauthored.length}. Per people:`,
    ...totalsLines,
    '',
    'WITH t(team_id, jersey_number, species, race) AS (',
    '  VALUES',
    squadValues,
    '),',
    'target AS (',
    '  SELECT p.entity_id, t.species, t.race',
    '  FROM t',
    '  JOIN players p ON p.team_id = t.team_id AND p.jersey_number = t.jersey_number',
    '  WHERE p.entity_id IS NOT NULL',
    ')',
    'UPDATE entities e',
    `SET ${SET_PROFILE}`,
    'FROM target',
    'WHERE e.id = target.entity_id',
    `  AND ${GUARD};`,
    '',
  ];
  if (unauthored.length > 0) {
    lines.push(
      'WITH t(player_id, species, race) AS (',
      '  VALUES',
      unauthoredValues,
      '),',
      'target AS (',
      '  SELECT p.entity_id, t.species, t.race',
      '  FROM t',
      '  JOIN players p ON p.id = t.player_id',
      '  WHERE p.entity_id IS NOT NULL',
      ')',
      'UPDATE entities e',
      `SET ${SET_PROFILE}`,
      'FROM target',
      'WHERE e.id = target.entity_id',
      `  AND ${GUARD};`,
      '',
    );
  }
  const sql = lines.join('\n');
  if (sql.includes('\u2014')) throw new Error('[peoples] generated SQL contains an em dash');
  return sql;
}

/**
 * Parse the squad VALUES rows back out of a generated migration (for the
 * test that holds the committed file to the content files).
 */
export function parseSquadValues(sql: string): PeopleAssignment[] {
  const re = /^\s*\('((?:[^']|'')*)', (\d+), '((?:[^']|'')*)', '((?:[^']|'')*)'\),?$/gm;
  const out: PeopleAssignment[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const unq = (s: string) => s.replace(/''/g, "'");
    const species = unq(m[3]!);
    if (!isSpecies(species)) throw new Error(`[peoples] bad species in SQL: ${species}`);
    out.push({ team_id: unq(m[1]!), jersey_number: Number(m[2]), species, race: unq(m[4]!) });
  }
  return out;
}
