import { Component, type ReactNode } from "react";

/** Keeps one broken view from blanking the whole window. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: unknown }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { resetKey?: unknown }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-void p-8 text-center">
        <div className="chrome-text text-[18px] font-semibold">Something went wrong in this view</div>
        <pre className="max-w-xl whitespace-pre-wrap rounded-lg border border-line bg-raised p-3 font-mono text-[11px] text-rose">{this.state.error.message}</pre>
        <button className="chrome-face h-8 rounded-lg px-4 text-[13px] font-semibold" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}
