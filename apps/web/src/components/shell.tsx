import { useEffect, useRef, type ReactNode } from 'react';
import { ERROR_ACTIONS, ERROR_TITLES, useApp } from '../app-state.js';
import { DESTINATIONS, type Route } from '../router.js';

/** Desktop sidebar and mobile tab bar around the current route. */
export function Shell({
  route,
  go,
  children,
}: {
  readonly route: Route;
  readonly go: (route: Route) => void;
  readonly children: ReactNode;
}) {
  const {
    summary,
    status,
    clearStatus,
    undoAction,
    error,
    wiped,
    dismissWipeNotice,
    readerFilter,
    setReaderFilter,
    catalogFetchActive,
  } = useApp();
  const previousRoute = useRef(route);
  const tasks = summary.taskCount;
  const destinations = DESTINATIONS.filter(
    (destination) =>
      (destination.id !== 'tasks' || tasks > 0) &&
      (destination.id !== 'discover' || summary.recommendationCount > 0),
  );
  const passiveStatus =
    status === '' || status === 'No books imported yet.' || status === 'Bookshelf ready.';

  useEffect(() => {
    if (previousRoute.current !== route) clearStatus();
    previousRoute.current = route;
  }, [clearStatus, route]);

  useEffect(() => {
    if (passiveStatus || status === 'Opening your private bookshelf…') return;
    const timer = window.setTimeout(clearStatus, 6000);
    return () => window.clearTimeout(timer);
  }, [clearStatus, passiveStatus, status]);

  return (
    <div className="shell">
      <a className="skip-link" href="#content">
        Skip to content
      </a>

      <nav className="shell-nav" aria-label="Sections">
        <p className="shell-brand" aria-hidden="true">
          Read It Again
        </p>
        <ul>
          {destinations.map((destination) => (
            <li key={destination.id}>
              <button
                type="button"
                aria-current={route === destination.id ? 'page' : undefined}
                data-testid={`nav-${destination.id}`}
                onClick={() => go(destination.id)}
              >
                <span className="nav-label">{destination.label}</span>
                {destination.id === 'tasks' && tasks > 0 && (
                  <span className="nav-badge" data-testid="tasks-badge">
                    {tasks}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="shell-settings"
          aria-current={route === 'settings' ? 'page' : undefined}
          data-testid="nav-settings"
          onClick={() => go('settings')}
        >
          Settings
        </button>
      </nav>

      <main id="content" tabIndex={-1}>
        {/* A reader switcher is useful only when there is a choice. */}
        {summary.readers.length > 1 && (
          <div className="reader-switcher">
            <span id="reader-switcher-label">Showing books for</span>
            <div role="group" aria-labelledby="reader-switcher-label">
              <button
                type="button"
                aria-pressed={readerFilter === null}
                data-testid="reader-everyone"
                onClick={() => setReaderFilter(null)}
              >
                Everyone
              </button>
              {summary.readers.map((reader) => (
                <button
                  key={reader.id}
                  type="button"
                  aria-pressed={readerFilter === reader.id}
                  data-testid={`reader-filter-${reader.id}`}
                  onClick={() => setReaderFilter(reader.id)}
                >
                  {reader.displayName}
                </button>
              ))}
            </div>
          </div>
        )}

        {wiped && <WipeNotice go={go} onDismiss={dismissWipeNotice} />}

        {/* Visible for as long as the network activity lasts, not a toast that
            disappears before anyone reads it. If this app is talking to another
            service, the person using it should be able to see that while it is
            happening (ADR 0016). */}
        {catalogFetchActive && (
          <p className="network-indicator" role="status" data-testid="catalog-fetch-indicator">
            Fetching cover art from openlibrary.org…{' '}
            <button type="button" className="link-button" onClick={() => go('settings')}>
              Stop
            </button>
          </p>
        )}

        <p
          className={passiveStatus ? 'status is-passive' : 'status'}
          role="status"
          data-testid="import-status"
        >
          {status}
          {undoAction && (
            <>
              {' '}
              <button type="button" className="link-button" onClick={undoAction.run}>
                Undo
              </button>
            </>
          )}
        </p>

        {error && (
          <section className="error" role="alert">
            <strong data-testid="error-title">{ERROR_TITLES[error.operation]}</strong>
            <ul>
              {error.issues.slice(0, 8).map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
            {ERROR_ACTIONS[error.operation] && (
              <p className="error-action">{ERROR_ACTIONS[error.operation]}</p>
            )}
          </section>
        )}

        {children}
      </main>
    </div>
  );
}

function WipeNotice({
  go,
  onDismiss,
}: {
  readonly go: (route: Route) => void;
  readonly onDismiss: () => void;
}) {
  return (
    <section className="wipe-notice" role="alert" data-testid="wipe-notice">
      <strong>Your books are gone from this browser.</strong>
      <p>
        This device had a bookshelf and its storage is now empty. That usually means the browser
        cleared site data, or reclaimed space because storage was not marked as persistent. Nothing
        was ever sent anywhere, so nothing can be recovered from a server — but an encrypted backup
        will restore everything.
      </p>
      <div className="decision-actions">
        <button type="button" onClick={() => go('settings')}>
          Restore from a backup
        </button>
        <button type="button" onClick={onDismiss}>
          Start over instead
        </button>
      </div>
    </section>
  );
}
