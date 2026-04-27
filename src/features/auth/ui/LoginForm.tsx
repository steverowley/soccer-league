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
//   - Uses shared/ui primitives (Input, Button) so the form layout tracks
//     any design-system changes automatically without per-form edits.

import { useState, type FormEvent } from 'react';
import { Button, Input } from '@shared/ui';
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
 * Email + password login form. Renders two labelled inputs and a primary
 * submit button. Supabase Auth error messages are surfaced inline below the
 * password field via the `error` prop on the second `<Input>`.
 *
 * Validation is intentionally minimal: we only check for non-empty fields
 * before submitting. Supabase returns descriptive errors for bad credentials,
 * rate limiting, unverified emails, etc. — duplicating that logic here would
 * create a maintenance burden with no UX benefit.
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
      <Input
        id="login-email"
        type="email"
        label="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
        disabled={submitting}
      />

      {/* Password field carries the shared error so it appears immediately
          below the last field the user interacted with, not at the top. */}
      <Input
        id="login-password"
        type="password"
        label="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
        disabled={submitting}
        error={error}
      />

      <Button type="submit" className="btn--full" disabled={submitting}>
        {submitting ? 'LOGGING IN…' : 'LOG IN'}
      </Button>
    </form>
  );
}
