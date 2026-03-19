// ── Players.jsx ───────────────────────────────────────────────────────────────
// Players listing page — placeholder implementation.
//
// The design mockups do not include a finalised Players page design yet
// (the nav link exists but no mockup was provided).  This component renders
// a minimal "coming soon" state using the standard ISL page shell so the nav
// link resolves to a real route rather than a 404.
//
// When the Players page design is delivered it should replace this file with:
//   - A searchable/filterable roster table across all teams
//   - Individual player stat cards (position, personality, attributes)
//   - Links to the owning team's detail page

import { Link } from 'react-router-dom';
import Button from '../components/ui/Button';

/**
 * Players listing page (placeholder).
 *
 * Renders a centred "coming soon" message within the ISL page shell.
 * Navigation to /players via the header nav resolves correctly without
 * a 404 while the full design is pending.
 *
 * @returns {JSX.Element}
 */
export default function Players() {
  return (
    <div
      className="container"
      style={{ paddingTop: '80px', paddingBottom: '80px', textAlign: 'center' }}
    >
      {/* ── Coming soon state ─────────────────────────────────────────────────── */}
      {/* Minimal placeholder — matches the ISL dark aesthetic without
          introducing any UI patterns not yet specified in the design system. */}
      <h1 style={{ marginBottom: '16px' }}>Players</h1>
      <hr className="divider" style={{ maxWidth: '400px', margin: '0 auto 24px' }} />
      <p style={{ opacity: 0.6, fontSize: '14px', marginBottom: '32px' }}>
        Full player profiles and statistics are coming soon.
      </p>
      <Link to="/teams">
        <Button variant="primary">Browse Teams</Button>
      </Link>
    </div>
  );
}
