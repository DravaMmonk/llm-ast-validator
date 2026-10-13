/**
 * Last line of defence: a module that throws while rendering shows a calm,
 * recoverable message instead of a blank window. The rest of the shell keeps
 * working, and saved work is unaffected because it lives behind the local API.
 */

import { Component, type ReactNode } from "react";

import { EmptyState, pillBtn, primaryBtn } from "../shared-console/src";

export class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(previous: { resetKey: string }) {
    // Navigating to another module clears the failure.
    if (previous.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  componentDidCatch(error: Error) {
    console.warn("[workstation] a module failed to render", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <EmptyState
          title="This view ran into a problem"
          hint={`${this.state.error.message || "An unexpected error occurred."} Your saved work is safe — it is stored by the local API.`}
          action={
            <div className="flex gap-2">
              <button type="button" className={primaryBtn} onClick={() => this.setState({ error: null })}>
                Try again
              </button>
              <button type="button" className={pillBtn} onClick={() => window.location.assign("/")}>
                Go to Overview
              </button>
            </div>
          }
        />
      </div>
    );
  }
}
