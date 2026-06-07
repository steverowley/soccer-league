// ── ResetPassword.tsx ───────────────────────────────────────────────────────
// `/reset-password` route — two phases on one page:
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
// This is the minimum viable forgot-password flow. Email-change and a
// proper /delete-account surface are tracked separately.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../components/Header';
import { COLORS, Container, Footer, SectionHeader } from '../components/Layout';
import { useSupabase } from '../shared/supabase/SupabaseProvider';
import { useAuth } from '../features/auth';
import { usePageTitle } from '../shared/hooks/usePageTitle';

const { dust: DUST, abyss: ABYSS, flare: FLARE, quantum: QUANTUM } = COLORS;
const HAIRLINE = COLORS.hairline;
const DUST_50  = COLORS.dust50;
const DUST_70  = COLORS.dust70;

/** Same minimum as Login.tsx; kept in sync via #365 follow-up to centralise. */
const MIN_PASSWORD_LENGTH = 10;

export default function ResetPassword() {
  usePageTitle('Reset Password');
  const db = useSupabase();
  const { requestPasswordReset } = useAuth();
  const navigate = useNavigate();

  // ── Recovery-session detection ─────────────────────────────────────────
  // Supabase fires a PASSWORD_RECOVERY auth event when the user lands on
  // a page with a `type=recovery` access token in the URL fragment.
  // Listen once, then unsubscribe — the rest of the page is form work.
  const [isRecovering, setIsRecovering] = useState(false);
  useEffect(() => {
    // Already in a recovery session if the URL fragment carries the token.
    // We don't parse the fragment ourselves — Supabase has already
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
    <div style={{ background: ABYSS, color: DUST, minHeight: '100vh' }}>
      <Header />
      <Container>
        <SectionHeader
          pageKicker="ACCOUNT"
          kicker={isRecovering ? 'II • SET NEW PASSWORD' : 'I • RESET PASSWORD'}
          title={isRecovering ? 'Choose a new password' : 'Forgot your password?'}
          subtitle={
            isRecovering
              ? 'Enter a new password for your account. You will be signed in immediately after.'
              : "Enter the email you signed up with. We'll send a link you can click to set a new password."
          }
        />
        {isRecovering
          ? <UpdatePasswordForm onSuccess={() => navigate('/profile', { replace: true })} />
          : <RequestResetForm requestReset={requestPasswordReset} />
        }
      </Container>
      <Footer />
    </div>
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
      <Card>
        <H>Check your inbox</H>
        <P>
          If an account exists for <strong style={{ color: DUST }}>{email}</strong>,
          a reset link is on its way. Click the link to set a new password. The
          link is single-use and expires in 1 hour.
        </P>
      </Card>
    );
  }

  return (
    <Card>
      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Field label="Email" id="email" type="email" autoComplete="email"
          value={email} onChange={setEmail} />
        {error && <ErrorLine>{error}</ErrorLine>}
        <SubmitButton busy={busy}>
          {busy ? 'Sending…' : 'Send reset link'}
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
    <Card>
      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Field label="New password" id="new-password" type="password"
          autoComplete="new-password" value={password} onChange={setPassword}
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`} />
        {error && <ErrorLine>{error}</ErrorLine>}
        <SubmitButton busy={busy}>
          {busy ? 'Saving…' : 'Save new password'}
        </SubmitButton>
      </form>
    </Card>
  );
}

// ── Local presentational helpers (one consumer each, kept inline) ───────────

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ border: `1px solid ${HAIRLINE}`, padding: 32, maxWidth: 480, margin: '24px 0' }}>
      {children}
    </div>
  );
}

function H({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontSize: 14, letterSpacing: '0.18em', textTransform: 'uppercase', margin: '0 0 16px' }}>
      {children}
    </h2>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p style={{ color: DUST_70, fontSize: 14, lineHeight: 1.6, margin: 0 }}>{children}</p>;
}

function ErrorLine({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" style={{ color: FLARE, fontSize: 13, fontStyle: 'italic', margin: 0 }}>
      {children}
    </p>
  );
}

function SubmitButton({ busy, children }: { busy: boolean; children: React.ReactNode }) {
  return (
    <button type="submit" disabled={busy} style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em',
      color: DUST, background: busy ? 'transparent' : QUANTUM,
      border: `1px solid ${QUANTUM}`, padding: '14px 24px',
      cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit', marginTop: 8,
    }}>
      {children}
    </button>
  );
}

function Field({ label, id, type, autoComplete, value, onChange, hint }: {
  label: string; id: string; type: string; autoComplete: string;
  value: string; onChange: (v: string) => void; hint?: string;
}) {
  return (
    <label htmlFor={id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: DUST_50 }}>
        {label}
      </span>
      <input id={id} type={type} autoComplete={autoComplete} value={value}
        onChange={(e) => onChange(e.target.value)} required
        style={{
          background: 'transparent', border: `1px solid ${HAIRLINE}`, color: DUST,
          padding: '10px 12px', fontFamily: 'inherit', fontSize: 14,
        }}
      />
      {hint && <span style={{ fontSize: 11, color: DUST_50 }}>{hint}</span>}
    </label>
  );
}
