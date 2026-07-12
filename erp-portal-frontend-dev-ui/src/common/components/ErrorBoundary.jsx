import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("PM Portal error:", error, info);
  }

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div className="pm-page" style={{ padding: 48, maxWidth: 560, margin: "0 auto" }}>
          <div className="pm-card">
            <h1 style={{ margin: "0 0 8px", fontSize: 20 }}>Something went wrong</h1>
            <p style={{ color: "var(--muted)", margin: "0 0 16px" }}>
              The page hit an unexpected error. Try refreshing or signing in again.
            </p>
            <p className="pm-error-banner" style={{ marginBottom: 16 }}>
              {error.message || String(error)}
            </p>
            <button type="button" className="pm-btn pm-btn-primary" onClick={() => window.location.reload()}>
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
