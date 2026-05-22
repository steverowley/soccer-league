// ── pushSubscriptions.ts ─────────────────────────────────────────────────────
// Typed Supabase queries for the `push_subscriptions` table and the two
// `profiles.notify_*` opt-in columns added in migration 0039.
//
// LAYER BOUNDARY
//   Pure DB I/O.  All Supabase reads/writes flow through this file so:
//     1. The client is always injected (never imported) — unit tests fake it.
//     2. Zod parsing at the boundary catches schema drift loudly.
//     3. RLS (`push_subscriptions_*_own`) remains the security boundary;
//        these helpers just shape the queries.
//
// ERROR HANDLING
//   Returns `{ data, error }` matching Supabase's own convention.  We do
//   not throw on Supabase errors — UI decides how to surface them
//   (toast, inline message, redirect).
//
// CAST ESCAPE HATCH
//   The new table + columns aren't in the generated `database.ts` yet
//   (migration 0039 hasn't been applied at the time this file is being
//   written).  Each affected `.from(...)` is cast to `any` with a
//   `// CAST:notifications` marker so we can grep + clean up after the
//   regen lands.

import { z } from 'zod';
import type { IslSupabaseClient } from '@shared/supabase/client';
import type {
  BrowserPushSubscriptionJSON,
  NotificationPreferences,
  PushSubscriptionRow,
} from '../types';

// ── Type escape hatch ─────────────────────────────────────────────────────────
// Identical pattern to `auth/api/profiles.ts` (CAST:profiles).  Drop these
// casts once `npx supabase gen types` is re-run against migration 0039.
//
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

// ── Zod schemas ───────────────────────────────────────────────────────────────
// Boundary validation: every row read from the DB is parsed here BEFORE it
// reaches feature code.  A renamed column or type drift fails here with a
// descriptive error instead of silently leaking `undefined` into the UI.

/**
 * Validates a row read from `push_subscriptions`.  Mirrors the table shape
 * from migration 0039 exactly.
 */
const PushSubscriptionRowSchema = z.object({
  id:           z.string().uuid(),
  user_id:      z.string().uuid(),
  endpoint:     z.string().url(),
  p256dh_key:   z.string().min(1),
  auth_key:     z.string().min(1),
  user_agent:   z.string().nullable(),
  created_at:   z.string(),
  last_used_at: z.string(),
});

/**
 * Validates the two opt-in toggles read from `profiles`.  Used by
 * `getNotificationPreferences` — `profiles` itself has a broader schema
 * in auth/api/profiles.ts but this slice is all the notifications
 * feature needs.
 */
const NotificationPreferencesSchema = z.object({
  notify_favourite_team: z.boolean(),
  notify_all_matches:    z.boolean(),
});

// ── Reads ─────────────────────────────────────────────────────────────────────

/**
 * Fetch the currently authenticated user's push subscriptions.
 *
 * One row per device/browser the user has enabled push on.  Drives the
 * "subscribed devices" list on /profile.  Returns an empty array (not an
 * error) when the user has no rows — that's the normal pre-enrolment state.
 *
 * @param db  Injected Supabase client (via `useSupabase()`).
 * @returns   The list of validated rows, or `[]` + an error string.
 */
export async function listOwnPushSubscriptions(
  db: IslSupabaseClient,
): Promise<{ data: PushSubscriptionRow[]; error: string | null }> {
  const { data: authData } = await db.auth.getUser();
  if (!authData.user) {
    return { data: [], error: 'Not authenticated' };
  }

  const { data, error } = await (db as AnyDb) // CAST:notifications
    .from('push_subscriptions')
    .select('*')
    .eq('user_id', authData.user.id)
    .order('created_at', { ascending: false });

  if (error) {
    return { data: [], error: error.message };
  }

  // Boundary parse — if any row fails we treat the whole response as a
  // schema-drift error rather than silently dropping individual rows.
  const parsed = z.array(PushSubscriptionRowSchema).safeParse(data ?? []);
  if (!parsed.success) {
    return {
      data: [],
      error: `push_subscriptions schema validation failed: ${parsed.error.message}`,
    };
  }
  return { data: parsed.data, error: null };
}

/**
 * Fetch just the two opt-in toggles for the authenticated user.
 *
 * Extracted from the full profile read so the notifications UI does not
 * have to re-fetch credits / username / favourites when all it needs is
 * the two booleans.  RLS scopes the row to `auth.uid() = id`.
 *
 * @param db  Injected Supabase client.
 * @returns   The two booleans, or `null` + an error string when the
 *            user is anonymous or the read fails.
 */
export async function getNotificationPreferences(
  db: IslSupabaseClient,
): Promise<{ data: NotificationPreferences | null; error: string | null }> {
  const { data: authData } = await db.auth.getUser();
  if (!authData.user) {
    return { data: null, error: 'Not authenticated' };
  }

  const { data, error } = await (db as AnyDb) // CAST:notifications
    .from('profiles')
    .select('notify_favourite_team, notify_all_matches')
    .eq('id', authData.user.id)
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  const parsed = NotificationPreferencesSchema.safeParse(data);
  if (!parsed.success) {
    return {
      data: null,
      error: `notification preferences schema validation failed: ${parsed.error.message}`,
    };
  }
  return { data: parsed.data, error: null };
}

// ── Writes ────────────────────────────────────────────────────────────────────

/**
 * Persist (or refresh) a browser push subscription for the authenticated user.
 *
 * Upsert keyed on `(user_id, endpoint)` — re-subscribing on the same device
 * updates the existing row rather than creating duplicates that would
 * cause us to push twice on every match.  RLS gates the write to the
 * owning user; passing someone else's user_id would be rejected by the
 * `push_subscriptions_insert_own` WITH CHECK predicate.
 *
 * @param db            Injected Supabase client.
 * @param subscription  The `PushSubscription.toJSON()` output from the browser.
 * @param userAgent     Optional UA string captured for diagnostics; we
 *                      pass `navigator.userAgent` from the UI but tolerate
 *                      `undefined` for tests.
 * @returns             The upserted row + null error, or null + error
 *                      message on failure.
 */
export async function upsertPushSubscription(
  db: IslSupabaseClient,
  subscription: BrowserPushSubscriptionJSON,
  userAgent?: string,
): Promise<{ data: PushSubscriptionRow | null; error: string | null }> {
  const { data: authData } = await db.auth.getUser();
  if (!authData.user) {
    return { data: null, error: 'Not authenticated' };
  }

  // We project to the exact column names the DB expects rather than
  // pushing the browser shape straight through — the browser's
  // `keys.p256dh` / `keys.auth` need to be flattened to top-level
  // columns and the `user_id` (RLS key) has to be set explicitly.
  const row = {
    user_id:    authData.user.id,
    endpoint:   subscription.endpoint,
    p256dh_key: subscription.keys.p256dh,
    auth_key:   subscription.keys.auth,
    user_agent: userAgent ?? null,
    // last_used_at is bumped here so re-enrolling looks like recent
    // activity to the cron worker's eviction logic.
    last_used_at: new Date().toISOString(),
  };

  const { data, error } = await (db as AnyDb) // CAST:notifications
    .from('push_subscriptions')
    .upsert(row, { onConflict: 'user_id,endpoint' })
    .select()
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  const parsed = PushSubscriptionRowSchema.safeParse(data);
  if (!parsed.success) {
    return {
      data: null,
      error: `push_subscriptions schema validation failed: ${parsed.error.message}`,
    };
  }
  return { data: parsed.data, error: null };
}

/**
 * Delete the authenticated user's row for a specific endpoint.
 *
 * Called from the "Disable push on this device" button on /profile and
 * from the unsubscribe flow when `Notification.permission` flips to
 * `'denied'`.  RLS restricts deletes to the owning user, so even with
 * a leaked endpoint string no one else can wipe someone's subscription.
 *
 * @param db        Injected Supabase client.
 * @param endpoint  The browser-provided push service URL identifying
 *                  the row to remove.
 * @returns         `{ error: null }` on success.
 */
export async function deletePushSubscription(
  db: IslSupabaseClient,
  endpoint: string,
): Promise<{ error: string | null }> {
  const { data: authData } = await db.auth.getUser();
  if (!authData.user) {
    return { error: 'Not authenticated' };
  }

  const { error } = await (db as AnyDb) // CAST:notifications
    .from('push_subscriptions')
    .delete()
    .eq('user_id', authData.user.id)
    .eq('endpoint', endpoint);

  if (error) {
    return { error: error.message };
  }
  return { error: null };
}

/**
 * Update the two opt-in toggles on the authenticated user's profile row.
 *
 * Fields are optional: passing `{ notify_all_matches: true }` flips just
 * that toggle and leaves `notify_favourite_team` untouched.  RLS scopes
 * the UPDATE to the owning user; migration 0041 additionally locks out
 * is_admin / credits column writes from the client.
 *
 * KEY ALLOWLIST (defence-in-depth)
 * ─────────────────────────────────
 * TypeScript types are erased at runtime, so a caller could in principle
 * sneak extra keys (e.g. `is_admin`) into `prefs`.  Migration 0041 already
 * blocks those at the RLS layer, but this wrapper filters down to the two
 * declared notification keys before reaching PostgREST so the dangerous
 * keys never even leave the browser.  The two layers compose: RLS catches
 * direct supabase-js bypass paths, the allowlist catches buggy callers.
 *
 * @param db     Injected Supabase client.
 * @param prefs  Partial preferences shape; absent fields are not written.
 *               Any keys outside `notify_favourite_team` and
 *               `notify_all_matches` are silently dropped.
 * @returns      The merged preferences after the update, or null + error.
 */
export async function updateNotificationPreferences(
  db: IslSupabaseClient,
  prefs: Partial<NotificationPreferences>,
): Promise<{ data: NotificationPreferences | null; error: string | null }> {
  const { data: authData } = await db.auth.getUser();
  if (!authData.user) {
    return { data: null, error: 'Not authenticated' };
  }

  // ── Allowlist filter ─────────────────────────────────────────────────────
  // Build a fresh object that only carries the two known boolean keys.
  // `in`-check (rather than truthy-check) lets the caller explicitly set a
  // field to `false`, which we still want to forward.  The boolean coercion
  // (`!!value`) defends against a caller passing e.g. `1` or `'true'`.
  const safe: { notify_favourite_team?: boolean; notify_all_matches?: boolean } = {};
  if ('notify_favourite_team' in prefs) {
    safe.notify_favourite_team = !!prefs.notify_favourite_team;
  }
  if ('notify_all_matches' in prefs) {
    safe.notify_all_matches = !!prefs.notify_all_matches;
  }

  // Refuse the empty payload — Postgres tolerates it, but it would
  // silently no-op and the caller would not be able to tell apart a
  // success from a logic bug that filtered every field out.
  if (Object.keys(safe).length === 0) {
    return { data: null, error: 'No preferences supplied' };
  }

  const { data, error } = await (db as AnyDb) // CAST:notifications
    .from('profiles')
    .update(safe)
    .eq('id', authData.user.id)
    .select('notify_favourite_team, notify_all_matches')
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  const parsed = NotificationPreferencesSchema.safeParse(data);
  if (!parsed.success) {
    return {
      data: null,
      error: `notification preferences schema validation failed: ${parsed.error.message}`,
    };
  }
  return { data: parsed.data, error: null };
}
