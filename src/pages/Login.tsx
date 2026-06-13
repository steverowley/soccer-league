// ── Login.tsx ───────────────────────────────────────────────────────────────
// Auth gateway — `/login` route, rebuilt in PR 8.
//
// Layout:
//   Header (global)
//   I.   Page hero            — kicker "Account" + title + intro prose
//   II.  Card with mode toggle — Log In / Sign Up tabs above a single form
//   Footer (shared)
//
// Combined form (rather than two routes) because Log In and Sign Up
// share 80 % of the same fields and the toggle reads better than
// "Don't have an account? Sign up here" navigation.
//
// On success: redirects to / (Home) via React Router's useNavigate.
// AuthProvider already exposes signIn / signUp helpers that wrap
// Supabase's email + password flows; this page is pure presentation +
// validation.

import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import Header from '../components/Header';
import { COLORS, Container, SectionHeader, Footer } from '../components/Layout';
import { useAuth } from '../features/auth';

// ── Local aliases for terser inline styles ──────────────────────────────────
// ASTRO (action) drives the Log In / Create Account submit button — the loud
// call to action on this page.  QUANTUM stays the focus colour.  FLARE is
// retained for the form-error message line where validation failures (bad
// email, short password, auth API error) surface.
const { dust: DUST, abyss: ABYSS, flare: FLARE, quantum: QUANTUM, astro: ASTRO } = COLORS;
const HAIRLINE = COLORS.hairline;
const DUST_50  = COLORS.dust50;
const DUST_70  = COLORS.dust70;

// ── Mode sentinels ─────────────────────────────────────────────────────────
// MODE_LOGIN / MODE_SIGNUP — string ids for the two-tab toggle.  Plain
// string literals (not Symbol) so they survive React state diffing
// cleanly.
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
 * (enforce_username_policy). Kept in lockstep manually — when the
 * server-side list grows, copy the additions here so the UI rejects
 * the same names without a round-trip. Names compared lower-case +
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

/**
 * Login + signup page.
 *
 * Renders a single card with a mode toggle.  Login mode collects
 * email + password; signup mode adds a username field above them.
 * Already-signed-in users are redirected to /profile via
 * <Navigate /> on render (cheaper than an effect).
 */
import { usePageTitle } from '../shared/hooks/usePageTitle';

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

  // Authenticated users have no business on /login.  Redirect to
  // /profile.  Done as a render-time <Navigate> rather than a useEffect
  // navigate so the redirect happens before the form ever paints.
  if (loading) {
    return (
      <Shell>
        <p style={{
          color: DUST_50, fontStyle: 'italic', fontSize: 13, marginTop: 24,
        }}>
          Checking the void for an active session…
        </p>
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
        <div style={{ border: `1px solid ${HAIRLINE}`, padding: 32, maxWidth: 480, marginTop: 24 }}>
          <h2 style={{ fontSize: 14, letterSpacing: '0.18em', textTransform: 'uppercase', margin: '0 0 16px' }}>
            Check your inbox
          </h2>
          <p style={{ color: DUST_70, fontSize: 14, lineHeight: 1.6, margin: '0 0 16px' }}>
            We sent a confirmation link to{' '}
            <strong style={{ color: DUST }}>{pendingConfirmEmail}</strong>.
            Click the link to verify your account and complete sign-up. The
            link is single-use and expires in 24 hours.
          </p>
          <p style={{ color: DUST_50, fontSize: 12, lineHeight: 1.6, margin: 0 }}>
            Wrong email?{' '}
            <button onClick={() => setPendingConfirmEmail(null)} style={{
              background: 'none', border: 'none', color: DUST, textDecoration: 'underline',
              cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', padding: 0,
            }}>Try again</button>.
          </p>
        </div>
      </Shell>
    );
  }

  /**
   * Submit the form.  Routes the call through signIn or signUp based
   * on the active mode.  On success: navigate to /.  On failure:
   * surface the error string returned by the auth helper.
   */
  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    // Client-side guard rails — the API will reject these too, but a
    // local check saves a round-trip and a jarring error toast.
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
    // Reserved-name check (#401). Mirror of the server-side trigger so
    // we reject before the round-trip. Server still enforces the same
    // list; a determined attacker bypassing the client gets the same
    // 23514 from Postgres.
    if (mode === MODE_SIGNUP && RESERVED_USERNAMES.has(username.trim().toLowerCase())) {
      setError(`"${username}" is reserved — pick another.`);
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
        // Returning logins go straight home — they already picked allegiance
        // long ago, so the welcome wizard would self-redirect to / anyway.
        navigate('/', { replace: true });
        return;
      }

      // Signup branch — handle the discriminated SignUpResult from
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
      // result.kind === 'session' — signed in immediately. Send first-time
      // users to /welcome so they pick favourite club + player. Welcome.tsx
      // self-redirects users with favourite_team_id already set, so the
      // wizard is one-shot.
      navigate('/welcome', { replace: true });
    } catch (err) {
      console.warn('[Login] submit threw:', err);
      setError('Unexpected error. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <div style={{
        border: `1px solid ${HAIRLINE}`,
        padding: 32,
        maxWidth: 480,
        marginTop: 24,
      }}>
        {/* Mode toggle — two tabs.  Active tab uses dust-faint
            background; the inactive tab is hairline-bordered text. */}
        <div style={{
          display: 'flex',
          gap: 0,
          border: `1px solid ${HAIRLINE}`,
          marginBottom: 24,
        }}>
          <ModeTab
            label="Log In"
            active={mode === MODE_LOGIN}
            onClick={() => setMode(MODE_LOGIN)}
          />
          <ModeTab
            label="Sign Up"
            active={mode === MODE_SIGNUP}
            onClick={() => setMode(MODE_SIGNUP)}
          />
        </div>

        <form onSubmit={onSubmit} style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}>
          {mode === MODE_SIGNUP && (
            <Field
              label="Username"
              id="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(v) => setUsername(v)}
              hint={`At least ${MIN_USERNAME_LENGTH} characters.`}
            />
          )}
          <Field
            label="Email"
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(v) => setEmail(v)}
          />
          <Field
            label="Password"
            id="password"
            type="password"
            autoComplete={mode === MODE_LOGIN ? 'current-password' : 'new-password'}
            value={password}
            onChange={(v) => setPassword(v)}
            hint={mode === MODE_SIGNUP ? `At least ${MIN_PASSWORD_LENGTH} characters.` : undefined}
          />

          {/* 18+ age attestation — required for signup per Terms of Service.
              Renders as a single checkbox row above the submit button. */}
          {mode === MODE_SIGNUP && (
            <label style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              fontSize: 12,
              color: DUST_70,
              cursor: 'pointer',
              lineHeight: 1.5,
            }}>
              <input
                type="checkbox"
                checked={ageConfirmed}
                onChange={(e) => setAgeConfirmed(e.target.checked)}
                style={{ marginTop: 3, accentColor: QUANTUM }}
              />
              <span>
                I am at least 18 years old and accept the{' '}
                <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: DUST, textDecoration: 'underline' }}>
                  Terms
                </a>{' '}and{' '}
                <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: DUST, textDecoration: 'underline' }}>
                  Privacy Policy
                </a>.
              </span>
            </label>
          )}

          {error && (
            <p role="alert" style={{
              color: FLARE,
              fontSize: 13,
              fontStyle: 'italic',
              margin: 0,
            }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
              color: busy ? DUST : ABYSS,
              background: busy ? 'transparent' : ASTRO,
              border: `1px solid ${ASTRO}`,
              padding: '14px 24px',
              cursor: busy ? 'wait' : 'pointer',
              fontFamily: 'inherit',
              marginTop: 8,
            }}
          >
            {busy
              ? (mode === MODE_LOGIN ? 'Signing in…' : 'Creating account…')
              : (mode === MODE_LOGIN ? 'Log In' : 'Create Account')}
          </button>

          {mode === MODE_SIGNUP && (
            <p style={{
              fontSize: 11,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: DUST_70,
              margin: 0,
            }}>
              200 starting credits granted on first sign-in.
            </p>
          )}

          {/* Forgot-password link — login mode only. Routes to the two-phase
              ResetPassword page (request email → set new password). */}
          {mode === MODE_LOGIN && (
            <p style={{ fontSize: 12, color: DUST_50, margin: 0 }}>
              <a href="/reset-password" style={{ color: DUST, textDecoration: 'underline' }}>
                Forgot password?
              </a>
            </p>
          )}
        </form>
      </div>
    </Shell>
  );
}

/**
 * Page shell — shared chrome between the loading state and the form
 * state.  Extracted so the two render branches can't drift on padding,
 * Header, Footer, or hero copy.
 */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: ABYSS,
      color: DUST,
      minHeight: '100vh',
    }}>
      <Header />

      <section style={{ padding: '48px 0 16px' }}>
        <Container>
          <SectionHeader
            pageKicker="Account"
            kicker="IX"
            label="Sign In"
            title="Step Into The Void"
            subtitle="Claim a username, pick a club, place bets, vote on focuses, train players.  Every account starts with 200 Intergalactic Credits."
          />
        </Container>
      </section>

      <section style={{ padding: '0 0 80px' }}>
        <Container>{children}</Container>
      </section>

      <Footer />
    </div>
  );
}

interface ModeTabProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

/**
 * Single tab in the Log In / Sign Up toggle.  Renders as a button
 * inside the toggle's bordered shell so the active tab has a
 * background fill without breaking the surrounding border.
 */
function ModeTab({ label, active, onClick }: ModeTabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        background: active ? COLORS.dustFaint : 'transparent',
        border: 'none',
        color: DUST,
        padding: '12px 16px',
        fontFamily: 'inherit',
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        cursor: 'pointer',
        borderRight: `1px solid ${HAIRLINE}`,
      }}
    >
      {label}
    </button>
  );
}

interface FieldProps {
  label: string;
  id: string;
  type: string;
  autoComplete?: string | undefined;
  value: string;
  onChange: (v: string) => void;
  hint?: string | undefined;
}

/**
 * Labelled form field.  Renders a small-caps label tied to its input
 * via `htmlFor` + `id` (WCAG 2.5 label association), the input itself,
 * and an optional faint hint line below.
 */
function Field({ label, id, type, autoComplete, value, onChange, hint }: FieldProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label htmlFor={id} style={{
        fontSize: 11,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: DUST_70,
      }}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        autoComplete={autoComplete}
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        style={{
          background: ABYSS,
          border: `1px solid ${HAIRLINE}`,
          color: DUST,
          fontFamily: 'inherit',
          fontSize: 14,
          padding: '10px 12px',
        }}
      />
      {hint && (
        <span style={{
          fontSize: 11,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: DUST_50,
        }}>
          {hint}
        </span>
      )}
    </div>
  );
}
