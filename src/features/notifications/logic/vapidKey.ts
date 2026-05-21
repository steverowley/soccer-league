// ── vapidKey.ts ──────────────────────────────────────────────────────────────
// Pure utility module for the browser-side push subscription flow.
//
// WHY THIS FILE EXISTS
//   `PushManager.subscribe()` accepts the VAPID public key only as a raw
//   `Uint8Array` — but the key is shipped to the browser as a base64url
//   string (it's the friendliest format for an env var).  The conversion
//   is small but error-prone (URL-safe alphabet, missing '=' padding) and
//   appears in every web-push tutorial.  Isolating it here means the UI
//   stays declarative and the conversion gets its own unit tests.
//
// NO RUNTIME DEPENDENCIES
//   This module is pure TS — no React, no Supabase, no `window.*` reads.
//   That makes it trivially unit-testable under Vitest's jsdom env and
//   keeps the `logic/` layer boundary clean (api/ never imports logic/
//   secrets or vice-versa).

/**
 * Convert a base64url-encoded string into the `Uint8Array` shape that
 * `PushManager.subscribe({ applicationServerKey })` requires.
 *
 * base64url is the standards-track URL-safe variant of base64:
 *   - `+`  →  `-`
 *   - `/`  →  `_`
 *   - trailing `=` padding is omitted.
 *
 * Browsers' `atob()` only accepts the classic base64 alphabet with full
 * `=` padding, so we have to translate both directions before decoding.
 * If the input string has fewer than 4 trailing chars relative to a
 * multiple of 4, we re-pad with `=` to make `atob()` happy.
 *
 * @param base64UrlString  The VAPID public key as published in env / config.
 *                         Expected to be base64url (no '+', '/', or '=').
 * @returns                A raw byte array ready for `applicationServerKey`.
 *
 * @example
 *   const key = urlBase64ToUint8Array('BNbN...g8c');
 *   await registration.pushManager.subscribe({ applicationServerKey: key });
 */
export function urlBase64ToUint8Array(base64UrlString: string): Uint8Array {
  // ── Padding ────────────────────────────────────────────────────────────────
  // base64 expects the encoded length to be a multiple of 4; base64url
  // strips the trailing '=' chars.  We compute how many '=' chars to put
  // back so the string is the correct length again.
  //   (4 - (len % 4)) % 4   →   0, 1, 2, or 3
  const padding = '='.repeat((4 - (base64UrlString.length % 4)) % 4);

  // ── Alphabet swap ─────────────────────────────────────────────────────────
  // base64url uses '-' and '_' where classic base64 uses '+' and '/'.
  // We restore the classic alphabet before `atob()`.
  const base64 = (base64UrlString + padding).replace(/-/g, '+').replace(/_/g, '/');

  // ── Decode ────────────────────────────────────────────────────────────────
  // `atob()` yields a "binary string" — each char's code point is one
  // byte's value (0–255).  We materialise that as a `Uint8Array` so the
  // PushManager sees raw bytes instead of UTF-16 code units.
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Encode an `ArrayBuffer` returned by `PushSubscription.getKey()` as a
 * base64url string suitable for persisting in Postgres TEXT columns.
 *
 * `getKey('p256dh')` and `getKey('auth')` both return `ArrayBuffer`s; the
 * web-push server library expects them as base64url.  Doing the encode
 * client-side lets the api/ layer stay generic (only string columns
 * touch the DB).
 *
 * @param buffer  Raw key bytes from `PushSubscription.getKey()`.  May be
 *                `null` if the browser refused to expose the key — we
 *                return `''` in that case so the caller can detect it
 *                via a length check.
 * @returns       base64url-encoded string (no '+', '/', or '=').
 */
export function arrayBufferToBase64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) return '';

  // ── Bytes → binary string ────────────────────────────────────────────────
  // `btoa()` consumes a binary string (one char per byte), so we build
  // one from the buffer byte-by-byte.  String.fromCharCode w/ spread is
  // capped at ~120k args on some engines; the keys are tiny (≤65 bytes)
  // so a loop is overkill but unambiguous.
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }

  // ── Binary string → base64 → base64url ───────────────────────────────────
  // Strip the '=' padding and swap '+/' → '-_' so the result is the
  // URL-safe variant expected by every web-push server library.
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
