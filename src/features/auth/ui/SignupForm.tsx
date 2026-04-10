// ── SignupForm.tsx ────────────────────────────────────────────────────────────
// WHY: Registration form for new ISL accounts. Collects email, password, and
// a username (the public display name shown on leaderboards and voting pages).
// Uses the auth feature's `useAuth()` hook — no direct Supabase imports.
//
// DESIGN:
//   - Username validation: 3-30 chars, alphanumeric + underscores only. This
//     matches the constraints the UI enforces (the DB uses a UNIQUE TEXT
//     column without a regex CHECK to keep migration-time constraints simple).
//   - Password minimum: 6 characters. Supabase Auth has its own minimum
//     (configurable per project); we apply a client-side floor as well so
//     the user sees an instant error rather than waiting for a round-trip.
//   - On success, the user is auto-logged-in by Supabase Auth. The calling
//     page decides where to redirect.

import { useState, type FormEvent } from 'react';
import { useAuth } from './AuthProvider';

/**
 * @param onSuccess  Optional callback fired after a successful signup.
 */
interface SignupFormProps {
  onSuccess?: () => void;
}

/** Minimum password length enforced client-side. */
const MIN_PASSWORD_LENGTH = 6;

/** Username regex: 3-30 chars, alphanumeric + underscores. */
const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,30}$/;

/**
 * Registration form with email, username, and password fields. Renders
 * in the ISL retro-minimalist style using design system tokens.
 */
export function SignupForm({ onSuccess }: SignupFormProps) {
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    // ── Client-side validation ────────────────────────────────────────────
    if (!email.trim()) {
      setError('Email is required.');
      return;
    }
    if (!USERNAME_PATTERN.test(username)) {
      setError('Username must be 3-30 characters (letters, numbers, underscores).');
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }

    setSubmitting(true);
    const errMsg = await signUp(email.trim(), password, username.trim());
    setSubmitting(false);

    if (errMsg) {
      setError(errMsg);
    } else {
      onSuccess?.();
    }
  }

  // Shared input styling — DRY helper to keep the JSX readable.
  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: 'var(--space-3) var(--space-4)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--font-size-body)',
    backgroundColor: 'var(--color-ash)',
    border: '1px solid rgba(227,224,213,0.2)',
    color: 'var(--color-dust)',
    outline: 'none',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 'var(--font-size-small)',
    fontFamily: 'var(--font-mono)',
    textTransform: 'uppercase',
    letterSpacing: 'var(--letter-spacing-wider)',
    marginBottom: 'var(--space-2)',
    color: 'var(--color-dust)',
  };

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 400, margin: '0 auto' }}>
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <label htmlFor="signup-email" style={labelStyle}>
          Email
        </label>
        <input
          id="signup-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          disabled={submitting}
          style={inputStyle}
        />
      </div>

      <div style={{ marginBottom: 'var(--space-4)' }}>
        <label htmlFor="signup-username" style={labelStyle}>
          Username
        </label>
        <input
          id="signup-username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          disabled={submitting}
          placeholder="3-30 chars, letters/numbers/_"
          style={inputStyle}
        />
      </div>

      <div style={{ marginBottom: 'var(--space-6)' }}>
        <label htmlFor="signup-password" style={labelStyle}>
          Password
        </label>
        <input
          id="signup-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          disabled={submitting}
          style={inputStyle}
        />
      </div>

      {error && (
        <p
          style={{
            color: 'var(--color-red)',
            fontSize: 'var(--font-size-small)',
            fontFamily: 'var(--font-mono)',
            marginBottom: 'var(--space-4)',
          }}
        >
          {error}
        </p>
      )}

      <button type="submit" className="btn btn-secondary" disabled={submitting} style={{ width: '100%' }}>
        {submitting ? 'Creating account…' : 'Sign Up'}
      </button>
    </form>
  );
}
