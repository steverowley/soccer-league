// ── features/entities/api/playerSpecies.schema.ts ───────────────────────────
// Zod boundary for the batched "which people is each player" read that feeds
// the match viewer. The read selects only the entity id and the bio's species
// path (`meta->profile->>species`), so each row is `{ id, species }` where
// species is whatever text the bio holds, or null when he has none yet.
//
// Drift policy: a row without a string id is dropped with a warning (it cannot
// be matched to a player). An unknown or missing species is NOT an error: it
// maps to null and the viewer falls back, so a pre-backfill bio or a people
// added after this build never hides a player.

import { z } from 'zod';

import { isSpecies, type Species } from '../../../data/peoples';

/** One `{ id, species }` row from the batched entities read. */
export const PlayerSpeciesRowSchema = z.object({
  id: z.string(),
  species: z.unknown().optional(),
});

export type PlayerSpeciesRow = z.infer<typeof PlayerSpeciesRowSchema>;

/**
 * Validate the rows and map entity id to species. Rows that fail the schema
 * are dropped (logged); a species that is not one of the peoples maps to null.
 *
 * @param rows  Raw rows from PostgREST.
 * @returns     Species (or null) per entity id.
 */
export function parsePlayerSpeciesRows(rows: unknown): Map<string, Species | null> {
  const out = new Map<string, Species | null>();
  if (!Array.isArray(rows)) return out;
  for (const raw of rows) {
    const parsed = PlayerSpeciesRowSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn('[playerSpecies] dropped malformed row:', parsed.error.message);
      continue;
    }
    out.set(parsed.data.id, isSpecies(parsed.data.species) ? parsed.data.species : null);
  }
  return out;
}
