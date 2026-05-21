// ── sw.js ────────────────────────────────────────────────────────────────────
// Service worker for the Intergalactic Soccer League.
//
// SOLE RESPONSIBILITY (today): receive web-push messages dispatched by the
// match-notify-worker edge function and show them as OS-level notifications.
// Anything else a service worker can do (offline cache, background sync) is
// intentionally out of scope — adding it later is a separate decision.
//
// PAYLOAD SHAPE
// ─────────────
// The edge function pushes a JSON body shaped:
//   {
//     title:   string,   // shown as the notification heading
//     body:    string,   // shown as the body text
//     url:     string,   // deep link followed when the user taps the notif
//     matchId: string,   // future-proofing; not used yet
//     tag:     string    // collapse key so re-pushes for the same match
//                        // replace rather than stack
//   }
//
// LIFE-OF-A-PUSH
// ──────────────
// 1. Server encrypts payload with the subscriber's p256dh/auth keys and posts
//    it to the browser's push service URL.
// 2. The browser wakes this worker and fires the `push` event.
// 3. We call `event.waitUntil(self.registration.showNotification(...))` so the
//    worker isn't killed before the OS notif renders.
// 4. On tap, `notificationclick` fires — we focus an existing tab on the deep
//    link if one exists, otherwise open a new one.

self.addEventListener('install', (event) => {
  // Take over immediately so the first push after subscribe doesn't need a
  // reload to be received.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (err) {
    // If the server ever pushed plain text (shouldn't happen but harmless to
    // tolerate) we fall back to using it as the body.
    payload = { body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'Match starting soon';
  const body  = payload.body  || 'Kick-off is imminent.';
  const url   = payload.url   || '/';
  const tag   = payload.tag   || (payload.matchId ? `match-${payload.matchId}` : 'isl-match');

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      // Replace any existing notification with the same tag so we don't
      // stack duplicates if the user has multiple tabs.
      renotify: false,
      icon: '/soccer-league/isl-logo.png',
      badge: '/soccer-league/isl-logo.png',
      data: { url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          // Reuse an existing tab whenever possible — opening yet another
          // tab is the most common notification UX complaint.
          if ('focus' in client) {
            client.navigate(target).catch(() => {});
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(target);
        }
        return undefined;
      }),
  );
});
