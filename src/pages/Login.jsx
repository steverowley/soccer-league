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
    <div className="container auth-page">
      <div className="card auth-card">

        {/* ── Mode tabs ─────────────────────────────────────────────────────── */}
        {/* Two mono-caps labels toggle between login and signup. The active
            tab gets a Quantum Purple underline accent; inactive tabs are
            muted to 40% so the active selection is unambiguous at a glance.
            CSS class `.auth-tab.is-active` owns all visual state — no inline
            conditional styles needed here. */}
        <div className="auth-tabs">
          <button
            className={`auth-tab${mode === 'login' ? ' is-active' : ''}`}
            onClick={() => setMode('login')}
          >
            Log In
          </button>
          <button
            className={`auth-tab${mode === 'signup' ? ' is-active' : ''}`}
            onClick={() => setMode('signup')}
          >
            Create Account
          </button>
        </div>

        <hr className="divider divider--compact" />

        {/* ── Active form ───────────────────────────────────────────────────── */}
        {mode === 'login' ? (
          <LoginForm onSuccess={handleSuccess} />
        ) : (
          <SignupForm onSuccess={handleSuccess} />
        )}

        {/* ── Mode switch hint ──────────────────────────────────────────────── */}
        {/* Inline prompt to switch modes — lower visual weight than the tabs
            above so it reads as a secondary affordance, not a second CTA. */}
        <p className="auth-hint">
          {mode === 'login' ? (
            <>No account yet? <button onClick={() => setMode('signup')}>Create one</button></>
          ) : (
            <>Already have an account? <button onClick={() => setMode('login')}>Log in</button></>
          )}
        </p>

        {/* ── Back to home ──────────────────────────────────────────────────── */}
        <Link to="/" className="auth-back-link">← Back to home</Link>

      </div>
    </div>
  );
}
