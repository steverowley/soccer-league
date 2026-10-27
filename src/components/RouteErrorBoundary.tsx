// ── RouteErrorBoundary.tsx ──────────────────────────────────────────────────
// Per-route React error boundary added in #383.
//
// WHY THIS EXISTS ALONGSIDE THE APP-LEVEL ErrorBoundary
//   The top-level ErrorBoundary is right for failures inside providers,
//   listeners or the router itself. For a render error inside one page it
//   is overkill: main.tsx wraps the route tree in this boundary (keyed on
//   the pathname, so it resets on navigation), and a page that throws is
//   replaced by this screen while the session, the listeners and Sentry
//   keep running.
//
// FAILURE SCREEN
//   On the design language since group 5a (docs/design-language.md), with
//   no raw style values. Every page renders its own PageShell, so when a
//   page throws, its header and footer go with it: this screen therefore
//   renders a full PageShell (site header and footer back, so the fan can
//   navigate away) with the shared PageHeader as its one h1 and an
//   EmptyState with a single secondary action, Reload.
//
// Sentry forwarding is tagged `source: 'react-error-boundary-route'` so
// dashboards can split per-route catches from app-level ones.

import { Component, type ReactNode, type ErrorInfo } from 'react';
import { captureException } from '../shared/observability/sentry';
import { Button, EmptyState, PageHeader, PageShell } from '../shared/ui';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

/**
 * Per-route error boundary. Wrap the route tree with this component so a
 * render failure on one page leaves the session, listeners and navigation
 * working. Recovery is `window.location.reload()`, or the site nav.
 */
export default class RouteErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? (error.message ?? String(error)) : String(error),
    };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ISL][route] Unhandled render error:', error, info.componentStack);
    // Tag the Sentry scope with a route-specific source so dashboards
    // can split these catches apart from the app-level boundary.
    captureException(error, {
      tags: { source: 'react-error-boundary-route' },
      extra: { componentStack: info.componentStack ?? null },
    });
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <PageShell>
          <PageHeader
            eyebrow="Error"
            title="This page misfired"
            subtitle="The rest of the broadcast feed is unaffected. Reload this view to retry, or use the navigation above to head elsewhere."
          />
          <EmptyState
            centred={false}
            kicker="Signal lost"
            hint={<Button variant="secondary" onClick={() => window.location.reload()}>Reload</Button>}
            style={{ paddingLeft: 0, paddingRight: 0 }}
          >
            {this.state.message || 'No further detail was recorded.'}
          </EmptyState>
        </PageShell>
      );
    }
    return this.props.children;
  }
}
