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

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group">
        <label htmlFor="signup-email" className="isl-label">Email</label>
        <input
          id="signup-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          disabled={submitting}
          className="isl-input"
        />
      </div>

      <div className="form-group">
        <label htmlFor="signup-username" className="isl-label">Username</label>
        <input
          id="signup-username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          disabled={submitting}
          placeholder="3-30 chars, letters/numbers/_"
          className="isl-input"
        />
      </div>

      <div className="form-group">
        <label htmlFor="signup-password" className="isl-label">Password</label>
        <input
          id="signup-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          disabled={submitting}
          className="isl-input"
        />
      </div>

      {error && <p className="form-error">{error}</p>}

      <button type="submit" className="btn btn-secondary btn--full" disabled={submitting}>
        {submitting ? 'CREATING ACCOUNT…' : 'SIGN UP'}
      </button>
    </form>
  );
}
