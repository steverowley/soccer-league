// ── NotFound.tsx ──────────────────────────────────────────────────────────────
// Catch-all `*` route: renders for any URL that matches no real route,
// instead of leaving the content area blank (#532). Pairs with the GitHub
// Pages 404.html redirect: an unknown deep link bounces to the root,
// RedirectHandler restores the path, and if it still matches nothing, this
// is what the visitor sees.
//
// On the design language since group 5a (docs/design-language.md), with no
// raw style values: the shared PageHeader (the one h1) and an EmptyState
// with a single tertiary action back to the home page. The old red link is
// gone: a missing page is not live and not an error the fan caused.

import { Button, EmptyState, PageHeader, PageShell } from '../shared/ui';
import { usePageTitle } from '../shared/hooks/usePageTitle';

/**
 * Not-found page.
 *
 * @returns The page.
 */
export default function NotFound() {
  usePageTitle('Lost in the void');
  return (
    <PageShell>
      <PageHeader
        eyebrow="Not found"
        title="This corner of the cosmos doesn't exist."
        subtitle="The page you're looking for drifted past the Kuiper Belt and never came back. The link may be stale, or the gate was never opened here."
      />
      <EmptyState
        centred={false}
        hint={<Button variant="tertiary" to="/">Back to the league</Button>}
        style={{ paddingLeft: 0, paddingRight: 0 }}
      >
        The fixtures, the clubs and the news are all in the menu above.
      </EmptyState>
    </PageShell>
  );
}
