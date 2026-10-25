// scripts/lib/islSquads.ts
// Real ISL squads for measurement scripts, built from supabase/seed.sql (the
// players' position, rating, personality and starter flag) plus each club's
// manager (style, formation) and his seeded game model
// (scripts/seed/manager-game-models.json, the source the 0089 migration is
// generated from).  The seed carries one overall rating per player, so the
// five attribute columns are all set to it; toSpatialTeamInput then derives
// the engine stats exactly as the worker does for a DB row.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SpatialTeamInput } from '../../src/features/match/logic/spatial/simulateSpatialMatch';
import { toSpatialTeamInput } from '../../src/features/match/logic/spatial/spatialEventAdapter';

/** Scripts run from the repository root. */
const ROOT = process.cwd();

export interface ManagerSeed {
  club: string;
  manager: string;
  style: string;
  formation: string;
  game_model: Record<string, unknown>;
  rationale: string[];
}

/** Every manager's seeded game model, keyed by club id. */
export function managerSeeds(): Record<string, ManagerSeed> {
  const raw = JSON.parse(readFileSync(join(ROOT, 'scripts', 'seed', 'manager-game-models.json'), 'utf8')) as ManagerSeed[];
  const out: Record<string, ManagerSeed> = {};
  for (const m of raw) out[m.club] = m;
  return out;
}

interface SeedPlayer { name: string; position: string; rating: number; personality: string; starter: boolean }

let cache: Map<string, SeedPlayer[]> | null = null;

function seedPlayers(): Map<string, SeedPlayer[]> {
  if (cache) return cache;
  const sql = readFileSync(join(ROOT, 'supabase', 'seed.sql'), 'utf8');
  const re = /\('([a-z-]+)','([^']+(?:''[^']*)*)','(GK|DF|MF|FW)','[^']*',\d+,(\d+),'([a-z_]+)',(true|false)\)/g;
  cache = new Map();
  for (const m of sql.matchAll(re)) {
    const list = cache.get(m[1]!) ?? [];
    list.push({ name: m[2]!, position: m[3]!, rating: Number(m[4]), personality: m[5]!, starter: m[6] === 'true' });
    cache.set(m[1]!, list);
  }
  return cache;
}

/**
 * One club as the engine would see it.  `withModel` false drops the seeded
 * game model so the style preset alone applies.
 */
export function islTeam(club: string, withModel = true): SpatialTeamInput {
  const players = seedPlayers().get(club);
  if (!players || players.length < 11) throw new Error(`no seeded squad for ${club}`);
  const mgr = managerSeeds()[club];
  const input = toSpatialTeamInput({
    managers: [{
      preferred_formation: mgr?.formation ?? '4-4-2',
      style: mgr?.style ?? 'Balanced',
      ...(withModel && mgr ? { game_model: mgr.game_model } : {}),
    }],
    players: players.map((p, i) => ({
      id: `${club}-${i}`,
      name: p.name,
      position: p.position,
      starter: p.starter,
      is_active: true,
      attacking: p.rating, defending: p.rating, mental: p.rating, athletic: p.rating, technical: p.rating,
    })),
  });
  const byName = new Map(players.map((p) => [p.name, p.personality]));
  for (const p of [...input.players, ...(input.bench ?? [])]) p.personality = byName.get(p.name) ?? null;
  return input;
}
