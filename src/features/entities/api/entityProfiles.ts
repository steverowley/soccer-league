// ── features/entities/api/entityProfiles.ts ─────────────────────────────────
// Supabase read for the narrative profile content stored in `entities.meta.profile`.
// One pure async wrapper with Zod validation at the boundary (via the shared
// profile schema registry) — no React, no module-level Supabase singleton.
//
// FAILURE POLICY
//   Returns null on network error, missing row, missing profile, an unprofiled
//   kind, or a profile that fails its schema. A drifted profile is logged and
//   dropped rather than crashing the detail page that consumes it.

import type { IslSupabaseClient } from '@shared/supabase/client';

import { isProfiledKind, parseProfile, type ProfiledKind } from '../logic/entityProfile';

/** A validated profile plus the entity kind it was validated against. */
export interface EntityProfileResult {
  kind: ProfiledKind;
  /** Parsed `meta.profile` object. Field set varies by kind (see entityProfile.ts). */
  profile: Record<string, unknown>;
}

/**
 * Fetch + validate the `meta.profile` for a single entity.
 *
 * @param db - DI Supabase client (from `useSupabase()` or a function arg).
 * @param entityId - The `entities.id` uuid to read.
 * @returns The validated profile and kind, or null when absent/invalid.
 */
export async function getEntityProfile(
  db: IslSupabaseClient,
  entityId: string,
): Promise<EntityProfileResult | null> {
  const { data, error } = await db
    .from('entities')
    .select('kind, meta')
    .eq('id', entityId)
    .maybeSingle();
  if (error || !data) return null;

  const kind = data.kind as string;
  const meta = (data.meta ?? {}) as Record<string, unknown>;
  const raw = meta['profile'];
  if (raw == null || !isProfiledKind(kind)) return null;

  try {
    const profile = parseProfile(kind, raw) as Record<string, unknown>;
    return { kind, profile };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[entityProfiles] malformed profile for entity ${entityId}: ${msg}`);
    return null;
  }
}
