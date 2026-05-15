import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorScaffold } from './ErrorScaffold';

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
        <ErrorScaffold
          variant='boundary'
          primaryAction={{ label: 'Retry', onClick: this.handleRetry }}
          secondaryAction={{ label: 'Go home', onClick: this.handleGoHome }}
        />
      );
    }

    return this.props.children;
  }
}
