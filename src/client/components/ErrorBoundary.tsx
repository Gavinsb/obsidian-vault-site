import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * App-level error boundary.
 *
 * Without one, a render-time exception anywhere in the tree unmounts the whole
 * app and leaves a blank page with the raw error only in the console. This
 * catches it, keeps the shell, and shows a plain-language recovery card with
 * the option to reload or go home.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the raw detail in the console for debugging; the UI stays human.
    console.error("Unhandled UI error:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="view">
        <div className="card error-card not-found" role="alert">
          <h2>Something went wrong</h2>
          <p>
            The page hit an unexpected error and could not finish rendering.
            Your vault files were not changed.
          </p>
          <div className="error-actions">
            <button className="primary" onClick={() => window.location.reload()}>
              Reload
            </button>
            <button
              onClick={() => {
                this.setState({ error: null });
                window.location.assign("/");
              }}
            >
              ← Back to home
            </button>
          </div>
        </div>
      </div>
    );
  }
}
