// ── NotFound.tsx ──────────────────────────────────────────────────────────────
// Catch-all `*` route — renders for any URL that matches no real route, instead
// of leaving the content area blank (#532). Pairs with the GitHub Pages 404.html
// redirect: an unknown deep link bounces to the root, RedirectHandler restores
// the path, and if it still matches nothing, this is what the visitor sees.

import { Link } from 'react-router-dom';
import Header from '../components/Header';
import { COLORS, Container, Footer, SectionHeader } from '../components/Layout';
import { usePageTitle } from '../shared/hooks/usePageTitle';

const { dust: DUST, abyss: ABYSS, flare: FLARE } = COLORS;

export default function NotFound() {
  usePageTitle('Lost in the void');
  return (
    <div style={{
      background: ABYSS, color: DUST, minHeight: '100vh', fontFamily: 'Space Mono, monospace',
    }}>
      <Header />
      <Container>
        <SectionHeader
          pageKicker="404"
          kicker="OFF THE STAR CHARTS"
          title="This corner of the cosmos doesn't exist."
          subtitle="The page you're looking for drifted past the Kuiper Belt and never came back. The link may be stale, or the gate was never opened here."
        />
        <p style={{ marginTop: 32, fontSize: 15 }}>
          <Link to="/" style={{ color: FLARE, textDecoration: 'underline' }}>
            ← Back to the league
          </Link>
        </p>
      </Container>
      <Footer />
    </div>
  );
}
