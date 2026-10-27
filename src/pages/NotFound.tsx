// ── NotFound.tsx ──────────────────────────────────────────────────────────────
// Catch-all `*` route — renders for any URL that matches no real route, instead
// of leaving the content area blank (#532). Pairs with the GitHub Pages 404.html
// redirect: an unknown deep link bounces to the root, RedirectHandler restores
// the path, and if it still matches nothing, this is what the visitor sees.

import { Link } from 'react-router-dom';
import { COLORS } from '../components/Layout';
import { PageHeader, PageShell } from '../shared/ui';
import { usePageTitle } from '../shared/hooks/usePageTitle';

const { flare: FLARE } = COLORS;

export default function NotFound() {
  usePageTitle('Lost in the void');
  return (
    <PageShell>
      <PageHeader
        eyebrow="Not found"
        title="This corner of the cosmos doesn't exist."
        subtitle="The page you're looking for drifted past the Kuiper Belt and never came back. The link may be stale, or the gate was never opened here."
      />
      <p style={{ marginTop: 32, fontSize: 15 }}>
        <Link to="/" style={{ color: FLARE, textDecoration: 'underline' }}>
          ← Back to the league
        </Link>
      </p>
    </PageShell>
  );
}
