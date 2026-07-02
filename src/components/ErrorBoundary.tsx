import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: Error, errorInfo: ErrorInfo, reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * Catches JavaScript errors anywhere in the child component tree and displays a
 * fallback UI instead of crashing the app.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    this.setState({
      error,
      errorInfo,
    });
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(
          this.state.error,
          this.state.errorInfo!,
          this.handleReset
        );
      }

      // Default fallback UI
      return (
        <div className="h-[100dvh] overflow-y-auto bg-gradient-to-br from-[rgb(var(--color-surface))] to-[rgb(var(--color-ambient))]">
          <div className="min-h-full flex items-center justify-center p-6">
          <div className="glass rounded-3xl p-8 max-w-2xl w-full space-y-6 bg-[rgba(var(--color-surface),0.95)] shadow-[0_20px_70px_-40px_rgba(var(--color-accent),0.3)] border border-[rgba(var(--color-border),0.6)]">
            <div className="flex items-center justify-center">
              <div className="w-20 h-20 rounded-[20px] bg-[rgba(255,80,80,0.15)] flex items-center justify-center">
                <AlertTriangle className="w-10 h-10 text-red-500" />
              </div>
            </div>

            <div className="text-center space-y-3">
              <h1 className="text-2xl font-bold text-[rgb(var(--color-text))]">
                Oops! Something went wrong
              </h1>
              <p className="text-[15px] text-[rgb(var(--color-text-secondary))]">
                The application encountered an unexpected error. Don't worry, your data is safe.
              </p>
            </div>

            {import.meta.env.DEV && (
              <details className="space-y-3">
                <summary className="cursor-pointer text-sm font-medium text-[rgb(var(--color-text-secondary))] hover:text-[rgb(var(--color-text))] transition-colors">
                  Error Details (Development Mode)
                </summary>
                <div className="mt-3 p-4 rounded-2xl bg-[rgba(var(--color-border),0.2)] border border-[rgba(var(--color-border),0.4)]">
                  <pre className="text-xs text-[rgb(var(--color-text-secondary))] overflow-x-auto whitespace-pre-wrap break-words">
                    <strong>Error:</strong> {this.state.error.message}
                    {'\n\n'}
                    <strong>Stack Trace:</strong>
                    {'\n'}
                    {this.state.error.stack}
                    {this.state.errorInfo?.componentStack && (
                      <>
                        {'\n\n'}
                        <strong>Component Stack:</strong>
                        {this.state.errorInfo.componentStack}
                      </>
                    )}
                  </pre>
                </div>
              </details>
            )}

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                onClick={this.handleReset}
                className="flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-2xl bg-[rgb(var(--color-text))] text-[rgb(var(--color-background))] font-semibold text-[15px] hover:opacity-90 transition-opacity ios-button"
              >
                <RefreshCw className="w-5 h-5" />
                Try Again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="flex-1 px-6 py-3 rounded-2xl bg-[rgba(var(--color-border),0.3)] text-[rgb(var(--color-text))] font-semibold text-[15px] hover:bg-[rgba(var(--color-border),0.4)] transition-colors ios-button"
              >
                Reload Page
              </button>
            </div>

            <p className="text-xs text-center text-[rgb(var(--color-text-secondary))]">
              If the problem persists, try refreshing the page or clearing your browser cache.
            </p>
          </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
