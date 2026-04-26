// ── LoginForm.tsx ────────────────────────────────────────────────────────────
// WHY: The login form for email + password authentication. Replaces the
// placeholder "coming soon" stub in src/pages/Login.jsx. Uses the auth
// feature's `useAuth()` hook so no Supabase client is imported directly.
//
// DESIGN:
//   - Inline validation is minimal (non-empty fields) because Supabase Auth
//     returns descriptive errors for bad credentials, rate limiting, etc.
//   - On success, the form doesn't navigate — the calling page handles
//     redirection based on its own routing context (e.g. Login page
//     redirects to /, match page stays in place).
//   - The form uses the ISL design system tokens (--color-*, --font-mono)
//     so it blends with the retro-minimalist aesthetic.

import { useState, type FormEvent } from 'react';
import { useAuth } from './AuthProvider';

/**
 * Props for LoginForm.
 *
 * @param onSuccess  Optional callback fired after a successful login. The
 *                   calling page typically navigates away inside this.
 */
interface LoginFormProps {
  onSuccess?: () => void;
}

/**
 * Email + password login form. Renders a card-styled box with two inputs
 * and a submit button. Error messages from Supabase Auth are shown inline
 * below the form.
 */
export function LoginForm({ onSuccess }: LoginFormProps) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError('Email and password are required.');
      return;
    }

    setSubmitting(true);
    const errMsg = await signIn(email.trim(), password);
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
        <label htmlFor="login-email" className="isl-label">Email</label>
        <input
          id="login-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          disabled={submitting}
          className="isl-input"
        />
      </div>

      <div className="form-group">
        <label htmlFor="login-password" className="isl-label">Password</label>
        <input
          id="login-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          disabled={submitting}
          className="isl-input"
        />
      </div>

      {error && <p className="form-error">{error}</p>}

      <button type="submit" className="btn btn-primary btn--full" disabled={submitting}>
        {submitting ? 'LOGGING IN…' : 'LOG IN'}
      </button>
    </form>
  );
}
