import { Component, type ReactNode, type ErrorInfo } from 'react';
import { C } from '../constants';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

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
  }

  override render(): ReactNode {
    if (this.state.hasError) {
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

    return this.props.children;
  }
}
