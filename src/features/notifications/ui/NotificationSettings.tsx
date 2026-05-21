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
//   Failures surface as an inline italic line below the controls, mirroring
//   the existing Profile.tsx aesthetic (FLARE colour for errors).  We never
//   throw alerts or modal dialogs — the page should never block the user.

import { useEffect, useRef, useState } from 'react';
import { COLORS } from '../../../components/Layout';
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

// ── Local style aliases ─────────────────────────────────────────────────────
// Mirrors the names used in Profile.tsx so the visual treatment matches
// without re-deriving from the shared palette in two places.
const { dust: DUST, abyss: ABYSS, flare: FLARE, quantum: QUANTUM } = COLORS;
const HAIRLINE = COLORS.hairline;
const DUST_50  = COLORS.dust50;
const DUST_70  = COLORS.dust70;

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
 * @returns A JSX subtree styled to match Profile.tsx's other section cards.
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
  // No controls — we just tell the user why and let them keep using
  // the rest of the profile page.
  if (!support.supported) {
    return (
      <Card>
        <Heading />
        <p style={advisoryStyle}>
          Push notifications {UNSUPPORTED_COPY[support.reason]}
        </p>
      </Card>
    );
  }

  // ── Normal (supported) render ────────────────────────────────────────────
  return (
    <Card>
      <Heading />

      {/* Enable / Disable primary action */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
        {enrolled ? (
          <button
            type="button"
            onClick={onDisable}
            disabled={busy}
            style={secondaryButtonStyle(busy)}
          >
            {busy ? 'Disabling…' : 'Disable Push On This Device'}
          </button>
        ) : (
          <button
            type="button"
            onClick={onEnable}
            disabled={busy}
            style={primaryButtonStyle(busy)}
          >
            {busy ? 'Enabling…' : 'Enable Push On This Device'}
          </button>
        )}

        <span style={advisoryStyle}>
          {enrolled
            ? 'This device will alert you 1 minute before kick-off.'
            : 'We will ask your browser for permission, then enrol this device.'}
        </span>
      </div>

      {/* Per-event opt-in toggles — only meaningful when enrolled */}
      <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <ToggleRow
          id="notify-favourite-team"
          label="Notify me when my favourite club plays"
          hint="Set a favourite club on this page to receive a push 1 minute before kick-off."
          checked={prefs.notify_favourite_team}
          disabled={!enrolled || busy}
          onChange={(next) => onTogglePref('notify_favourite_team', next)}
        />
        <ToggleRow
          id="notify-all-matches"
          label="Notify me for every match across the cosmos"
          hint="Warning: there can be 4–6 matches per day across the league."
          checked={prefs.notify_all_matches}
          disabled={!enrolled || busy}
          onChange={(next) => onTogglePref('notify_all_matches', next)}
        />
      </div>

      {error && (
        <p role="alert" style={{ ...advisoryStyle, color: FLARE, marginTop: 16 }}>
          {error}
        </p>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Presentational subcomponents — kept inline because they are private to this
// surface.  If a second consumer ever appears, lift them into Layout.tsx.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Outer bordered card.  Mirrors the AccountSummary card on Profile.tsx
 * so the section reads as part of the same page rather than a bolted-on
 * widget.
 */
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      border: `1px solid ${HAIRLINE}`,
      padding: 32,
      marginTop: 24,
      background: ABYSS,
    }}>
      {children}
    </div>
  );
}

/**
 * Card heading.  Uses the same small-caps label treatment as Profile's
 * SummaryCell labels.
 */
function Heading() {
  return (
    <div>
      <div style={{
        fontSize: 11,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: DUST_70,
        marginBottom: 6,
      }}>
        Push Notifications
      </div>
      <div style={{
        fontSize: 22,
        fontWeight: 700,
        color: DUST,
      }}>
        Match-Start Alerts
      </div>
    </div>
  );
}

/**
 * Single label + checkbox row.  Stacks label + hint on the left, control
 * on the right.  The whole row is rendered as a `<label>` so clicking
 * anywhere on the label toggles the checkbox — important on touch
 * targets where the checkbox itself is small.
 */
function ToggleRow({ id, label, hint, checked, disabled, onChange }: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{
          marginTop: 4,
          accentColor: QUANTUM,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 14, color: DUST }}>{label}</span>
        <span style={{ fontSize: 12, color: DUST_50, fontStyle: 'italic' }}>{hint}</span>
      </span>
    </label>
  );
}

// ── Style helpers ───────────────────────────────────────────────────────────
// Local because they reference local colour aliases.  Lifted into helpers
// so the enable / disable button shells stay one-liners in the JSX.

/**
 * Primary CTA style (Enable) — QUANTUM fill, matches Profile.tsx's
 * Save Allegiance button.
 */
function primaryButtonStyle(busy: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
    color: DUST,
    background: busy ? 'transparent' : QUANTUM,
    border: `1px solid ${QUANTUM}`,
    padding: '12px 24px',
    cursor: busy ? 'wait' : 'pointer',
    fontFamily: 'inherit',
  };
}

/**
 * Secondary CTA style (Disable) — ABYSS fill with DUST border, mirrors
 * Profile.tsx's Sign Out button so the destructive-ish action reads
 * the same across the page.
 */
function secondaryButtonStyle(busy: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
    color: DUST,
    background: ABYSS,
    border: `1px solid ${DUST}`,
    padding: '12px 24px',
    cursor: busy ? 'wait' : 'pointer',
    fontFamily: 'inherit',
  };
}

/**
 * Italic advisory line style.  Identical typography across the
 * "supported but not enrolled" hint and the error display so the
 * card's vertical rhythm stays steady.
 */
const advisoryStyle: React.CSSProperties = {
  color: DUST_70,
  fontSize: 13,
  fontStyle: 'italic',
  margin: 0,
};
