// ── NotificationSettings.tsx ────────────────────────────────────────────────
// Profile-page surface for browser push notifications.
//
// VISIBLE STATE MATRIX
//   1. Unsupported environment → render a single advisory line, no controls.
//   2. Supported but not yet enrolled → "Enable push" button + permission
//      hint.
//   3. Enrolled → "Disable push" button + the two opt-in toggles for
//      'notify favourite team' and 'notify all matches'.  Toggles are
//      disabled until enrolled because pushing to a user with no
//      subscription is pointless.
//   4. Permission denied at OS / browser → advisory line + a "Re-enable"
//      escape hatch that opens browser-settings docs.
//
// NETWORK CALLS
//   On mount: getCurrentPushEndpoint() (cheap, local) +
//             getNotificationPreferences() (Supabase, RLS-scoped).
//   On enable: enablePush() — permission prompt + sw.js + PushManager
//             subscribe + DB upsert.
//   On disable: disablePush() — PushManager unsubscribe + DB delete.
//   On toggle:  updateNotificationPreferences({ … }) — single column UPDATE.
//
// ERROR DISPLAY
//   Failures surface as an inline FormError below the controls (red,
//   role="alert"). We never throw alerts or modal dialogs: the page should
//   never block the user.
//
// On the design language since group 5a (docs/design-language.md), with no
// raw style values: a hairline Card, a secondary Enable / Disable Button
// (the profile page keeps its one primary for Save allegiance), and the
// shared CheckField rows. The card no longer repeats its own heading: the
// profile page introduces it with a numbered SectionHeader.

import { useEffect, useRef, useState } from 'react';
import { tone, space, type } from '../../../shared/design';
import { Button, Card, CheckField, FormError } from '../../../shared/ui';
import { useSupabase } from '../../../shared/supabase/SupabaseProvider';
import {
  getNotificationPreferences,
  updateNotificationPreferences,
} from '../api/pushSubscriptions';
import {
  checkPushSupport,
  disablePush,
  enablePush,
  getCurrentPushEndpoint,
  type PushUnsupported,
} from '../logic/registerPush';
import type { NotificationPreferences } from '../types';

// ── Copy table ──────────────────────────────────────────────────────────────
// Per-reason copy for `PushUnsupported.reason`.  Keep these short and
// actionable — the user is on /profile, not a help center.
//
// Each value is the body of a single line — the UI prepends "Push
// notifications" to all of them in the render.
const UNSUPPORTED_COPY: Record<PushUnsupported['reason'], string> = {
  'no-notification-api': 'are not supported in this browser.',
  'no-service-worker':   'require service worker support, which this browser lacks.',
  'no-push-manager':     'are not available here. On iOS, install this site to your home screen first.',
  'no-vapid-key':        'are not configured for this deployment. Contact an admin.',
};

/**
 * Default-paint preferences while the network round-trip is still in
 * flight.  Both false so we never optimistically show "you're subscribed
 * to all matches" before the row actually loads.
 */
const PENDING_PREFS: NotificationPreferences = {
  notify_favourite_team: false,
  notify_all_matches:    false,
};

/**
 * Push-notifications settings card for the /profile page.
 *
 * Self-contained: reads its own state (subscription endpoint + opt-in
 * prefs) from Supabase on mount and writes through the api/ layer on
 * every change.  Parent component does not have to thread props.
 *
 * @returns A hairline Card with the enrolment control and the opt-in rows.
 */
export default function NotificationSettings() {
  const db = useSupabase();

  // ── Support detection ────────────────────────────────────────────────────
  // Run once at mount.  The result never changes within a session, so
  // we keep it in plain state rather than re-checking on every render.
  const [support] = useState(checkPushSupport);

  // ── Subscription endpoint ────────────────────────────────────────────────
  // `null` until the first lookup resolves; `''` would conflate "no
  // subscription" with "loading", so we keep that distinction.
  const [endpoint, setEndpoint] = useState<string | null | undefined>(undefined);

  // ── Opt-in preferences ───────────────────────────────────────────────────
  // Defaults to both-false so the toggles render unchecked while the
  // round-trip is in flight; the real values overwrite on resolve.
  const [prefs, setPrefs] = useState<NotificationPreferences>(PENDING_PREFS);

  // ── Errors + busy ────────────────────────────────────────────────────────
  const [error, setError] = useState<string | null>(null);
  const [busy,  setBusy]  = useState<boolean>(false);

  // ── Hydration vs user-action race guard ──────────────────────────────────
  // If the user clicks a toggle BEFORE this first-paint fetch resolves,
  // we must NOT overwrite their just-saved choice with the pre-write
  // DB snapshot.  `hydratedRef` flips to `true` the moment any user
  // action writes to the DB (in `onTogglePref`), and the hydration
  // effect below refuses to setPrefs() after that flag is set.
  const hydratedRef = useRef(false);

  // ── First-paint hydration ────────────────────────────────────────────────
  // Runs once.  Reads the local PushManager state AND the DB prefs in
  // parallel — neither blocks the other so the worst-case latency is
  // max(local, network) rather than their sum.
  useEffect(() => {
    let cancelled = false;

    Promise.all([
      getCurrentPushEndpoint(),
      getNotificationPreferences(db),
    ]).then(([currentEndpoint, prefsResult]) => {
      if (cancelled) return;
      setEndpoint(currentEndpoint);
      // Race guard: a user click that wrote to the DB before this
      // hydration resolved already mutated local state with the
      // user's intent.  Overwriting it now with the PRE-WRITE DB
      // snapshot would silently revert the toggle the user just
      // clicked.  Skip the setPrefs in that case — the user's value
      // is already correct on both sides (UI + DB) and any subsequent
      // tab will hydrate against the now-post-write DB.
      if (hydratedRef.current) return;
      hydratedRef.current = true;
      if (prefsResult.data) setPrefs(prefsResult.data);
      else if (prefsResult.error) {
        // Don't surface a hard error here — a missing row is not a
        // user-facing failure.  It just means the toggles stay
        // defaulted off, which is exactly the right behaviour.
        console.warn('[NotificationSettings] preferences fetch:', prefsResult.error);
      }
    }).catch((err) => {
      if (!cancelled) console.warn('[NotificationSettings] hydration failed:', err);
    });

    return () => { cancelled = true; };
  }, [db]);

  // Whether the user currently has an active push subscription on this
  // device.  Used to gate the opt-in toggles — pushing prefs without
  // a subscription has no effect.
  const enrolled = typeof endpoint === 'string' && endpoint.length > 0;

  // ── Action: enable ──────────────────────────────────────────────────────
  /**
   * Run the full enrolment flow.  See `enablePush` for layer details.
   * On success we record the new endpoint so the UI flips to the
   * enrolled state without a re-fetch.
   */
  const onEnable = async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await enablePush(db);
      switch (result.status) {
        case 'enabled':
          setEndpoint(result.endpoint);
          break;
        case 'denied':
          setError('Permission denied. Re-enable notifications in your browser settings to retry.');
          break;
        case 'dismissed':
          setError('Notification permission was dismissed. Click Enable again to retry.');
          break;
        case 'unsupported':
          setError(`Push notifications ${UNSUPPORTED_COPY[result.reason]}`);
          break;
        case 'error':
          setError(result.error);
          break;
      }
    } finally {
      setBusy(false);
    }
  };

  // ── Action: disable ─────────────────────────────────────────────────────
  /**
   * Tear down the subscription on this device.  Optimistically flip the
   * UI state, then roll back if the underlying call surfaces an error.
   */
  const onDisable = async () => {
    setError(null);
    setBusy(true);
    const previousEndpoint = endpoint;
    setEndpoint(null);
    try {
      const err = await disablePush(db);
      if (err) {
        setError(err);
        setEndpoint(previousEndpoint);
      }
    } finally {
      setBusy(false);
    }
  };

  // ── Action: toggle a preference ──────────────────────────────────────────
  /**
   * Flip one of the two opt-in toggles.  Optimistic UI: we mutate local
   * state immediately so the checkbox feels responsive, then roll back
   * on persistence failure.
   *
   * @param key   Which of the two preferences to flip.
   * @param next  Desired boolean value (matches the `<input checked>` flip).
   */
  const onTogglePref = async (key: keyof NotificationPreferences, next: boolean) => {
    setError(null);
    const previous = prefs;
    setPrefs({ ...prefs, [key]: next });
    // Block any later first-paint hydration from clobbering this just-set
    // user choice (see hydratedRef block above).  Even if the write
    // below fails and we roll back, the user's INTENT is captured —
    // letting the hydration snapshot win after a click is the worse
    // failure mode (silently reverts a deliberate action).
    hydratedRef.current = true;
    const { error: updateError } = await updateNotificationPreferences(db, { [key]: next });
    if (updateError) {
      setPrefs(previous);
      setError(updateError);
    }
  };

  // ── Unsupported environment branch ───────────────────────────────────────
  // No controls: we just tell the user why and let them keep using the
  // rest of the profile page.
  if (!support.supported) {
    return (
      <Card>
        <p style={advisoryStyle}>
          Push notifications {UNSUPPORTED_COPY[support.reason]}
        </p>
      </Card>
    );
  }

  // ── Normal (supported) render ────────────────────────────────────────────
  return (
    <Card>
      {/* Enable / Disable: a secondary Button either way. The page's one
          primary action is Save allegiance above. */}
      <div style={{ display: 'flex', gap: space[16], alignItems: 'center', flexWrap: 'wrap' }}>
        {enrolled ? (
          <Button variant="secondary" onClick={onDisable} disabled={busy}>
            {busy ? 'Disabling\u2026' : 'Disable push on this device'}
          </Button>
        ) : (
          <Button variant="secondary" onClick={onEnable} disabled={busy}>
            {busy ? 'Enabling\u2026' : 'Enable push on this device'}
          </Button>
        )}

        <span style={advisoryStyle}>
          {enrolled
            ? 'This device will alert you 1 minute before kick-off.'
            : 'We will ask your browser for permission, then enrol this device.'}
        </span>
      </div>

      {/* Per-event opt-in toggles: only meaningful when enrolled. */}
      <div style={{ marginTop: space[24], display: 'flex', flexDirection: 'column', gap: space[12] }}>
        <CheckField
          id="notify-favourite-team"
          hint="Set a favourite club on this page to receive a push 1 minute before kick-off."
          checked={prefs.notify_favourite_team}
          disabled={!enrolled || busy}
          onChange={(next) => onTogglePref('notify_favourite_team', next)}
        >
          Notify me when my favourite club plays
        </CheckField>
        <CheckField
          id="notify-all-matches"
          hint="Heads up: there can be 4 to 6 matches per day across the league."
          checked={prefs.notify_all_matches}
          disabled={!enrolled || busy}
          onChange={(next) => onTogglePref('notify_all_matches', next)}
        >
          Notify me for every match across the cosmos
        </CheckField>
      </div>

      {error && (
        <div style={{ marginTop: space[16] }}>
          <FormError>{error}</FormError>
        </div>
      )}
    </Card>
  );
}

/**
 * Advisory line: the "supported but not enrolled" hint and the unsupported
 * explanation. Small type, secondary tone.
 */
const advisoryStyle: React.CSSProperties = {
  ...type.small,
  ...tone.secondary,
  margin: 0,
};
