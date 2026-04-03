// ── ErrorBoundary.jsx ─────────────────────────────────────────────────────────
// React class-based Error Boundary.  Catches unhandled JavaScript errors thrown
// during rendering, in lifecycle methods, or in constructors of any child
// component in the tree below it.
//
// WHY A CLASS COMPONENT
// ─────────────────────
// Error Boundaries must be class components because they rely on the
// componentDidCatch and getDerivedStateFromError lifecycle methods, which have
// no functional-component equivalents as of React 18.
//
// PLACEMENT
// ─────────
// Wrapped around the <BrowserRouter> in main.jsx so that any unhandled render
// error in any page or component shows the fallback UI rather than a blank screen.
// This prevents a single broken component from silently crashing the entire app.

import { Component } from 'react';
import { C } from '../constants.js';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    // hasError — flips to true the first time getDerivedStateFromError fires,
    // triggering the fallback render on the next cycle.
    this.state = { hasError: false, message: '' };
  }

  /**
   * React lifecycle: called during render when a descendant throws.
   * Returns the state slice that marks the boundary as errored.
   *
   * @param {Error} error – the thrown error object
   * @returns {{ hasError: boolean, message: string }}
   */
  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message ?? String(error) };
  }

  /**
   * React lifecycle: called after the errored render is committed to the DOM.
   * Used for side-effects (logging) only — do not call setState here.
   *
   * @param {Error}           error – the thrown error
   * @param {{ componentStack: string }} info – React component stack trace
   */
  componentDidCatch(error, info) {
    console.error('[ISL] Unhandled render error:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      // ── Fallback UI ──────────────────────────────────────────────────────
      // Minimal ISL-styled error card.  Gives the user enough information to
      // report the problem and a clear route back to safety (page reload).
      return (
        <div
          style={{
            minHeight: '100vh',
            backgroundColor: C.abyss,
            color: C.dust,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: "'Space Mono', monospace",
            gap: '16px',
            padding: '32px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '32px' }}>⚠</div>
          <h1 style={{ fontSize: '16px', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0 }}>
            Transmission Error
          </h1>
          <p style={{ fontSize: '12px', opacity: 0.6, maxWidth: '480px', lineHeight: 1.7, margin: 0 }}>
            An unexpected error disrupted the ISL broadcast feed.
            {this.state.message && (
              <><br /><span style={{ opacity: 0.45 }}>{this.state.message}</span></>
            )}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: '8px',
              padding: '8px 24px',
              border: `1px solid ${C.dust}`,
              backgroundColor: 'transparent',
              color: C.dust,
              fontFamily: "'Space Mono', monospace",
              fontSize: '12px',
              letterSpacing: '0.08em',
              cursor: 'pointer',
              textTransform: 'uppercase',
            }}
          >
            Reload
          </button>
        </div>
      );
    }

    // Normal render — pass children through untouched.
    return this.props.children;
  }
}
