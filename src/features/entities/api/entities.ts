// ── entities.ts ──────────────────────────────────────────────────────────────
// WHY: Supabase queries for the unified entity model. The Architect's context
// hydration (Phase 5.1) and the news feed (Phase 8) read from these queries.
// All queries take an injected Supabase client; no direct imports.
//
// NOTE: The `entities`, `entity_traits`, `entity_relationships`, and
// `narratives` tables are created by migration 0002_entities.sql, which
// hasn't been applied yet — so database.ts doesn't include them. We cast
// to `any` (marked CAST:entities) until types are regenerated.

import type { IslSupabaseClient } from '@shared/supabase/client';
import type { Narrative } from '../types';

// TYPE ESCAPE HATCH — see profiles.ts for the pattern explanation.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

// ── Narrative queries ───────────────────────────────────────────────────────

/**
 * Fetch recent narratives, optionally filtered by source and/or kind.
 *
 * The Architect loads the most recent N narratives into its context window
 * at the start of each match so it can reference them in commentary and
 * decisions.  The NewsFeedPage uses the same helper but passes a `kind`
 * filter so that low-frequency kinds (Balance/Chaos cap at 1/day) aren't
 * silently dropped by a client-side filter that only sees the newest
 * `limit + 1` rows.  Server-side filtering with `.eq('kind', kind)`
 * guarantees the page always finds matching rows when any exist.
 *
 * @param db      Injected Supabase client.
 * @param limit   Maximum number of narratives to return (default 50).
 * @param source  Optional source filter ('architect', 'match', 'scheduled').
 * @param kind    Optional kind filter ('architect_whisper', 'pundit_takes',
 *                'balance_whisper', etc.).  When omitted, all kinds match.
 * @returns       Array of Narrative rows, newest first.
 */
export async function getRecentNarratives(
  db: IslSupabaseClient,
  limit = 50,
  source?: string,
  kind?: string,
): Promise<Narrative[]> {
  let query = (db as AnyDb) // CAST:entities
    .from('narratives')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (source) {
    query = query.eq('source', source);
  }
  if (kind) {
    query = query.eq('kind', kind);
  }

  const { data, error } = await query;
  if (error) {
    console.warn('[getRecentNarratives] failed:', error.message);
    return [];
  }
  return (data ?? []) as Narrative[];
}

/**
 * Fetch the most recent narratives matching ANY of a set of kinds.
 *
 * USE CASE: the pre-match build-up surface on MatchDetail wants a "press
 * room" feed — the latest pundit takes, journalist reports, and bookie
 * updates regardless of which match they reference.  A single PostgREST
 * call with `.in('kind', kinds)` returns this in one round-trip.
 *
 * WHY a separate function from getRecentNarratives
 *   `getRecentNarratives` takes a single optional `kind`.  Adding a second
 *   array-valued parameter would make the existing call signature
 *   confusing (callers already passing a single kind would wonder if
 *   they need to switch).  A focused helper keeps both surfaces clear.
 *
 * @param db     Injected Supabase client.
 * @param kinds  Array of kind strings to match.  Empty array = no rows.
 * @param limit  Max rows to return.  Default 6 — fits the build-up grid
 *               at desktop without overwhelming the page.
 * @returns      Array of Narrative rows, newest first.
 */
export async function getRecentNarrativesByKinds(
  db: IslSupabaseClient,
  kinds: string[],
  limit = 6,
): Promise<Narrative[]> {
  if (kinds.length === 0) return [];
  const { data, error } = await (db as AnyDb) // CAST:entities
    .from('narratives')
    .select('*')
    .in('kind', kinds)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn('[getRecentNarrativesByKinds] failed:', error.message);
    return [];
  }
  return (data ?? []) as Narrative[];
}
