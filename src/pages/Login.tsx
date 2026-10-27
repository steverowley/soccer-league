// ── Login.tsx ───────────────────────────────────────────────────────────────
// Auth gateway: the `/login` route.
//
// Layout:
//   PageShell (site header, main column, footer)
//   PageHeader: eyebrow "Account", title, intro prose
//   Card: a Log in / Sign up toggle (two Tags) above a single form
//
// Combined form (rather than two routes) because Log In and Sign Up share
// most of the same fields and the toggle reads better than "Don't have an
// account? Sign up here" navigation.
//
// On the design language since group 5a (docs/design-language.md), with no
// raw style values (scripts/designTokens.test.ts): the shared form pieces
// (Field, CheckField, FormError in src/shared/ui/Field.tsx), exactly one
// primary Button (the submit, the view's one orange action, now that the
// header's Sign up is secondary), and tertiary text links for the
// secondary actions (forgot password, try again).
//
// On success: redirects via React Router's useNavigate. AuthProvider
// exposes signIn / signUp helpers that wrap Supabase's email and password
// flows; this page is presentation and validation only.

import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  Button,
  Card,
  CheckField,
  Field,
  FormError,
  LoadingState,
  PageHeader,
  PageShell,
  Tag,
  TextLink,
  inputStyle,
} from '../shared/ui';
import { space, tone, type } from '../shared/design';
import { useAuth } from '../features/auth';
import { usePageTitle } from '../shared/hooks/usePageTitle';

// ── Mode sentinels ─────────────────────────────────────────────────────────
// MODE_LOGIN / MODE_SIGNUP: string ids for the two-way toggle. Plain string
// literals (not Symbol) so they survive React state diffing cleanly.
const MODE_LOGIN  = 'login';
const MODE_SIGNUP = 'signup';

type Mode = typeof MODE_LOGIN | typeof MODE_SIGNUP;

// ── Field constraints ─────────────────────────────────────────────────────
// Stricter than the Supabase Auth default (6). The server-side floor is also
// raised to match in #365's PR body; together with HaveIBeenPwned (operator
// toggle), this closes the weak-password vector flagged by the security audit.
const MIN_PASSWORD_LENGTH = 10;
const MIN_USERNAME_LENGTH = 3;
/**
 * Server-side cap from migration 0057. Surfaced client-side so users
 * see the limit before submitting a name the trigger would reject.
 */
const MAX_USERNAME_LENGTH = 32;
/**
 * Mirror of the reserved-word list in migration 0057's trigger
 * (enforce_username_policy). Kept in lockstep manually: when the
 * server-side list grows, copy the additions here so the UI rejects
 * the same names without a round-trip. Names compared lower-case and
 * trimmed.
 */
const RESERVED_USERNAMES = new Set<string>([
  'architect', 'cosmic', 'cosmos', 'balance', 'chaos', 'fate',
  'first voice', 'second voice', 'third voice',
  'vox', 'nexus-7', 'nexus7', 'zara',
  'admin', 'administrator', 'system', 'official', 'mod', 'moderator',
  'support', 'staff', 'isl', 'isl-official', 'root',
  'deleted', 'deleted user', '[deleted]',
]);

/** The form card: a hairline Card at a comfortable form width. */
const FORM_CARD = { maxWidth: 480 } as const;

/**
 * Login and signup page.
 *
 * Renders a single card with a mode toggle. Login mode collects email and
 * password; signup mode adds a username field above them. Already-signed-in
 * users are redirected to /profile via <Navigate /> on render (cheaper than
 * an effect).
 *
 * @returns The page.
 */
export default function Login() {
  usePageTitle('Sign In');
  const { user, signIn, signUp, loading } = useAuth();
  const navigate = useNavigate();

  const [mode,         setMode]         = useState<Mode>(MODE_LOGIN);
  const [email,        setEmail]        = useState('');
  const [password,     setPassword]     = useState('');
  const [username,     setUsername]     = useState('');
  // Signup-only: required-by-ToS self-attestation that the user is 18+.
  // The game simulates betting; even with no real money, an 18+ gate is
  // industry standard and matches Apple/Google policy for webview wrappers.
  const [ageConfirmed, setAgeConfirmed] = useState<boolean>(false);
  const [error,        setError]        = useState<string | null>(null);
  const [busy,         setBusy]         = useState<boolean>(false);
  // Post-signup "check your inbox" state. When set, the form is replaced
  // with a confirmation prompt so the user knows the next step instead of
  // being silently dropped at / (the pre-#365 bug).
  const [pendingConfirmEmail, setPendingConfirmEmail] = useState<string | null>(null);

  // Reset transient form state on mode swap so values entered in one
  // mode don't bleed into the other (e.g. a half-typed signup password
  // shouldn't auto-populate the login form).
  useEffect(() => {
    setError(null);
    setBusy(false);
  }, [mode]);

  // Authenticated users have no business on /login. Redirect to /profile,
  // as a render-time <Navigate> rather than a useEffect navigate so the
  // redirect happens before the form ever paints.
  if (loading) {
    return (
      <Shell>
        <LoadingState label="Checking the void for an active session" />
      </Shell>
    );
  }
  if (user) {
    return <Navigate to="/profile" replace />;
  }

  // ── Post-signup "check your inbox" panel ──────────────────────────────
  // When email confirmation is enabled in Supabase Auth, signUp returns
  // success with no session. Render an explicit panel so the user knows
  // the email is on its way and not just "the form quietly succeeded".
  if (pendingConfirmEmail) {
    return (
      <Shell>
        <Card style={FORM_CARD}>
          <h2 style={{ ...type.subheading, margin: 0 }}>Check your inbox</h2>
          <p style={{ ...type.body, ...tone.secondary, margin: 0, marginTop: space[16] }}>
            We sent a confirmation link to{' '}
            <strong style={tone.primary}>{pendingConfirmEmail}</strong>.
            Click the link to verify your account and complete sign-up. The
            link is single-use and expires in 24 hours.
          </p>
          <div style={{ marginTop: space[16], display: 'flex', alignItems: 'center', gap: space[12], flexWrap: 'wrap' }}>
            <span style={{ ...type.small, ...tone.secondary }}>Wrong email?</span>
            <Button variant="tertiary" onClick={() => setPendingConfirmEmail(null)}>Try again</Button>
          </div>
        </Card>
      </Shell>
    );
  }

  /**
   * Submit the form. Routes the call through signIn or signUp based on the
   * active mode. On success: navigate on. On failure: surface the error
   * string returned by the auth helper.
   */
  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    // Client-side guard rails: the API will reject these too, but a local
    // check saves a round-trip and a jarring error.
    if (!email || !password) {
      setError('Email and password are required.');
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (mode === MODE_SIGNUP && username.length < MIN_USERNAME_LENGTH) {
      setError(`Username must be at least ${MIN_USERNAME_LENGTH} characters.`);
      return;
    }
    if (mode === MODE_SIGNUP && username.length > MAX_USERNAME_LENGTH) {
      setError(`Username must be ${MAX_USERNAME_LENGTH} characters or fewer.`);
      return;
    }
    // Reserved-name check (#401). Mirror of the server-side trigger so we
    // reject before the round-trip. The server still enforces the same
    // list; a determined attacker bypassing the client gets the same 23514
    // from Postgres.
    if (mode === MODE_SIGNUP && RESERVED_USERNAMES.has(username.trim().toLowerCase())) {
      setError(`"${username}" is reserved. Pick another.`);
      return;
    }
    if (mode === MODE_SIGNUP && !ageConfirmed) {
      setError('You must confirm you are at least 18 years old to sign up.');
      return;
    }

    setBusy(true);
    try {
      if (mode === MODE_LOGIN) {
        const err = await signIn(email, password);
        if (err) { setError(err); return; }
        // Returning logins go straight home: they picked allegiance long
        // ago, so the welcome wizard would self-redirect to / anyway.
        navigate('/', { replace: true });
        return;
      }

      // Signup branch: handle the discriminated SignUpResult from
      // AuthProvider so the user sees the correct next step instead of
      // being silently dropped at / (the pre-#365 bug).
      const result = await signUp(email, password, username);
      if (result.kind === 'error') {
        setError(result.error);
        return;
      }
      if (result.kind === 'confirmation_required') {
        setPendingConfirmEmail(result.email);
        return;
      }
      // result.kind === 'session': signed in immediately. Send first-time
      // users to /welcome so they pick a favourite club and player.
      // Welcome.tsx self-redirects users with favourite_team_id already
      // set, so the wizard is one-shot.
      navigate('/welcome', { replace: true });
    } catch (err) {
      console.warn('[Login] submit threw:', err);
      setError('Unexpected error. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const signingUp = mode === MODE_SIGNUP;

  return (
    <Shell>
      <Card style={FORM_CARD}>
        {/* Mode toggle: two toggle Tags (the selected one is the Lunar Dust
            fill), each a 44 px target. */}
        <div role="group" aria-label="Log in or sign up" style={{ display: 'flex', gap: space[8], marginBottom: space[24] }}>
          <Tag
            selected={mode === MODE_LOGIN}
            onClick={() => setMode(MODE_LOGIN)}
            style={{ minHeight: 44, flex: 1, justifyContent: 'center' }}
          >
            Log in
          </Tag>
          <Tag
            selected={signingUp}
            onClick={() => setMode(MODE_SIGNUP)}
            style={{ minHeight: 44, flex: 1, justifyContent: 'center' }}
          >
            Sign up
          </Tag>
        </div>

        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: space[16] }}>
          {signingUp && (
            <Field id="username" label="Username" hint={`At least ${MIN_USERNAME_LENGTH} characters.`}>
              <input
                id="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                style={inputStyle}
              />
            </Field>
          )}
          <Field id="email" label="Email">
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field
            id="password"
            label="Password"
            hint={signingUp ? `At least ${MIN_PASSWORD_LENGTH} characters.` : undefined}
          >
            <input
              id="password"
              type="password"
              autoComplete={signingUp ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={inputStyle}
            />
          </Field>

          {/* 18+ age attestation: required for signup per the Terms. The
              links open in a new tab so a half-filled form survives. */}
          {signingUp && (
            <CheckField id="age-confirm" checked={ageConfirmed} onChange={setAgeConfirmed}>
              I am at least 18 years old and accept the{' '}
              <TextLink to="/terms" newTab>Terms</TextLink> and{' '}
              <TextLink to="/privacy" newTab>Privacy Policy</TextLink>.
            </CheckField>
          )}

          {error && <FormError>{error}</FormError>}

          <Button variant="primary" type="submit" disabled={busy} style={{ alignSelf: 'flex-start', marginTop: space[8] }}>
            {busy
              ? (signingUp ? 'Creating account\u2026' : 'Signing in\u2026')
              : (signingUp ? 'Create account' : 'Log in')}
          </Button>

          {signingUp && (
            <p style={{ ...type.small, ...tone.secondary, margin: 0 }}>
              200 starting credits granted on first sign-in.
            </p>
          )}

          {/* Forgot password (login mode only): the two-phase ResetPassword
              page (request email, then set a new password). */}
          {!signingUp && (
            <p style={{ ...type.small, margin: 0 }}>
              <TextLink to="/reset-password">Forgot password?</TextLink>
            </p>
          )}
        </form>
      </Card>
    </Shell>
  );
}

/**
 * Page shell: PageShell and the shared PageHeader, common to the loading,
 * check-your-inbox and form states. Extracted so the render branches can't
 * drift on the header copy, and each renders exactly one h1.
 *
 * @param children  The state's body.
 */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <PageShell>
      <PageHeader
        eyebrow="Account"
        title="Step Into The Void"
        subtitle="Claim a username, pick a club, place bets, vote on focuses, train players. Every account starts with 200 Intergalactic Credits."
      />
      <section aria-label="Account">{children}</section>
    </PageShell>
  );
}
