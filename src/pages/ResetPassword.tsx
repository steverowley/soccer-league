// ── ResetPassword.tsx ───────────────────────────────────────────────────────
// `/reset-password` route: two phases on one page.
//
//   1. REQUEST phase (no recovery JWT in URL):
//      Render a "send me a reset link" email form. Calls
//      AuthProvider.requestPasswordReset(); Supabase emails the user a
//      magic link that lands them back on this same route with a
//      `type=recovery` access token in the URL fragment.
//
//   2. UPDATE phase (recovery JWT in URL):
//      Supabase's Auth client picks up the fragment and emits a
//      `PASSWORD_RECOVERY` event via onAuthStateChange. The page detects
//      the recovery session and renders a "set new password" form;
//      submission calls `supabase.auth.updateUser({ password })` and
//      navigates back to /profile on success.
//
// On the design language since group 5a (docs/design-language.md), with no
// raw style values: a hairline Card around the shared form pieces (Field,
// FormError) and one primary submit per form. The old purple submit is
// gone (purple is the Architect and the focus ring, never an action).
//
// This is the minimum viable forgot-password flow. Email change and a
// proper /delete-account surface are tracked separately.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Field, FormError, PageHeader, PageShell, inputStyle } from '../shared/ui';
import { space, tone, type } from '../shared/design';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import { useAuth } from '../features/auth';
import { usePageTitle } from '../shared/hooks/usePageTitle';

/** Same minimum as Login.tsx; kept in sync via the #365 follow-up to centralise. */
const MIN_PASSWORD_LENGTH = 10;

/** The form card: a hairline Card at a comfortable form width. */
const FORM_CARD = { maxWidth: 480 } as const;

/**
 * Reset-password page.
 *
 * @returns The page in its request or update phase.
 */
export default function ResetPassword() {
  usePageTitle('Reset Password');
  const db = useSupabase();
  const { requestPasswordReset } = useAuth();
  const navigate = useNavigate();

  // ── Recovery-session detection ─────────────────────────────────────────
  // Supabase fires a PASSWORD_RECOVERY auth event when the user lands on
  // a page with a `type=recovery` access token in the URL fragment.
  // Listen once, then unsubscribe: the rest of the page is form work.
  const [isRecovering, setIsRecovering] = useState(false);
  useEffect(() => {
    // Already in a recovery session if the URL fragment carries the token.
    // We don't parse the fragment ourselves: Supabase has already
    // processed it by the time React mounts, but we read the flag again
    // through onAuthStateChange so the event-based path also works.
    const { data: { subscription } } = db.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setIsRecovering(true);
    });
    // Also flip when the page is opened with a hash fragment that
    // already established a session before React mounted.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot sync hydration: mirror the URL-fragment recovery hint into React state once on mount so the form switches modes without waiting for the subscription event
    if (window.location.hash.includes('type=recovery')) setIsRecovering(true);
    return () => subscription.unsubscribe();
  }, [db]);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Account"
        title={isRecovering ? 'Choose a new password' : 'Forgot your password?'}
        subtitle={
          isRecovering
            ? 'Enter a new password for your account. You will be signed in immediately after.'
            : "Enter the email you signed up with. We'll send a link you can click to set a new password."
        }
      />
      <section aria-label="Password reset">
        {isRecovering
          ? <UpdatePasswordForm onSuccess={() => navigate('/profile', { replace: true })} />
          : <RequestResetForm requestReset={requestPasswordReset} />
        }
      </section>
    </PageShell>
  );
}

// ── Phase 1: request a reset email ──────────────────────────────────────────

function RequestResetForm({
  requestReset,
}: {
  requestReset: (email: string) => Promise<string | null>;
}) {
  const [email, setEmail] = useState('');
  const [busy,  setBusy]  = useState(false);
  const [sent,  setSent]  = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    if (!email) { setError('Email is required.'); return; }
    setBusy(true);
    const err = await requestReset(email);
    setBusy(false);
    if (err) { setError(err); return; }
    // Always show "sent" regardless of whether the email exists. Supabase
    // intentionally doesn't surface user enumeration via this endpoint,
    // and we follow suit so an attacker can't probe for emails.
    setSent(true);
  };

  if (sent) {
    return (
      <Card style={FORM_CARD}>
        <h2 style={{ ...type.subheading, margin: 0 }}>Check your inbox</h2>
        <p style={{ ...type.body, ...tone.secondary, margin: 0, marginTop: space[16] }}>
          If an account exists for <strong style={tone.primary}>{email}</strong>,
          a reset link is on its way. Click the link to set a new password. The
          link is single-use and expires in 1 hour.
        </p>
      </Card>
    );
  }

  return (
    <Card style={FORM_CARD}>
      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: space[16] }}>
        <Field id="email" label="Email">
          <input id="email" type="email" autoComplete="email" required
            value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
        </Field>
        {error && <FormError>{error}</FormError>}
        <SubmitButton busy={busy}>
          {busy ? 'Sending\u2026' : 'Send reset link'}
        </SubmitButton>
      </form>
    </Card>
  );
}

// ── Phase 2: set new password (recovery session is already live) ────────────

function UpdatePasswordForm({ onSuccess }: { onSuccess: () => void }) {
  const db = useSupabase();
  const [password, setPassword] = useState('');
  const [busy,     setBusy]     = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    setBusy(true);
    const { error: err } = await db.auth.updateUser({ password });
    setBusy(false);
    if (err) { setError(err.message); return; }
    onSuccess();
  };

  return (
    <Card style={FORM_CARD}>
      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: space[16] }}>
        <Field id="new-password" label="New password" hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}>
          <input id="new-password" type="password" autoComplete="new-password" required
            value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} />
        </Field>
        {error && <FormError>{error}</FormError>}
        <SubmitButton busy={busy}>
          {busy ? 'Saving\u2026' : 'Save new password'}
        </SubmitButton>
      </form>
    </Card>
  );
}

/** The form's one primary action. */
function SubmitButton({ busy, children }: { busy: boolean; children: React.ReactNode }) {
  return (
    <Button variant="primary" type="submit" disabled={busy} style={{ alignSelf: 'flex-start', marginTop: space[8] }}>
      {children}
    </Button>
  );
}
