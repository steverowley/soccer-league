// ── profiles.ts ──────────────────────────────────────────────────────────────
// WHY: Typed Supabase queries for the `profiles` table. Every read/write
// against profiles flows through this file so that:
//   1. The Supabase client is always injected (never imported directly),
//      making unit tests trivial — inject a fake, assert the call shape.
//   2. All DB responses pass through Zod schemas at the boundary, so a
//      schema drift (column renamed, type changed) fails loudly here
//      instead of propagating as `undefined` into the match engine or UI.
//   3. RLS enforcement is the real security boundary (profiles_select_own,
//      profiles_update_own); these functions just shape the query.
//
// CONSUMPTION:
//   UI components call these via the `useSupabase()` hook:
//     const db = useSupabase();
//     const profile = await getOwnProfile(db);
//
//   Pure logic (credits.ts, etc.) never calls these — logic is DB-free.
//
// ERROR HANDLING CONVENTION:
//   Functions return `{ data, error }` matching Supabase's own convention.
//   The UI layer decides how to surface errors (toast, inline, redirect).
//   We do NOT throw on Supabase errors because that would require every
//   call site to wrap in try/catch, which is noisier than a null-check.

import { z } from 'zod';
import type { IslSupabaseClient } from '@shared/supabase/client';
import type { Profile, PublicProfile, UpdateProfileInput } from '../types';

// TYPE ESCAPE HATCH: The `profiles` and `public_profiles` tables/views are
// created by migration 0001_profiles.sql, which hasn't been applied to the
// Supabase project yet — so the generated database.ts doesn't include them.
// We cast `db` to `any` for `.from('profiles')` calls until the types are
// regenerated. Each cast site is marked with `// CAST:profiles` so we can
// grep and remove them after regeneration.
//
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

// ── Zod schemas ─────────────────────────────────────────────────────────────
// These validate the raw rows coming from Supabase BEFORE they're returned
// to the caller. If the DB schema drifts (e.g. a column is renamed in a
// migration but database.ts isn't regenerated), Zod catches it here with a
// descriptive error rather than letting `undefined` leak into the app.

/**
 * Full profile row schema — what RLS returns for the owning user.
 * Matches the `profiles` table shape from migration 0001_profiles.sql.
 */
const ProfileSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  favourite_team_id: z.string().nullable(),
  favourite_player_id: z.string().uuid().nullable(),
  credits: z.number().int().min(0),
  last_seen_at: z.string().nullable(),
  created_at: z.string(),
});

/**
 * Public profile view schema — the subset exposed to all users via the
 * `public_profiles` SQL view. No credits, no last_seen_at.
 */
const PublicProfileSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  favourite_team_id: z.string().nullable(),
  favourite_player_id: z.string().uuid().nullable(),
  created_at: z.string(),
});

// ── Queries ─────────────────────────────────────────────────────────────────

/**
 * Fetch the currently authenticated user's full profile.
 *
 * Returns `null` if no auth session exists or RLS blocks the read (which
 * shouldn't happen for the owning user, but we handle it gracefully).
 *
 * @param db  Injected Supabase client (via `useSupabase()` or function arg).
 * @returns   The validated Profile, or `null` + an error message.
 */
export async function getOwnProfile(
  db: IslSupabaseClient,
): Promise<{ data: Profile | null; error: string | null }> {
  const { data: authData } = await db.auth.getUser();
  if (!authData.user) {
    return { data: null, error: 'Not authenticated' };
  }

  const { data, error } = await (db as AnyDb) // CAST:profiles
    .from('profiles')
    .select('*')
    .eq('id', authData.user.id)
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  // Validate at the boundary — if this parse fails, the migration and
  // database.ts are out of sync and we need to investigate.
  const parsed = ProfileSchema.safeParse(data);
  if (!parsed.success) {
    return {
      data: null,
      error: `Profile schema validation failed: ${parsed.error.message}`,
    };
  }

  return { data: parsed.data, error: null };
}

/**
 * Fetch a public profile by user ID. Used on leaderboards and voting pages
 * where we need the username and team affiliation but NOT credits.
 *
 * Queries the `public_profiles` SQL view, which is readable by all roles
 * (anon + authenticated) and only exposes safe columns.
 *
 * @param db      Injected Supabase client.
 * @param userId  The target user's UUID.
 * @returns       The validated PublicProfile, or `null` + error.
 */
export async function getPublicProfile(
  db: IslSupabaseClient,
  userId: string,
): Promise<{ data: PublicProfile | null; error: string | null }> {
  const { data, error } = await (db as AnyDb) // CAST:profiles
    .from('public_profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  const parsed = PublicProfileSchema.safeParse(data);
  if (!parsed.success) {
    return {
      data: null,
      error: `PublicProfile schema validation failed: ${parsed.error.message}`,
    };
  }

  return { data: parsed.data, error: null };
}

/**
 * Update the authenticated user's profile. Only the fields present in
 * `input` are updated; absent fields are left untouched.
 *
 * The RLS policy `profiles_update_own` ensures that a user can only update
 * their own row — passing someone else's ID would silently update zero rows.
 *
 * @param db     Injected Supabase client.
 * @param input  Partial profile fields to update.
 * @returns      The updated Profile, or `null` + error.
 */
export async function updateProfile(
  db: IslSupabaseClient,
  input: UpdateProfileInput,
): Promise<{ data: Profile | null; error: string | null }> {
  const { data: authData } = await db.auth.getUser();
  if (!authData.user) {
    return { data: null, error: 'Not authenticated' };
  }

  const { data, error } = await (db as AnyDb) // CAST:profiles
    .from('profiles')
    .update(input)
    .eq('id', authData.user.id)
    .select()
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  const parsed = ProfileSchema.safeParse(data);
  if (!parsed.success) {
    return {
      data: null,
      error: `Profile schema validation failed: ${parsed.error.message}`,
    };
  }

  return { data: parsed.data, error: null };
}

/**
 * Touch the `last_seen_at` timestamp for the authenticated user. Called on
 * every authed page navigation (debounced to ≤1 update/minute by the UI
 * hook that invokes this).
 *
 * Phase 3 uses `last_seen_at > now() - interval '5 min'` to count "present"
 * fans for the fan-support-boost query, so this write directly affects
 * match outcomes — it MUST fire reliably on navigation.
 *
 * Fire-and-forget: errors are logged but not surfaced to the user because
 * failing to touch last_seen_at is non-critical (it just means the user
 * might not count as "present" for one match's fan boost).
 *
 * @param db  Injected Supabase client.
 */
export async function touchLastSeen(db: IslSupabaseClient): Promise<void> {
  const { data: authData } = await db.auth.getUser();
  if (!authData.user) return;

  const { error } = await (db as AnyDb) // CAST:profiles
    .from('profiles')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', authData.user.id);

  if (error) {
    // Log but don't throw — this is fire-and-forget. The UI should not
    // break or show an error toast just because a timestamp touch failed.
    console.warn('[touchLastSeen] failed:', error.message);
  }
}
