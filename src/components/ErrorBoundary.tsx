// ── ErrorBoundary.tsx ───────────────────────────────────────────────────────
// The app-level React error boundary: the last line of defence for a render
// error in a provider, a listener or the router itself (main.tsx mounts it
// outside everything). Page render errors are caught first, per route, by
// RouteErrorBoundary, which keeps the site chrome.
//
// FAILURE SCREEN
//   On the design language since group 5a (docs/design-language.md), with
//   no raw style values. It sits OUTSIDE the router and the auth provider,
//   so it cannot render PageShell (the site header needs both); it draws
//   the same page column itself: the shared PageHeader (the screen's one
//   h1) and an EmptyState with a single secondary action, Reload. The
//   error message is shown de-emphasised for bug reports; the in-world
//   copy above it is what the fan reads.
//
// Sentry forwarding is tagged `source: 'react-error-boundary'` so
// dashboards can split these catches from the per-route ones.

import { Component, type ReactNode, type ErrorInfo } from 'react';
import { captureException } from '../shared/observability/sentry';
import { color, layout } from '../shared/design';
import { Button } from '../shared/ui/Button';
import { EmptyState } from '../shared/ui/EmptyState';
import { PageHeader } from '../shared/ui/PageHeader';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

/**
 * App-level error boundary. Renders a full-page failure screen on catch;
 * recovery is a page reload.
 */
export default class ErrorBoundary extends Component<Props, State> {
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
    console.error('[ISL] Unhandled render error:', error, info.componentStack);
    // Forward to Sentry (no-op when no DSN). Tag scope so we can filter
    // ErrorBoundary catches apart from event-bus catches and other sources.
    captureException(error, {
      tags: { source: 'react-error-boundary' },
      extra: { componentStack: info.componentStack ?? null },
    });
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: '100vh', background: color.bg, color: color.text }}>
          <main
            style={{
              maxWidth: layout.container,
              margin: '0 auto',
              paddingLeft: layout.gutter,
              paddingRight: layout.gutter,
              boxSizing: 'border-box',
            }}
          >
            <PageHeader
              eyebrow="Error"
              title="Transmission error"
              subtitle="An unexpected error disrupted the ISL broadcast feed. Reload to reconnect."
            />
            <EmptyState
              centred={false}
              kicker="Signal lost"
              hint={<Button variant="secondary" onClick={() => window.location.reload()}>Reload</Button>}
              style={{ paddingLeft: 0, paddingRight: 0 }}
            >
              {this.state.message || 'No further detail was recorded.'}
            </EmptyState>
          </main>
        </div>
      );
    }

    return this.props.children;
  }
}
