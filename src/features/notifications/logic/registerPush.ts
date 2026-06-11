// ── registerPush.ts ──────────────────────────────────────────────────────────
// Browser-side helpers that broker between the Notification / ServiceWorker /
// PushManager APIs and the api/ layer that persists subscription rows.
//
// LAYER NOTES
//   This module is in `logic/` only because the project's import rules
//   forbid `api/` from depending on Web APIs (those belong to UI).  In
//   practice the code is "thin UI glue" — it pokes navigator APIs and
//   awaits promises.  Pure data conversions live in `vapidKey.ts`; this
//   file deals with side effects.
//
// FEATURE DETECTION
//   We probe for the four required globals — `Notification`,
//   `navigator.serviceWorker`, `PushManager`, and the VAPID env var —
//   before invoking any of them.  Older Safari + iOS-non-PWA contexts
//   miss at least one and would throw at first touch; we surface a
//   structured `{ supported: false, reason }` instead.
//
// VAPID PUBLIC KEY
//   Read from `import.meta.env.VITE_VAPID_PUBLIC_KEY` at build time.
//   The matching private key lives in the Supabase Edge Function env
//   (`VAPID_PRIVATE_KEY`).  Both keys are generated once via
//   `npx web-push generate-vapid-keys` and rotated together.

import type { IslSupabaseClient } from '@shared/supabase/client';
import {
  deletePushSubscription,
  upsertPushSubscription,
} from '../api/pushSubscriptions';
import type { BrowserPushSubscriptionJSON } from '../types';
import { arrayBufferToBase64Url, urlBase64ToUint8Array } from './vapidKey';

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Path (under Vite's base) where `sw.js` is served.  The service worker
 * file is created in `public/sw.js`; Vite copies anything under `public/`
 * straight into the build output, prefixed by `import.meta.env.BASE_URL`.
 *
 * Why a constant: the path appears in two places (`registerServiceWorker`
 * and the unsubscribe path's worker lookup) and a typo in either would
 * silently break push delivery without throwing.
 */
const SERVICE_WORKER_PATH = `${import.meta.env.BASE_URL}sw.js`;

/**
 * Browser env-var key for the VAPID **public** key.  Vite inlines any
 * `VITE_*` env at build time so the key ships in the JS bundle — that's
 * intentional: the public key is meant to be public.
 */
const VAPID_PUBLIC_KEY = (import.meta.env['VITE_VAPID_PUBLIC_KEY'] ?? '') as string;

// ── Result shapes ────────────────────────────────────────────────────────────
// We model the outcome of each top-level action as a discriminated union
// rather than throwing.  Callers (the UI) want to render specific copy
// per failure mode — using exception types would force a brittle
// `err.message.includes(...)` ladder.

/** The browser environment can run push at all (all four checks pass). */
export interface PushSupported { supported: true; }

/** Either a required Web API or the VAPID key is missing. */
export interface PushUnsupported {
  supported: false;
  /**
   * Machine-readable reason so the UI can pick the right copy:
   *   - `'no-notification-api'`      The Notification global is absent.
   *   - `'no-service-worker'`        `navigator.serviceWorker` is absent.
   *   - `'no-push-manager'`          `window.PushManager` is absent.
   *   - `'no-vapid-key'`             `VITE_VAPID_PUBLIC_KEY` is unset.
   */
  reason:
    | 'no-notification-api'
    | 'no-service-worker'
    | 'no-push-manager'
    | 'no-vapid-key';
}

/** Discriminated union surfaced by `checkPushSupport`. */
export type PushSupport = PushSupported | PushUnsupported;

/**
 * Outcome of an `enablePush` call.  `'granted'` is the only path that
 * actually wrote a row; the others are dead-ends the UI renders as
 * advisory text ("Permission denied — re-enable in browser settings").
 */
export type EnablePushOutcome =
  | { status: 'enabled'; endpoint: string }
  | { status: 'denied' }
  | { status: 'dismissed' }
  | { status: 'unsupported'; reason: PushUnsupported['reason'] }
  | { status: 'error'; error: string };

// ── Support detection ────────────────────────────────────────────────────────

/**
 * Probe the browser for the four prerequisites for web-push:
 *   1. `Notification` global (the OS notification surface).
 *   2. `navigator.serviceWorker` (registration target).
 *   3. `window.PushManager` (the actual push subscription API).
 *   4. `VITE_VAPID_PUBLIC_KEY` baked into the bundle at build time.
 *
 * All four must be present.  Returning a discriminated union lets the UI
 * render a specific message for each missing piece without re-running
 * the same checks itself.
 *
 * @returns `{ supported: true }` if everything is ready, otherwise
 *          `{ supported: false, reason }` naming the first failed check.
 */
export function checkPushSupport(): PushSupport {
  if (typeof Notification === 'undefined') {
    return { supported: false, reason: 'no-notification-api' };
  }
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return { supported: false, reason: 'no-service-worker' };
  }
  if (typeof window === 'undefined' || !('PushManager' in window)) {
    return { supported: false, reason: 'no-push-manager' };
  }
  if (!VAPID_PUBLIC_KEY) {
    return { supported: false, reason: 'no-vapid-key' };
  }
  return { supported: true };
}

// ── VAPID-key equality helper ────────────────────────────────────────────────

/**
 * Byte-wise compare a PushSubscription's stored applicationServerKey
 * against the current VAPID public key we'd subscribe with.  Used by
 * `enablePush` to detect post-rotation mismatches before calling
 * `pushManager.subscribe()` (which throws InvalidStateError on a key
 * change rather than silently re-subscribing).
 *
 * Both inputs are normalised to a Uint8Array view first — the browser
 * exposes the stored key as an ArrayBuffer (or null on older Safari),
 * and our newly-decoded VAPID key is already a Uint8Array.
 *
 * @param storedRaw  Existing key from `existing.options.applicationServerKey`,
 *                   or `null` if the browser doesn't expose it.
 * @param current    Freshly-decoded current VAPID public key.
 * @returns          `true` when the byte sequences are identical, OR
 *                   when `storedRaw` is null (we can't tell — assume
 *                   match to avoid forced re-enrolment on browsers that
 *                   hide the field).  `false` only when both are
 *                   readable and they differ.
 */
function keysMatch(
  storedRaw: ArrayBuffer | null,
  current:   Uint8Array,
): boolean {
  // Null stored key means the browser refuses to expose it (older
  // Safari).  Treat as "matches" so we don't force re-enrolment every
  // time on those browsers; the worst case is the same
  // InvalidStateError users already had before this guard, which is no
  // regression.
  if (storedRaw === null) return true;
  const stored = new Uint8Array(storedRaw);
  if (stored.byteLength !== current.byteLength) return false;
  for (let i = 0; i < stored.byteLength; i += 1) {
    if (stored[i] !== current[i]) return false;
  }
  return true;
}

// ── Service worker registration ──────────────────────────────────────────────

/**
 * Idempotently register `sw.js` and return the active registration.
 *
 * `navigator.serviceWorker.register()` is safe to call repeatedly — if a
 * registration already exists for the same scope+script, the browser
 * returns the existing record rather than installing a second worker.
 * We wait for `ready` so PushManager calls don't race the activation.
 *
 * @returns The active ServiceWorkerRegistration, or `null` if registration
 *          throws (typically because the file 404s in a dev build that
 *          forgot to copy `public/`).
 */
async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;

  try {
    // Scope defaults to the script's directory.  Our app is mounted at
    // `import.meta.env.BASE_URL` (e.g. `/soccer-league/`) so the worker
    // ends up scoped to that subpath — exactly what we want for GitHub
    // Pages hosting.
    await navigator.serviceWorker.register(SERVICE_WORKER_PATH);
    // `.ready` resolves with the active registration once a worker
    // takes control.  Using `.ready` instead of the `register()` result
    // means subscribe() never sees a still-installing worker.
    return await navigator.serviceWorker.ready;
  } catch (err) {
    console.warn('[push] service worker registration failed:', err);
    return null;
  }
}

// ── Enable / disable orchestration ───────────────────────────────────────────

/**
 * Top-level "enable push notifications on this device" flow:
 *   1. Check support (returns early with `unsupported` if anything missing).
 *   2. Request `Notification.permission` (returns `denied` / `dismissed`
 *      verbatim).
 *   3. Register the service worker.
 *   4. Subscribe via `PushManager` using the VAPID public key.
 *   5. Persist the subscription row through the api/ layer.
 *
 * Idempotent: re-running while already subscribed re-upserts the same
 * row (matched on `user_id` + `endpoint`).
 *
 * @param db  Injected Supabase client.
 * @returns   Discriminated union; see `EnablePushOutcome` for shapes.
 */
export async function enablePush(db: IslSupabaseClient): Promise<EnablePushOutcome> {
  const support = checkPushSupport();
  if (!support.supported) {
    return { status: 'unsupported', reason: support.reason };
  }

  // ── 1. Permission prompt ──────────────────────────────────────────────────
  // Notification.requestPermission() returns 'granted' | 'denied' | 'default'.
  // 'default' here means "user dismissed the prompt without choosing" —
  // we surface it as 'dismissed' so the UI can hint to click the button
  // again rather than directing them to browser settings.
  let permission: NotificationPermission;
  try {
    permission = await Notification.requestPermission();
  } catch (err) {
    return { status: 'error', error: String(err) };
  }
  if (permission === 'denied') {
    // The user previously enabled push and then flipped browser permission
    // to 'denied' in OS/browser settings.  The local PushSubscription is
    // now orphaned and the DB row would leave the cron worker pushing to
    // a dead endpoint indefinitely.  Tear it down here so the system
    // converges on "no subscription, no DB row" instead of leaking state.
    // Failures during cleanup are non-fatal — the cron worker eventually
    // evicts the row on the first 404/410 from the push service.
    try {
      await disablePush(db);
    } catch (cleanupErr) {
      console.warn('[push] denied-state cleanup failed:', cleanupErr);
    }
    return { status: 'denied' };
  }
  if (permission !== 'granted') return { status: 'dismissed' };

  // ── 2. Service worker ────────────────────────────────────────────────────
  const registration = await registerServiceWorker();
  if (!registration) {
    return { status: 'error', error: 'Service worker failed to register' };
  }

  // ── 3. Push subscription ─────────────────────────────────────────────────
  // `userVisibleOnly: true` is mandatory for Chrome — silent pushes are
  // not allowed.  Every push must result in a visible notification, which
  // is exactly our use case anyway.
  //
  // The .buffer cast is necessary because lib.dom.d.ts narrows
  // applicationServerKey to BufferSource (which excludes Uint8Array<SAB>).
  // Our `urlBase64ToUint8Array` only ever produces a plain ArrayBuffer-backed
  // view, so the cast is safe — but TS can't infer that from the public
  // Uint8Array type alone.
  //
  // VAPID ROTATION SAFETY: PushManager.subscribe() rejects with
  // `InvalidStateError` when a subscription already exists under a
  // *different* applicationServerKey (Push API spec §5.1.1.4).  Any
  // VAPID key rotation would therefore strand previously-enrolled users
  // — re-clicking Enable would loop on the same InvalidStateError
  // forever.  Detect the mismatch up-front: read the existing
  // subscription (if any), compare its applicationServerKey to the
  // current VAPID, and unsubscribe locally + delete the server row
  // before calling subscribe() with the new key.  Endpoint URL is the
  // server-side identifier — we delete by the OLD endpoint so the cron
  // worker stops pushing the orphaned row.
  const vapidKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
  try {
    const existing = await registration.pushManager.getSubscription();
    if (existing) {
      const existingKey = existing.options?.applicationServerKey ?? null;
      if (!keysMatch(existingKey, vapidKey)) {
        // Key rotated since the last subscribe; tear down the stale
        // browser + DB state so the new subscribe() call below succeeds.
        const oldEndpoint = existing.endpoint;
        try {
          await existing.unsubscribe();
        } catch (unsubErr) {
          console.warn('[push] stale subscription unsubscribe failed:', unsubErr);
        }
        try {
          await deletePushSubscription(db, oldEndpoint);
        } catch (delErr) {
          console.warn('[push] stale subscription delete failed:', delErr);
        }
      }
    }
  } catch (err) {
    // Reading getSubscription should never throw, but if it does we'd
    // rather proceed to subscribe() and let that error surface than
    // block enrolment entirely.
    console.warn('[push] getSubscription pre-check failed:', err);
  }

  let subscription: PushSubscription;
  try {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidKey.buffer as ArrayBuffer,
    });
  } catch (err) {
    return { status: 'error', error: String(err) };
  }

  // ── 4. Persist row ────────────────────────────────────────────────────────
  // The browser hands back PushSubscription with raw ArrayBuffer keys; we
  // convert them to base64url so the DB can store TEXT.  `toJSON()` would
  // do the same thing in modern Chromium but Safari historically lies
  // here — we use the explicit `getKey()` extractors for portability.
  const browserPayload: BrowserPushSubscriptionJSON = {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: arrayBufferToBase64Url(subscription.getKey('p256dh')),
      auth:   arrayBufferToBase64Url(subscription.getKey('auth')),
    },
  };

  // Defence-in-depth: if either key encoded to '' the subsequent web-push
  // would 4xx anyway, so refuse early with a clear message.
  if (!browserPayload.keys.p256dh || !browserPayload.keys.auth) {
    return { status: 'error', error: 'Browser refused to expose subscription keys' };
  }

  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : undefined;
  const { error } = await upsertPushSubscription(db, browserPayload, userAgent);
  if (error) {
    return { status: 'error', error };
  }

  return { status: 'enabled', endpoint: subscription.endpoint };
}

/**
 * Tear down the current device's push subscription.
 *
 * Performs both halves of the "off" flow:
 *   1. `PushSubscription.unsubscribe()` in the browser (so the push
 *      service stops accepting messages for us).
 *   2. Delete the persisted row via the api/ layer (so the cron worker
 *      won't try to push to a now-invalid endpoint).
 *
 * Tolerant of partial state: if either half is already gone (no active
 * subscription, no DB row) we still try the other half — leaving stale
 * server-side rows around is the bigger headache.
 *
 * @param db  Injected Supabase client.
 * @returns   `null` on success, an error string when something failed
 *            in a way the UI should surface.
 */
export async function disablePush(db: IslSupabaseClient): Promise<string | null> {
  if (!('serviceWorker' in navigator) || typeof window === 'undefined' || !('PushManager' in window)) {
    // Nothing to undo; treat as success.  This branch is taken when the
    // user toggled off in a browser that has since lost the API
    // (extension change, etc.).
    return null;
  }

  // We need the existing subscription to know which endpoint row to
  // delete.  `getRegistration()` returns undefined when sw.js was never
  // installed — we tolerate that and just return success.
  const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_PATH);
  if (!registration) return null;

  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return null;

  const endpoint = subscription.endpoint;

  // Unsubscribe first so the user stops receiving pushes even if the DB
  // delete fails (an orphan row can be cleaned up by the cron worker
  // on the next 410 from the push service).
  try {
    await subscription.unsubscribe();
  } catch (err) {
    console.warn('[push] unsubscribe failed:', err);
  }

  const { error } = await deletePushSubscription(db, endpoint);
  return error;
}

/**
 * Read the active subscription's endpoint, if any, without changing state.
 *
 * Used by the NotificationSettings UI to decide whether to render an
 * "Enable" or "Disable" button on first paint.  Returns `null` when no
 * worker is registered yet (the user has never enabled push) or when
 * the worker exists but its PushManager has no subscription.
 *
 * @returns The endpoint URL of the active PushSubscription, or `null`.
 */
export async function getCurrentPushEndpoint(): Promise<string | null> {
  if (!('serviceWorker' in navigator)) return null;

  const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_PATH);
  if (!registration) return null;

  const subscription = await registration.pushManager.getSubscription();
  return subscription?.endpoint ?? null;
}
