// ── Login.jsx ─────────────────────────────────────────────────────────────────
// Log In page — placeholder implementation.
//
// The design mockups include a "LOG IN" nav link but no finalised login page
// design was provided.  This component renders a minimal form-shaped
// placeholder using the ISL design system components so the nav link resolves
// without a 404 and the visual language is consistent.
//
// When the Login page design is delivered it should replace this file with:
//   - Email / username and password fields (Text Inputs design system component)
//   - A "LOG IN" primary button
//   - A "Create Account" tertiary link
//   - Appropriate error states using Solar Flare red

import { Link } from 'react-router-dom';
import Button from '../components/ui/Button';

/**
 * Log In page (placeholder).
 *
 * Renders a centred card with a minimal "coming soon" login form shell.
 * The card uses the standard .card class from index.css for consistent
 * dark-background bordered styling.
 *
 * @returns {JSX.Element}
 */
export default function Login() {
  return (
    <div
      className="container"
      style={{
        paddingTop: '80px',
        paddingBottom: '80px',
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      {/* ── Login card ────────────────────────────────────────────────────────── */}
      {/* Max-width of 400px keeps the form at a comfortable reading width and
          matches the proportions of the Create Account card on the Home page. */}
      <div className="card" style={{ width: '100%', maxWidth: '400px' }}>
        <h2 style={{ fontSize: '24px', marginBottom: '8px' }}>Log In</h2>
        <hr className="divider" style={{ marginBottom: '24px' }} />

        {/* ── Coming soon notice ────────────────────────────────────────────── */}
        {/* Temporary copy until authentication is implemented.
            Styled at reduced opacity so it reads as a system note rather than
            primary content. */}
        <p style={{ fontSize: '13px', opacity: 0.6, marginBottom: '24px' }}>
          Authentication is coming soon. For now, explore the league freely.
        </p>

        {/* ── Action buttons ────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Disabled primary button — preserves the eventual login CTA shape */}
          <Button variant="primary" disabled style={{ opacity: 0.5, cursor: 'not-allowed' }}>
            Log In
          </Button>

          {/* Secondary link back to home — gives the user an exit from this stub */}
          <Link to="/">
            <Button variant="secondary" style={{ width: '100%' }}>
              Back to Home
            </Button>
          </Link>
        </div>

        {/* ── Create account link ───────────────────────────────────────────── */}
        <p style={{ marginTop: '20px', fontSize: '12px', opacity: 0.5, textAlign: 'center' }}>
          Don't have an account?{' '}
          <Link to="/" style={{ color: 'var(--color-purple)', textDecoration: 'underline' }}>
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
