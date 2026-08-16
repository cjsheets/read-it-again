import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * F-20: any render throw used to yield a blank cream page. The recovery path
 * deliberately offers a reload first and says plainly that the data is still on
 * disk, because the instinct after seeing a broken app is to clear site data —
 * which is the one action that would actually destroy the bookshelf.
 */
export class ErrorBoundary extends Component<
  { readonly children: ReactNode },
  { error: Error | null }
> {
  constructor(props: { readonly children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Read It Again failed to render', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="crash" data-testid="crash">
        <h1>Something went wrong</h1>
        <p>
          The app could not draw this screen. <strong>Your books are still saved</strong> in this
          browser — this is a display problem, not lost data.
        </p>
        <p>
          Reload to try again. Do not clear this site&rsquo;s data: that is the one thing that would
          delete your bookshelf.
        </p>
        <p className="crash-detail">{this.state.error.message}</p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </main>
    );
  }
}
