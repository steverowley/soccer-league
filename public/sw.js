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
        // ── Preferred: a tab already on the target URL ─────────────────
        // Simply focus it; no navigation needed, and any in-flight UI
        // state on that tab is preserved.
        for (const client of clients) {
          if (client.url === target && 'focus' in client) {
            return client.focus();
          }
        }
        // ── Fallback: an app tab on the same origin we can navigate ────
        // We intentionally DO NOT navigate a tab whose URL is on a
        // different origin (extension popups, devtools panes, the
        // browser's `chrome://` views surface here on some platforms).
        // We also avoid yanking the user away from an arbitrary same-
        // origin tab they may be using productively (composing in
        // /profile, watching another match): we prefer to open a new
        // tab unless the existing tab is on a safe "anchor" surface
        // (the app root or another /matches/:id page).  This is the
        // smallest behaviour change that still satisfies "reuse a tab
        // when there's an obvious one to reuse".
        for (const client of clients) {
          if (!('focus' in client)) continue;
          let path = '';
          try {
            path = new URL(client.url).pathname;
          } catch {
            continue;
          }
          // Only reuse if the tab is already on an app surface where
          // navigating won't cost the user unsaved state.  Match
          // anchors are intentionally narrow — root, the matches list,
          // and any other match detail page.
          const safeToNavigate =
            path === '/' ||
            path.endsWith('/') ||
            path.includes('/matches');
          if (safeToNavigate) {
            client.navigate(target).catch(() => {});
            return client.focus();
          }
        }
        // ── Last resort: open a new tab ────────────────────────────────
        if (self.clients.openWindow) {
          return self.clients.openWindow(target);
        }
        return undefined;
      }),
  );
});
