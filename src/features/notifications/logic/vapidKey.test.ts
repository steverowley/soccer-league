// ── vapidKey.test.ts ────────────────────────────────────────────────────────
// Unit tests for the base64url ↔ Uint8Array conversions used by the push
// subscription flow.
//
// COVERAGE INTENT
//   - Padding correctness across all four "remainder" cases (0, 1, 2, 3
//     chars short of a multiple of 4) — bad padding is the most common
//     real-world cause of "applicationServerKey was rejected".
//   - URL-safe alphabet swap actually happens.
//   - Round-trip arrayBufferToBase64Url → urlBase64ToUint8Array preserves
//     the original bytes — this is the contract the cron worker relies on
//     when it pushes payloads back to the browser keys we persisted.

import { describe, expect, it } from 'vitest';
import { arrayBufferToBase64Url, urlBase64ToUint8Array } from './vapidKey';

describe('urlBase64ToUint8Array', () => {
  it('decodes a basic base64url string with no padding needed', () => {
    // Hand-computed: 'AQID' is base64 for [1, 2, 3].
    const out = urlBase64ToUint8Array('AQID');
    expect(Array.from(out)).toEqual([1, 2, 3]);
  });

  it('re-adds missing "=" padding (1 char short of a multiple of 4)', () => {
    // 'AQI' decodes to [1, 2] once we restore the '==' padding.
    const out = urlBase64ToUint8Array('AQI');
    expect(Array.from(out)).toEqual([1, 2]);
  });

  it('re-adds missing "=" padding (2 chars short of a multiple of 4)', () => {
    // 'AQ' decodes to [1] once we restore the '===' padding.  base64url
    // strips '=' entirely; we need to put them back before atob().
    const out = urlBase64ToUint8Array('AQ');
    expect(Array.from(out)).toEqual([1]);
  });

  it('swaps URL-safe "-" back to "+"', () => {
    // 0xFB is one of the bytes that encodes to a base64 char in the
    // '+' position.  Specifically: bytes [0xFB, 0xEF, 0xBE] → '++++'
    // in classic base64; with our shim, '----' (URL-safe) should decode
    // identically.
    const classic = urlBase64ToUint8Array('++++');
    const urlSafe = urlBase64ToUint8Array('----');
    expect(Array.from(urlSafe)).toEqual(Array.from(classic));
  });

  it('swaps URL-safe "_" back to "/"', () => {
    const classic = urlBase64ToUint8Array('////');
    const urlSafe = urlBase64ToUint8Array('____');
    expect(Array.from(urlSafe)).toEqual(Array.from(classic));
  });
});

describe('arrayBufferToBase64Url', () => {
  it('returns "" for null input so callers can detect missing keys', () => {
    // Some browsers refuse to expose subscription keys (privacy mode,
    // unprivileged contexts).  We surface that as empty-string rather
    // than throwing so the UI can show a friendly error.
    expect(arrayBufferToBase64Url(null)).toBe('');
  });

  it('produces output containing none of "+", "/", or "="', () => {
    // 8 sequential bytes covers all base64 char positions and forces
    // at least one '=' in the classic encoding — the test asserts our
    // URL-safe conversion strips it.
    const buf = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]).buffer;
    const encoded = arrayBufferToBase64Url(buf);
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it('round-trips bytes through both functions losslessly', () => {
    // The cron worker only ever decodes what the browser encoded; if
    // the round-trip drops or scrambles bytes, every push fails decryption.
    const original = new Uint8Array([255, 254, 1, 0, 128, 127, 64, 63, 16]);
    const encoded = arrayBufferToBase64Url(original.buffer);
    const decoded = urlBase64ToUint8Array(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });
});
