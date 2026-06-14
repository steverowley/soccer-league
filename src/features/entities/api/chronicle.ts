// ── features/entities/api/chronicle.ts ───────────────────────────────────────
// The Chronicle read surface (research WS-A2, issue #575).
//
// WHY THIS EXISTS
//   Migration 0076 promoted `narratives` into a structured history log: every
//   row now carries normalized `action`, `actor_entity_id`, `target_entity_id`,
//   `place_entity_id`, `season_id`, `tick`, and `importance` columns alongside
//   the rendered `summary` prose. This module is the typed, queryable read over
//   that substrate — the thing entity feuds (#584), state-aware Architect pacing
//   (#582), and the public data surface (#592) will read from.
//
// WHY A SEPARATE SCHEMA FROM `NarrativeSchema`
//   The existing `NarrativeSchema` (entities.schema.ts) constrains `source` to a
//   strict 4-value enum, which silently drops training / ceremony / wager /
//   referee narratives at the boundary. That's fine for the curated `/news`
//   feed, but a *history log* must not lose real events just because their
//   source tag is new — so the Chronicle parses `source` permissively. The
//   `/news` path is intentionally left untouched.

import type { IslSupabaseClient } from '@shared/supabase/client';
import { z } from 'zod';

// ── Row schema ──────────────────────────────────────────────────────────────

/**
 * A structured Chronicle event = one `narratives` row after migration 0076.
 *
 * `summary` stays the rendered prose field (never the source of truth). The
 * structured columns are nullable because the auto-fill trigger derives them
 * best-effort and writers only set what they know. `entities_involved` is
 * coerced from a possibly-null jsonb array into a plain `string[]` so a row with
 * no participants never drops from the log.
 */
export const ChronicleEventSchema = z.object({
  id:                z.string(),
  kind:              z.string(),
  action:            z.string().nullable(),
  summary:           z.string(),
  actor_entity_id:   z.string().nullable(),
  target_entity_id:  z.string().nullable(),
  place_entity_id:   z.string().nullable(),
  season_id:         z.string().nullable(),
  tick:              z.number().nullable(),
  importance:        z.number(),
  // jsonb id array; PostgREST serialises uuids/slugs as strings. null → [].
  entities_involved: z.array(z.string()).nullable().transform((v) => v ?? []),
  // Permissive on purpose — see module header. The Chronicle keeps every event.
  source:            z.string(),
  created_at:        z.string(),
});

export type ChronicleEvent = z.infer<typeof ChronicleEventSchema>;

/**
 * Parse raw Chronicle rows. Malformed entries warn-log and drop (mirroring the
 * `parseNarrativeRows` drift-tolerance pattern) so a single bad row degrades the
 * log gracefully instead of crashing a consumer.
 *
 * @param rows  Raw rows from `.select('*')`.
 * @param tag   Caller label for the warn-log prefix.
 */
export function parseChronicleRows(rows: unknown[], tag: string): ChronicleEvent[] {
  const out: ChronicleEvent[] = [];
  for (const row of rows) {
    const parsed = ChronicleEventSchema.safeParse(row);
    if (parsed.success) {
      out.push(parsed.data);
    } else {
      console.warn(`[${tag}] dropped malformed chronicle row:`, parsed.error.issues);
    }
  }
  return out;
}

// ── Query ─────────────────────────────────────────────────────────────────

/**
 * Filters for {@link getChronicle}. Every field is optional; omitting all of
 * them returns the most-recent slice of the whole Chronicle. Filters compose
 * (AND), so e.g. `{ seasonId, action: 'feud' }` returns this season's feuds.
 */
export interface ChronicleQuery {
  /** Events whose primary actor is this id (a team id reads as "this club"). */
  actorEntityId?: string;
  /** Events whose place/planet is this entity id. */
  placeEntityId?: string;
  /** Events stamped to this season. */
  seasonId?: string;
  /** Normalized action bucket, e.g. 'commentary', 'feud', 'decree'. */
  action?: string;
  /** Raw narrative kind, e.g. 'pundit_takes'. */
  kind?: string;
  /**
   * Events that mention this id anywhere in `entities_involved` (actor, target,
   * or any other participant) — the broadest "about this entity" query.
   */
  involvingEntityId?: string;
  /** Maximum rows, newest first (default 50). */
  limit?: number;
}

/**
 * Read the Chronicle, newest first, filtered by any combination of actor,
 * place/planet, season, action, kind, or participant. This is the structured
 * counterpart to `getRecentNarratives` (which serves the curated `/news` feed);
 * it queries the same table but exposes the normalized columns and keeps every
 * source. On error it warn-logs and returns `[]` so a consumer never throws.
 *
 * @param db     Injected Supabase client.
 * @param query  Optional {@link ChronicleQuery} filters.
 * @returns      Matching Chronicle events, newest first (validated, drift-tolerant).
 */
export async function getChronicle(
  db: IslSupabaseClient,
  query: ChronicleQuery = {},
): Promise<ChronicleEvent[]> {
  const { actorEntityId, placeEntityId, seasonId, action, kind, involvingEntityId, limit = 50 } = query;

  let q = db
    .from('narratives')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (actorEntityId)     q = q.eq('actor_entity_id', actorEntityId);
  if (placeEntityId)     q = q.eq('place_entity_id', placeEntityId);
  if (seasonId)          q = q.eq('season_id', seasonId);
  if (action)            q = q.eq('action', action);
  if (kind)              q = q.eq('kind', kind);
  if (involvingEntityId) q = q.contains('entities_involved', [involvingEntityId]);

  const { data, error } = await q;
  if (error) {
    console.warn('[getChronicle] failed:', error.message);
    return [];
  }
  return parseChronicleRows((data ?? []) as unknown[], 'getChronicle');
}
