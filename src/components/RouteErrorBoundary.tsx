// ── RouteErrorBoundary.tsx ──────────────────────────────────────────────────
// Per-route React error boundary added in #383.
//
// WHY THIS EXISTS ALONGSIDE THE APP-LEVEL ErrorBoundary
// ─────────────────────────────────────────────────────
// The app already wraps everything in a top-level `ErrorBoundary` that
// renders a full-page "Transmission Error" view when ANY child throws.
// That outer boundary is correct for failures inside providers / listeners
// / the router itself — but for a render error inside a single page
// component it's overkill: blanking the whole screen (including Header +
// Footer + the cross-feature listeners that may be doing useful work) is
// disproportionate to "the /idols page tried to read a missing field".
//
// This boundary wraps each <Route> element so a single page's render
// error only blanks that page's content area. The Header, AccountMenu,
// in-flight bus listeners, Sentry, and the user's session all keep
// running; the user can still navigate elsewhere via the global nav.
//
// FAILURE UX
// ──────────
// • Inline panel inside the page's main content area (not full-page).
// • Brief in-voice message + "Reload" button that calls
//   window.location.reload() — same recovery affordance as the outer
//   ErrorBoundary.
// • Sentry forwarding tagged `source: 'react-error-boundary-route'` so
//   dashboards can split per-route catches apart from app-level catches.

import { Component, type ReactNode, type ErrorInfo } from 'react';
import { COLORS } from './Layout';
import { captureException } from '../shared/observability/sentry';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

/**
 * Per-route error boundary. Wrap each `<Route>` element with this
 * component so a render failure on one page leaves the rest of the
 * application (Header, listeners, navigation) functional.
 *
 * Renders an inline error panel on catch — never a full-page takeover.
 * Recovery is `window.location.reload()`; users can also use the
 * standard nav to leave the broken route.
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
        <div style={{
          // Sits inside the page content area — Header + Footer keep rendering.
          // padding/margin chosen to match the rest of the page layout so
          // the panel doesn't look orphaned at the top of the viewport.
          padding: 48,
          margin: '32px auto',
          maxWidth: 480,
          border: `1px solid ${COLORS.hairline}`,
          color: COLORS.dust,
          fontFamily: "'Space Mono', monospace",
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 24, marginBottom: 12 }}>⚠</div>
          <h2 style={{
            fontSize: 13, letterSpacing: '0.14em', textTransform: 'uppercase',
            fontWeight: 700, margin: '0 0 8px',
          }}>
            This page misfired
          </h2>
          <p style={{
            fontSize: 12, color: COLORS.dust50, lineHeight: 1.7, margin: '0 0 16px',
          }}>
            The rest of the broadcast feed is unaffected. Reload this view to retry, or
            use the navigation above to head elsewhere.
            {this.state.message && (
              <><br /><span style={{ opacity: 0.6 }}>{this.state.message}</span></>
            )}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '8px 20px',
              border: `1px solid ${COLORS.dust}`,
              background: 'transparent',
              color: COLORS.dust,
              fontFamily: 'inherit',
              fontSize: 11,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
