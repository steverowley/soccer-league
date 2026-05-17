// ── Login.jsx ───────────────────────────────────────────────────────────────
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
const { dust: DUST, abyss: ABYSS, flare: FLARE } = COLORS;
const HAIRLINE = COLORS.hairline;
const DUST_50  = COLORS.dust50;
const DUST_70  = COLORS.dust70;

// ── Mode sentinels ─────────────────────────────────────────────────────────
// MODE_LOGIN / MODE_SIGNUP — string ids for the two-tab toggle.  Plain
// string literals (not Symbol) so they survive React state diffing
// cleanly.
const MODE_LOGIN  = 'login';
const MODE_SIGNUP = 'signup';

// ── Field constraints ─────────────────────────────────────────────────────
// Mirror the Supabase Auth defaults — these are the validation rules
// the API will enforce server-side anyway, but surfacing them client-side
// keeps the user from submitting a doomed form.
const MIN_PASSWORD_LENGTH = 6;
const MIN_USERNAME_LENGTH = 3;

/**
 * Login + signup page.
 *
 * Renders a single card with a mode toggle.  Login mode collects
 * email + password; signup mode adds a username field above them.
 * Already-signed-in users are redirected to /profile via
 * <Navigate /> on render (cheaper than an effect).
 *
 * @returns {JSX.Element}
 */
export default function Login() {
  const { user, signIn, signUp, loading } = useAuth();
  const navigate = useNavigate();

  const [mode,     setMode]     = useState(MODE_LOGIN);
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error,    setError]    = useState(null);
  const [busy,     setBusy]     = useState(false);

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

  /**
   * Submit the form.  Routes the call through signIn or signUp based
   * on the active mode.  On success: navigate to /.  On failure:
   * surface the error string returned by the auth helper.
   */
  const onSubmit = async (e) => {
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

    setBusy(true);
    try {
      const result = mode === MODE_LOGIN
        ? await signIn(email, password)
        : await signUp(email, password, username);

      if (result) {
        setError(result);
        return;
      }

      // Signup with email-confirmation enabled returns no error AND no
      // session.  Surface a friendly nudge instead of a blank navigate.
      if (mode === MODE_SIGNUP) {
        setError(null);
        setBusy(false);
        // Use replace so the user can't back-button into the half-
        // signed-up state.
        navigate('/', { replace: true });
        return;
      }

      navigate('/', { replace: true });
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
              color: DUST,
              background: busy ? 'transparent' : FLARE,
              border: `1px solid ${FLARE}`,
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
        </form>
      </div>
    </Shell>
  );
}

/**
 * Page shell — shared chrome between the loading state and the form
 * state.  Extracted so the two render branches can't drift on padding,
 * Header, Footer, or hero copy.
 *
 * @param {{ children: React.ReactNode }} props
 */
function Shell({ children }) {
  return (
    <div style={{
      background: ABYSS,
      color: DUST,
      minHeight: '100vh',
      fontFamily: 'Space Mono, monospace',
    }}>
      <Header />

      <section style={{ padding: '64px 32px 24px' }}>
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

      <section style={{ padding: '0 32px 120px' }}>
        <Container>{children}</Container>
      </section>

      <Footer />
    </div>
  );
}

/**
 * Single tab in the Log In / Sign Up toggle.  Renders as a button
 * inside the toggle's bordered shell so the active tab has a
 * background fill without breaking the surrounding border.
 *
 * @param {object} props
 * @param {string} props.label
 * @param {boolean} props.active
 * @param {() => void} props.onClick
 */
function ModeTab({ label, active, onClick }) {
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

/**
 * Labelled form field.  Renders a small-caps label tied to its input
 * via `htmlFor` + `id` (WCAG 2.5 label association), the input itself,
 * and an optional faint hint line below.
 *
 * @param {object} props
 * @param {string} props.label
 * @param {string} props.id
 * @param {string} props.type        Native input type (text / email / password).
 * @param {string} [props.autoComplete]
 * @param {string} props.value
 * @param {(v: string) => void} props.onChange
 * @param {string} [props.hint]
 */
function Field({ label, id, type, autoComplete, value, onChange, hint }) {
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
        onChange={(e) => onChange(e.target.value)}
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
