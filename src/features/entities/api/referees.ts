// ── entities/api/referees.ts ──────────────────────────────────────────────────
// Phase 5a: Supabase queries for the IEOB referee corps and per-match
// referee assignment.  All functions take an injected client (no module-
// level singleton import) so callers can swap fakes in unit tests.
//
// TABLES / VIEWS USED:
//   entities (kind='referee')               — seeded in 0002_entities.sql
//   entity_traits (trait_key='strictness')  — seeded in 0002_entities.sql
//   matches.referee_id                      — added in 0015_match_referee.sql
//   match_referee_v                         — convenience view in 0015
// ──────────────────────────────────────────────────────────────────────────────

import type { IslSupabaseClient } from '@shared/supabase/client';

// ── Public shapes ─────────────────────────────────────────────────────────────

/**
 * A referee entity joined with its `strictness` trait.
 * Returned by getRefereesWithStrictness() and used by the assignment picker.
 *
 * `strictness` defaults to 5 (medium) when no trait row exists — mirrors the
 * fallback in the match_referee_v view so client-side and server-side reads
 * never disagree.
 */
export interface RefereeWithStrictness {
  id: string;
  name: string;
  display_name: string | null;
  strictness: number;
}

// ── Reads ─────────────────────────────────────────────────────────────────────

/**
 * Fetch every referee entity with its strictness trait in a single round-trip.
 *
 * Joins entities → entity_traits via a Supabase nested embed, then flattens
 * the result so callers receive a clean array of {id, name, display_name,
 * strictness}.  This is the input to the assignment picker — pre-fetched once
 * per scheduling pass rather than re-queried per match.
 *
 * Strictness defaults to 5 (medium) when a referee has no trait row, matching
 * the behaviour of match_referee_v.  Trait values are stored as JSONB so we
 * cast through `number` defensively in case future seeds use string scalars.
 *
 * @param db  Injected Supabase client.
 * @returns   Array of referees with strictness, sorted by name for stable iteration.
 */
export async function getRefereesWithStrictness(
  db: IslSupabaseClient,
): Promise<RefereeWithStrictness[]> {
  const { data, error } = await db
    .from('entities')
    .select(`
      id,
      name,
      display_name,
      entity_traits!entity_id ( trait_key, trait_value )
    `)
    .eq('kind', 'referee')
    .order('name');

  if (error) {
    console.warn('[getRefereesWithStrictness] failed:', error.message);
    return [];
  }

  // Flatten the embedded traits array into a single `strictness` number.
  // Falls back to 5 if the trait is missing or non-numeric.
  return ((data ?? []) as Array<{
    id: string;
    name: string;
    display_name: string | null;
    entity_traits?: Array<{ trait_key: string; trait_value: unknown }>;
  }>).map(row => {
    const trait = row.entity_traits?.find(t => t.trait_key === 'strictness');
    const raw = trait?.trait_value;
    // trait_value is JSONB; tolerate number, numeric-string, or missing.
    const strictness = typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && Number.isFinite(Number(raw))
        ? Number(raw)
        : 5;
    return {
      id: row.id,
      name: row.name,
      display_name: row.display_name,
      strictness,
    };
  });
}
