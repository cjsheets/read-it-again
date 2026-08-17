import type { ReactNode } from 'react';
import { ERROR_ACTIONS, ERROR_TITLES, useApp } from '../app-state.js';
import { DESTINATIONS, type Route } from '../router.js';

/**
 * Audit §7.3. A persistent sidebar at desktop widths and a bottom tab bar on
 * mobile, so navigation never disappears — the previous build had none at all,
 * and no `nav` landmark or skip link either (F-20).
 */
export function Shell({
  route,
  go,
  children,
}: {
  readonly route: Route;
  readonly go: (route: Route) => void;
  readonly children: ReactNode;
}) {
  const { summary, status, error, wiped, dismissWipeNotice } = useApp();
  const tasks = summary.taskCount;

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
          {DESTINATIONS.map((destination) => (
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
        {wiped && <WipeNotice go={go} onDismiss={dismissWipeNotice} />}

        <p className="status" role="status" data-testid="import-status">
          {status}
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
