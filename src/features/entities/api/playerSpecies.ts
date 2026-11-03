// ── features/entities/api/playerSpecies.ts ──────────────────────────────────
// Batched read of each player's people (species) from his bio, for the match
// viewer: ONE request for a whole match's squads, never one per player (the
// free-tier database is the constraint; docs/mvp-free-tier.md). Goes through
// the public read cache (`entities` is allow-listed), and the id list is
// de-duplicated and sorted so the same squads always produce the same URL and
// share one cached response on the CDN.
//
// Species is CANON in `entities.meta.profile.species` (src/data/peoples.ts);
// only the viewer reads it, never the match engine.

import type { PublicReadClient } from '@shared/supabase/publicReadClient';

import type { Species } from '../../../data/peoples';
import { parsePlayerSpeciesRows } from './playerSpecies.schema';

/**
 * Fetch the people of every given player entity in one request.
 *
 * @param db         Public read client (read cache).
 * @param entityIds  `players.entity_id` values; nulls and duplicates allowed.
 * @returns          Species (or null) per entity id. Empty on error or when
 *                   no ids are given (no request is made then).
 */
export async function getPlayerSpeciesByEntityId(
  db: PublicReadClient,
  entityIds: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, Species | null>> {
  const ids = [...new Set(entityIds.filter((id): id is string => typeof id === 'string' && id.length > 0))].sort();
  if (ids.length === 0) return new Map();
  const { data, error } = await db
    .from('entities')
    .select('id, species:meta->profile->>species')
    .in('id', ids);
  if (error) {
    console.warn('[playerSpecies] read failed:', error.message);
    return new Map();
  }
  return parsePlayerSpeciesRows(data);
}
