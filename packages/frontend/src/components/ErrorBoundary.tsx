import { Component, type ReactNode } from "react";

/**
 * The last line of defence. Without it, any render throw — an unexpected null
 * from the API, say — unmounts the tree to a blank white page with no way back.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error("[aznex] render error:", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="container">
        <div className="note note-danger" role="alert">
          <h1>This page broke</h1>
          <p>
            Something went wrong rendering <code>{window.location.pathname}</code>. Reloading usually
            fixes it.
          </p>
          <div className="confirm-actions">
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
              Reload
            </button>
            {/* A plain link, not a router navigation: the router is part of the
                tree that just failed. */}
            <a className="btn" href="/">
              Go to repositories
            </a>
          </div>
          <details className="note-detail">
            <summary>Technical details</summary>
            <code>{this.state.error.message}</code>
          </details>
        </div>
      </main>
    );
  }
}
