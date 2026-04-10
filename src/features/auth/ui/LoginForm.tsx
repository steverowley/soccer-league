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
    <form onSubmit={handleSubmit} style={{ maxWidth: 400, margin: '0 auto' }}>
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <label
          htmlFor="login-email"
          style={{
            display: 'block',
            fontSize: 'var(--font-size-small)',
            fontFamily: 'var(--font-mono)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--letter-spacing-wider)',
            marginBottom: 'var(--space-2)',
            color: 'var(--color-dust)',
          }}
        >
          Email
        </label>
        <input
          id="login-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          disabled={submitting}
          style={{
            width: '100%',
            padding: 'var(--space-3) var(--space-4)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--font-size-body)',
            backgroundColor: 'var(--color-ash)',
            border: '1px solid rgba(227,224,213,0.2)',
            color: 'var(--color-dust)',
            outline: 'none',
          }}
        />
      </div>

      <div style={{ marginBottom: 'var(--space-6)' }}>
        <label
          htmlFor="login-password"
          style={{
            display: 'block',
            fontSize: 'var(--font-size-small)',
            fontFamily: 'var(--font-mono)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--letter-spacing-wider)',
            marginBottom: 'var(--space-2)',
            color: 'var(--color-dust)',
          }}
        >
          Password
        </label>
        <input
          id="login-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          disabled={submitting}
          style={{
            width: '100%',
            padding: 'var(--space-3) var(--space-4)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--font-size-body)',
            backgroundColor: 'var(--color-ash)',
            border: '1px solid rgba(227,224,213,0.2)',
            color: 'var(--color-dust)',
            outline: 'none',
          }}
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

      <button type="submit" className="btn btn-primary" disabled={submitting} style={{ width: '100%' }}>
        {submitting ? 'Logging in…' : 'Log In'}
      </button>
    </form>
  );
}
