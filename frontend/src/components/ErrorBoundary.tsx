import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled error:', error, info.componentStack);
  }

  private handleRetry = () => {
    this.setState({ error: null });
  };

  private handleGoHome = () => {
    this.setState({ error: null });
    window.location.href = '/';
  };

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div
          role='alert'
          style={{
            display: 'grid',
            placeItems: 'center',
            minHeight: '100vh',
            padding: 'var(--space-6)',
            fontFamily: 'var(--font-sans)',
          }}
        >
          <div style={{ textAlign: 'center', maxWidth: 480 }}>
            <h2 style={{ marginBottom: 'var(--space-4)' }}>
              Something went wrong
            </h2>
            <p
              style={{
                color: 'var(--color-text-muted)',
                marginBottom: 'var(--space-6)',
              }}
            >
              We had trouble loading this page. Please try again.
            </p>
            <div
              style={{
                display: 'flex',
                gap: 'var(--space-3)',
                justifyContent: 'center',
              }}
            >
              <button
                onClick={this.handleRetry}
                style={{
                  padding: 'var(--space-2) var(--space-4)',
                  background: 'var(--color-primary)',
                  color: 'var(--color-text-inverse)',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  fontWeight: 'var(--font-medium)',
                }}
              >
                Retry
              </button>
              <button
                onClick={this.handleGoHome}
                style={{
                  padding: 'var(--space-2) var(--space-4)',
                  background: 'transparent',
                  color: 'var(--color-text-secondary)',
                  border: 'var(--border-width) solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  fontWeight: 'var(--font-medium)',
                }}
              >
                Back to Dashboard
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
