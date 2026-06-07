// ── features/admin/ui/AdminPageHero.tsx ──────────────────────────────────────
// Standalone hero block rendered at the top of the /admin route, immediately
// above the tab strip.  Extracted from Admin.tsx so the route file stays a
// thin orchestrator — the hero is a static piece of branding and never
// changes shape based on the active tab.

import { Container } from '../../../components/Layout';
import {
  DUST, DUST_50, HAIRLINE, QUANTUM,
  LABEL_STYLE, VALUE_STYLE,
} from './primitives';

/**
 * Admin page hero.  Renders the kicker ("Admin Dashboard"), the page title
 * ("League Control Room"), and a short subtitle explaining what the
 * downstream tabs control.  Bordered at the bottom so the visual hierarchy
 * reads "title → tabs → content" with no padding gap between hero and tabs.
 */
export function AdminPageHero() {
  return (
    <div style={{ borderBottom: `1px solid ${HAIRLINE}`, marginBottom: 0 }}>
      <Container>
        <div style={{ padding: '48px 16px 40px' }}>
          <p style={{ ...LABEL_STYLE, color: QUANTUM, marginBottom: 10 }}>
            Admin Dashboard
          </p>
          <h1 style={{
            fontSize: 32,
            fontWeight: 700,
            color: DUST,
            margin: 0,
            letterSpacing: '-0.01em',
          }}>
            League Control Room
          </h1>
          <p style={{ ...VALUE_STYLE, color: DUST_50, marginTop: 10, maxWidth: 560 }}>
            Season controls, fixture browser, and Architect intervention log.
            Changes here affect the live database directly.
          </p>
        </div>
      </Container>
    </div>
  );
}
