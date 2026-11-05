// ── scripts/assign-peoples.test.ts ───────────────────────────────────────────
// Holds the authored bios and the backfill migration to the peoples module:
//   • every player in every club content file has a valid species, written
//     right after his race line, and the race line matches it;
//   • every club's species counts equal its SQUAD_MIX exactly;
//   • Terrans keep the race line they were authored with;
//   • the committed 0099 migration is exactly the generator output, and its
//     VALUES list matches the content files row for row;
//   • the rewrite is idempotent and preserves each file's layout.
// Nothing here hard-codes a people or a count: all of it comes from
// src/data/peoples.ts, so a new people or a changed mix only needs a re-run of
// `npx tsx scripts/assign-peoples.ts --sql`.

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  isSpecies,
  mixFor,
  raceLine,
  speciesForNewPlayer,
  SPECIES,
  SQUAD_MIX,
  type Species,
} from '../src/data/peoples';
import { parseProfile } from '../src/features/entities/logic/entityProfile';

import {
  clubFiles,
  generateMigration,
  leagueAssignment,
  MIGRATION_FILE,
  readUnauthored,
} from './assign-peoples';
import {
  applyToContentText,
  assignClub,
  assignUnauthored,
  buildMigrationSql,
  isGeneratedPeopleLine,
  parseSquadValues,
  sqlText,
  type ClubContent,
} from './lib/peoplesAssignment';

type Player = { jersey_number: number; race: string; species: string } & Record<string, unknown>;

const files = clubFiles().map((path) => {
  const text = readFileSync(path, 'utf8');
  return { path, text, json: JSON.parse(text) as ClubContent & { players: Player[] } };
});

/** Players per people in one squad. */
function countBySpecies(players: ReadonlyArray<{ species: string }>): Partial<Record<Species, number>> {
  const out: Partial<Record<Species, number>> = {};
  for (const p of players) if (isSpecies(p.species)) out[p.species] = (out[p.species] ?? 0) + 1;
  return out;
}

describe('content/profiles: every player has a people', () => {
  it('covers every club in SQUAD_MIX with a content file', () => {
    expect(files.map((f) => f.json.team_id).sort()).toEqual(Object.keys(SQUAD_MIX).sort());
  });

  for (const { path, json } of files) {
    describe(basename(path), () => {
      it('gives every player a valid species, placed right after race, with a matching race line', () => {
        for (const p of json.players) {
          expect(isSpecies(p.species), `#${p.jersey_number}`).toBe(true);
          const keys = Object.keys(p);
          expect(keys.indexOf('species')).toBe(keys.indexOf('race') + 1);
          if (p.species === 'terran') {
            expect(isGeneratedPeopleLine(p.race), `#${p.jersey_number} ${p.race}`).toBe(false);
            expect(p.race.trim().length).toBeGreaterThan(0);
          } else {
            expect(p.race).toBe(raceLine(p.species as Species));
          }
          // The authored profile still validates against the (stricter) authoring schema.
          const profile = Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'jersey_number'));
          expect(() => parseProfile('player', profile)).not.toThrow();
        }
      });

      it("matches the club's squad mix exactly", () => {
        const mix = mixFor(json.team_id);
        const expected: Partial<Record<Species, number>> = {};
        for (const s of SPECIES) if ((mix[s] ?? 0) > 0) expected[s] = mix[s];
        expect(countBySpecies(json.players)).toEqual(expected);
      });

      it('is what the assignment produces (re-running the script changes nothing)', () => {
        const assigned = assignClub(json);
        expect(json.players.map((p) => [p.jersey_number, p.species, p.race])).toEqual(
          assigned.map((a) => [a.jersey_number, a.species, a.race]),
        );
      });
    });
  }
});

describe('Terran race lines are kept', () => {
  it('leaves an authored Terran line exactly as written', () => {
    const club = {
      team_id: 'nowhere-fc', // unknown club: all-Terran mix
      players: [
        { jersey_number: 1, race: 'Human (Mars-adapted)' },
        { jersey_number: 2, race: 'Orbital Colonist' },
        { jersey_number: 3, race: 'Human' },
      ],
    };
    expect(assignClub(club).map((x) => [x.species, x.race])).toEqual([
      ['terran', 'Human (Mars-adapted)'],
      ['terran', 'Orbital Colonist'],
      ['terran', 'Human'],
    ]);
  });
});

describe('applyToContentText', () => {
  const oneLine = [
    '{',
    '  "team_id": "europa-oceanic",',
    '  "players": [',
    '    { "jersey_number": 1, "gender": "Male", "race": "Human (Europa-adapted)", "bio": "It\'s \\"him\\"." },',
    '    { "jersey_number": 2, "gender": "Male", "race": "Human", "bio": "B" }',
    '  ]',
    '}',
    '',
  ].join('\r\n');

  it('inserts species right after race, keeps CRLF and layout, and is idempotent', () => {
    const club = JSON.parse(oneLine) as ClubContent;
    const a = assignClub(club);
    const once = applyToContentText(oneLine, a);
    expect(once.split('\r\n').length).toBe(oneLine.split('\r\n').length);
    expect(once).toContain(`"race": ${JSON.stringify(a[0]!.race)}, "species": ${JSON.stringify(a[0]!.species)}, "bio"`);
    expect(applyToContentText(once, assignClub(JSON.parse(once) as ClubContent))).toBe(once);
  });

  it('handles one-key-per-line player objects', () => {
    const multi = JSON.stringify(JSON.parse(oneLine), null, 2).replace(/\n/g, '\r\n');
    const out = applyToContentText(multi, assignClub(JSON.parse(multi) as ClubContent));
    expect(out).toMatch(/"race": "[^"]+",\r\n {6}"species": "[a-z]+",\r\n {6}"bio"/);
  });

  it('gives a player who becomes Terran his club Terran line, not another people line', () => {
    const club = {
      team_id: 'nowhere-fc', // unknown club: all-Terran mix
      players: [
        { jersey_number: 1, race: raceLine('cephalid') },
        { jersey_number: 2, race: 'Human (Belt-adapted)' },
        { jersey_number: 3, race: 'Human (Belt-adapted)' },
      ],
    };
    expect(assignClub(club).map((x) => x.race)).toEqual(['Human (Belt-adapted)', 'Human (Belt-adapted)', 'Human (Belt-adapted)']);
  });
});

describe('0099 migration', () => {
  const committed = readFileSync(MIGRATION_FILE, 'utf8').replace(/\r\n/g, '\n');

  it('is exactly the generator output (regenerate with --sql)', () => {
    expect(committed).toBe(generateMigration());
  });

  it('has a VALUES row for every content player with the same species and race', () => {
    const rows = parseSquadValues(committed);
    const content = files.flatMap(({ json }) =>
      json.players.map((p) => ({ team_id: json.team_id, jersey_number: p.jersey_number, species: p.species, race: p.race })),
    );
    const key = (r: { team_id: string; jersey_number: number }) => `${r.team_id}#${r.jersey_number}`;
    expect(rows.map(key).sort()).toEqual(content.map(key).sort());
    const byKey = new Map(rows.map((r) => [key(r), r]));
    for (const c of content) expect(byKey.get(key(c))).toEqual(c);
    expect(rows).toEqual(leagueAssignment().squads);
  });

  it('gives each unauthored player the creation rule (speciesForNewPlayer)', () => {
    for (const a of assignUnauthored(readUnauthored())) {
      expect(a.species).toBe(speciesForNewPlayer(a.team_id, a.player_id));
      expect(committed).toContain(`(${sqlText(a.player_id)}::uuid, ${sqlText(a.species)}, ${sqlText(a.race)})`);
    }
  });

  it('is guarded, touches only profile.race and profile.species, and has no em dash', () => {
    expect(committed).toContain('IS DISTINCT FROM target.species');
    expect(committed).toContain('IS DISTINCT FROM target.race');
    expect(committed).not.toMatch(/\bDELETE\b|\bINSERT\b|\bDROP\b|\bTRUNCATE\b/i);
    const sets = committed.match(/'\{[a-z_,]+\}'/g) ?? [];
    expect(new Set(sets)).toEqual(new Set(["'{profile}'", "'{profile,race}'", "'{profile,species}'"]));
    expect(committed).not.toContain('\u2014');
  });

  it('escapes quotes in text values', () => {
    const sql = buildMigrationSql(
      [{ team_id: 'vesta', jersey_number: 1, species: 'terran', race: "Human (O'Neill-adapted)" }],
      [],
    );
    expect(sql).toContain("'Human (O''Neill-adapted)'");
    expect(parseSquadValues(sql)[0]!.race).toBe("Human (O'Neill-adapted)");
  });

  it('refuses malformed rows', () => {
    expect(() =>
      buildMigrationSql([{ team_id: "x'; drop", jersey_number: 1, species: 'terran', race: 'Human' }], []),
    ).toThrow();
  });
});
