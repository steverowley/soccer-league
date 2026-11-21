// scripts/snapshot-isl-squads.mjs
// Writes src/features/match/logic/calibration/islSquads.json: every ISL club
// exactly as the match worker hands it to the engine (players with their five
// attribute columns, starter flag and personality, the manager's formation,
// style and game model), read from the LIVE league through the public read
// cache (CDN-cached, costs the database nothing).
//
// Why: the calibration contract (spatial/matchDistributions.test.ts) and the
// real-squad batches (scripts/batch-json.ts MODE=isl) measure the engine on
// the squads the league actually plays with.  Re-run it when squads change a
// lot (a new season's signings) and re-measure; a snapshot keeps the test
// byte-stable between runs.
//
//   node scripts/snapshot-isl-squads.mjs [date-label]
//
// The worker's own rules (supabase/functions/match-worker/index.ts):
//   personality = entity_traits 'personality' of the player's entity, else
//   the players.personality column; game model = the manager entity's
//   meta.game_model.  Players are stored in jersey order (the worker's embed
//   has no order, so this pins one), inactive players are left out.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'https://soccer-league-one.vercel.app/api/db/rest/v1';
const OUT = join(process.cwd(), 'src', 'features', 'match', 'logic', 'calibration', 'islSquads.json');

async function get(path) {
  const res = await fetch(`${BASE}/${path}`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

const teams = await get('teams?select=id,league_id&order=id.asc');
const players = await get('players?select=team_id,name,position,jersey_number,starter,is_active,attacking,defending,mental,athletic,technical,personality,entity_id&order=team_id.asc,jersey_number.asc&limit=2000');
const managers = await get('managers?select=team_id,style,preferred_formation,entity_id&limit=200');
const managerEntities = await get('entities?select=id,meta->game_model&kind=eq.manager&limit=200');
const traits = await get('entity_traits?select=entity_id,trait_value&trait_key=eq.personality&limit=5000');

const gmByEntity = new Map(managerEntities.map((e) => [e.id, e.game_model ?? null]));
const traitByEntity = new Map(traits.filter((t) => typeof t.trait_value === 'string').map((t) => [t.entity_id, t.trait_value]));

const clubs = [];
for (const t of teams) {
  const mgr = managers.find((m) => m.team_id === t.id);
  const squad = players.filter((p) => p.team_id === t.id && p.is_active !== false);
  if (squad.length < 11) throw new Error(`${t.id}: only ${squad.length} active players`);
  clubs.push({
    id: t.id,
    league: t.league_id,
    f: mgr?.preferred_formation ?? '4-4-2',
    s: mgr?.style ?? 'Balanced',
    gm: (mgr && gmByEntity.get(mgr.entity_id)) ?? null,
    // [jersey, name, position, starter, attacking, defending, mental, athletic, technical, personality]
    ps: squad.map((p) => [
      p.jersey_number, p.name, p.position, p.starter !== false,
      p.attacking, p.defending, p.mental, p.athletic, p.technical,
      (p.entity_id && traitByEntity.get(p.entity_id)) ?? p.personality ?? null,
    ]),
  });
}

const label = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const body = { snapshot: label, source: 'live league via the read cache (scripts/snapshot-isl-squads.mjs)', clubs };
writeFileSync(OUT, JSON.stringify(body, null, 0).replace(/\{"id"/g, '\n{"id"') + '\n');
console.log(`wrote ${clubs.length} clubs, ${clubs.reduce((s, c) => s + c.ps.length, 0)} players to ${OUT}`);
const byLeague = {};
for (const c of clubs) (byLeague[c.league] ??= []).push(c.id);
for (const [l, ids] of Object.entries(byLeague)) console.log(l, ids.length, ids.join(' '));
