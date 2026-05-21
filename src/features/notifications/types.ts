// ── notifications/types.ts ──────────────────────────────────────────────────
// WHY: Typed shapes consumed by the notifications feature's api/, logic/, and
// ui/ layers.  Sourcing them from a single file keeps the surface area
// reviewable and prevents the kind of ad-hoc duck typing that has bitten
// every other feature when database.ts hasn't been regenerated yet.
//
// SOURCE OF TRUTH:
//   - `push_subscriptions` and the two new `profiles` opt-in columns are
//     introduced by migration 0039_match_start_push_notifications.sql.
//   - Until database.ts is regenerated against that migration, these shapes
//     are defined manually here.  When the regen lands, switch to:
//       `import type { Tables } from '@/types/database';`
//       `export type PushSubscriptionRow = Tables<'push_subscriptions'>;`

/**
 * One row in `push_subscriptions`.  Persists the (endpoint, p256dh, auth)
 * triplet a browser hands back from `PushManager.subscribe()`, plus
 * provenance fields the cron worker uses for diagnostics.
 *
 * One row per (user, endpoint) — a single user can have multiple rows if
 * they enable push on more than one device/browser.
 */
export interface PushSubscriptionRow {
  /** UUID PK, server-assigned via `gen_random_uuid()`. */
  id: string;
  /** Owning profile.id — RLS keys SELECT/INSERT/DELETE off `auth.uid()`. */
  user_id: string;
  /** Push service URL the browser handed us. Vendor-specific. */
  endpoint: string;
  /** base64url-encoded ECDH public key (browser-side). */
  p256dh_key: string;
  /** base64url-encoded auth secret (browser-side). */
  auth_key: string;
  /** Optional UA string captured at subscribe time for debugging. */
  user_agent: string | null;
  created_at: string;
  last_used_at: string;
}

/**
 * Shape of the two opt-in toggles added to `profiles` by migration 0039.
 * Mirrors the columns 1:1 so the UI component can use this as its draft
 * state without inventing a parallel shape.
 *
 * Both default to `false` server-side; users explicitly enable each via
 * the NotificationSettings UI on /profile after granting browser
 * Notification permission.
 */
export interface NotificationPreferences {
  /**
   * When true, the cron worker will push for any upcoming match where the
   * user's `favourite_team_id` is one of the two clubs playing.  Has no
   * effect unless `favourite_team_id` is also set.
   */
  notify_favourite_team: boolean;
  /**
   * When true, the cron worker will push for every upcoming match,
   * regardless of clubs involved.  Use sparingly — there can be 4–6
   * matches per day.
   */
  notify_all_matches: boolean;
}

/**
 * The browser-side `PushSubscription.toJSON()` payload, narrowed to the
 * fields we actually persist.  We don't store `expirationTime` because
 * browsers either don't set it or set it to far-future values that don't
 * give us useful eviction signal — we evict on push-delivery 410/404
 * instead (handled by the cron worker).
 */
export interface BrowserPushSubscriptionJSON {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}
