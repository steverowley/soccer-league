// ── features/match/api/managers.ts ────────────────────────────────────────
// Slice 5 of #387 — moves `getManager` out of `src/lib/supabase.ts`.
//
// Powers the `/managers/:managerId` detail page (bd isl-aai). Returns
// the manager row joined to its current team + the entity row + the
// entity_traits bundle so the page can render bio fields without a
// chain of follow-up queries.

import type { IslSupabaseClient } from '@shared/supabase/client';
import type { Json } from '@/types/database';

// ── Public types ──────────────────────────────────────────────────────────

/**
 * Manager row + adjacent context the detail page renders.
 *
 * `teams` is the join from `managers.team_id` (null when the manager
 * is detached — e.g. after a drama-tier resignation). `entity` and
 * `traits` come from the Universal Agent System entity graph so the
 * page can read JSON-shaped flavour (tactical preferences, voice
 * fragments) without exposing raw engine stats.
 */
export interface ManagerWithContext {
  id:           string;
  name:         string;
  nationality:  string | null;
  style:        string | null;
  team_id:      string | null;
  entity_id:    string | null;
  teams:        { id: string; name: string; color: string | null } | null;
  entity:       { id: string; display_name: string | null; meta: Json | null } | null;
  traits:       Array<{ trait_key: string; trait_value: Json }>;
}

// ── getManager ────────────────────────────────────────────────────────────

/**
 * Fetch a manager + the join to teams + their entity row + traits.
 *
 * Best-effort: returns null when the manager id doesn't exist or the
 * primary query errors so callers can render the standard "Unknown
 * Manager" surface rather than getting a thrown error. Entity / trait
 * lookup failures degrade silently — the page still renders with
 * `entity: null` / `traits: []` and the bio just omits those fields.
 *
 * PostgREST embeds `teams` as either an object or a single-element
 * array depending on the relationship cardinality it detects. The
 * normalisation step at the end of this function flattens any array
 * form down to a single object (or null) so callers always see one
 * canonical type — without this step, `manager.teams?.name` accesses
 * in ManagerDetail would silently break under the array shape.
 *
 * @param db         Injected Supabase client.
 * @param managerId  Manager UUID.
 * @returns          Manager bundle, or null when the manager row is
 *                   missing / the primary query errors.
 */
export async function getManager(
  db:         IslSupabaseClient,
  managerId:  string,
): Promise<ManagerWithContext | null> {
  const { data: managerRow, error: managerErr } = await db
    .from('managers')
    .select('id, name, nationality, style, team_id, entity_id, teams(id, name, color)')
    .eq('id', managerId)
    .maybeSingle();

  if (managerErr || !managerRow) {
    if (managerErr) console.warn('[getManager] manager fetch failed:', managerErr.message);
    return null;
  }

  // ── Entity + traits — best-effort enrichment ─────────────────────
  // Empty results render gracefully; the page falls back to "no bio"
  // text rather than surfacing an error.
  let entity: ManagerWithContext['entity'] = null;
  let traits: ManagerWithContext['traits'] = [];

  if (managerRow.entity_id) {
    const [entityRes, traitsRes] = await Promise.all([
      db.from('entities')
        .select('id, display_name, meta')
        .eq('id', managerRow.entity_id)
        .maybeSingle(),
      db.from('entity_traits')
        .select('trait_key, trait_value')
        .eq('entity_id', managerRow.entity_id),
    ]);
    if (entityRes.data) entity = entityRes.data;
    if (traitsRes.data) traits = traitsRes.data;
  }

  // ── Normalise PostgREST's embedded `teams` shape ─────────────────
  // PostgREST embeds a related row as either an OBJECT (canonical
  // one-to-one) or an ARRAY of length 0/1 (when the relationship is
  // detected as ambiguous or has no enforced cardinality).
  // `ManagerWithContext.teams` is typed as a singular object, so a
  // runtime array would silently break `manager.teams?.name` accesses
  // in ManagerDetail. Flatten array → first element (or null) so the
  // consumer always sees one canonical type.
  const rawTeams = (managerRow as { teams?: unknown }).teams;
  const teamsObject: ManagerWithContext['teams'] = Array.isArray(rawTeams)
    ? ((rawTeams[0] as ManagerWithContext['teams']) ?? null)
    : ((rawTeams as ManagerWithContext['teams']) ?? null);

  return {
    ...(managerRow as unknown as ManagerWithContext),
    teams: teamsObject,
    entity,
    traits,
  };
}
