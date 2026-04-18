// ── Login.jsx ─────────────────────────────────────────────────────────────────
// Authentication page — log in to an existing account or create a new one.
//
// MODE SWITCHING
// ──────────────
// The page renders either <LoginForm> or <SignupForm> based on local state.
// The initial mode is driven by the `?mode=signup` query parameter so the
// "Create Account" CTA on the Home page can deep-link directly to the signup
// tab without a separate /signup route.
//
// SUCCESS HANDLING
// ────────────────
// Both forms accept an `onSuccess` callback. Here we navigate to the referrer
// (via React Router's `location.state.from`) or fall back to "/" so the user
// lands somewhere useful after authenticating.
//
// ALREADY LOGGED IN
// ─────────────────
// If the user somehow lands here while authenticated (e.g. typed /login
// directly), they are immediately redirected to / so they don't see a
// pointless login form.

import { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { LoginForm, SignupForm, useAuth } from '../features/auth';

/**
 * Authentication page with switchable Login / Sign Up tabs.
 *
 * @returns {JSX.Element}
 */
export default function Login() {
  const navigate  = useNavigate();
  const location  = useLocation();
  const { user, loading } = useAuth();

  // Derive initial mode from the `?mode=signup` query param.
  const params     = new URLSearchParams(location.search);
  const initialMode = params.get('mode') === 'signup' ? 'signup' : 'login';
  const [mode, setMode] = useState(initialMode);

  // Re-sync mode if the query param changes (e.g. user presses back/forward).
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    setMode(p.get('mode') === 'signup' ? 'signup' : 'login');
  }, [location.search]);

  // Redirect target after successful auth — respect the referrer or home.
  const from = location.state?.from ?? '/';

  // If already authenticated, redirect away immediately (no flash — wait for
  // loading to resolve first so we don't misidentify an initialising session).
  if (!loading && user) {
    return <Navigate to={from} replace />;
  }

  function handleSuccess() {
    navigate(from, { replace: true });
  }

  return (
    <div
      className="container"
      style={{
        paddingTop: '64px',
        paddingBottom: '80px',
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <div className="card" style={{ width: '100%', maxWidth: '440px' }}>

        {/* ── Mode tabs ─────────────────────────────────────────────────────── */}
        {/* Two mono-caps labels that toggle the active form.  Active tab has
            full opacity + a bottom accent line; inactive tab is muted. */}
        <div style={{ display: 'flex', gap: '24px', marginBottom: '24px' }}>
          <button
            onClick={() => setMode('login')}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: mode === 'login'
                ? '2px solid var(--color-purple)'
                : '2px solid transparent',
              padding: '0 0 6px',
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
              fontSize: '13px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: mode === 'login' ? 'var(--color-dust)' : 'rgba(227,224,213,0.4)',
            }}
          >
            Log In
          </button>
          <button
            onClick={() => setMode('signup')}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: mode === 'signup'
                ? '2px solid var(--color-purple)'
                : '2px solid transparent',
              padding: '0 0 6px',
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
              fontSize: '13px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: mode === 'signup' ? 'var(--color-dust)' : 'rgba(227,224,213,0.4)',
            }}
          >
            Create Account
          </button>
        </div>

        <hr className="divider" style={{ marginBottom: '24px' }} />

        {/* ── Active form ───────────────────────────────────────────────────── */}
        {mode === 'login' ? (
          <LoginForm onSuccess={handleSuccess} />
        ) : (
          <SignupForm onSuccess={handleSuccess} />
        )}

        {/* ── Mode switch hint ──────────────────────────────────────────────── */}
        <p style={{ marginTop: '20px', fontSize: '12px', opacity: 0.45, textAlign: 'center' }}>
          {mode === 'login' ? (
            <>
              No account yet?{' '}
              <button
                onClick={() => setMode('signup')}
                style={{
                  background: 'none', border: 'none',
                  color: 'var(--color-purple)', cursor: 'pointer',
                  fontSize: '12px', textDecoration: 'underline', padding: 0,
                }}
              >
                Create one
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button
                onClick={() => setMode('login')}
                style={{
                  background: 'none', border: 'none',
                  color: 'var(--color-purple)', cursor: 'pointer',
                  fontSize: '12px', textDecoration: 'underline', padding: 0,
                }}
              >
                Log in
              </button>
            </>
          )}
        </p>

        {/* ── Back to home ──────────────────────────────────────────────────── */}
        <div style={{ marginTop: '16px', textAlign: 'center' }}>
          <Link
            to="/"
            style={{
              fontSize: '11px',
              opacity: 0.35,
              fontFamily: 'var(--font-mono)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--color-dust)',
            }}
          >
            ← Back to home
          </Link>
        </div>

      </div>
    </div>
  );
}
