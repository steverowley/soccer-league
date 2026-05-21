// ── notifications/index.ts ──────────────────────────────────────────────────
// Public barrel for the notifications feature.  Cross-feature imports MUST
// go through this file — never reach into `api/`, `logic/`, or `ui/`
// directly (ESLint's no-restricted-imports rule enforces it).
//
// EXPORT POLICY
//   - The UI surface (NotificationSettings) is the canonical entry point
//     for the /profile page.
//   - The api/ helpers and `enablePush`/`disablePush` are re-exported so
//     a future "Notify me about this match" button on /matches/:id can
//     drive the flow without re-importing logic directly.
//   - Internal helpers (`checkPushSupport`, `getCurrentPushEndpoint`,
//     `arrayBufferToBase64Url`, `urlBase64ToUint8Array`) stay encapsulated
//     — if a second consumer needs one, lift it explicitly here.

export { default as NotificationSettings } from './ui/NotificationSettings';

export {
  listOwnPushSubscriptions,
  getNotificationPreferences,
  upsertPushSubscription,
  deletePushSubscription,
  updateNotificationPreferences,
} from './api/pushSubscriptions';

export {
  enablePush,
  disablePush,
  checkPushSupport,
  getCurrentPushEndpoint,
} from './logic/registerPush';

export type {
  NotificationPreferences,
  PushSubscriptionRow,
  BrowserPushSubscriptionJSON,
} from './types';
