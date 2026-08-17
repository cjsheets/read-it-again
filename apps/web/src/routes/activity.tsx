import { useWorkerData } from '../app-state.js';
import { librarySourced } from '../components/book-controls.js';

/**
 * What the household has actually read, plus the borrowing history that hints at
 * it. ADR 0009's distinction is the organising principle here: confirmed sessions
 * are things a person recorded, while checkouts and acquisition episodes are
 * library facts that do not prove anyone read anything.
 */
export function Activity() {
  const model = useWorkerData({ type: 'getActivity' }, (response) => response.activity);
  if (!model) return <p className="model-note">Loading…</p>;
  const { checkouts, episodes } = librarySourced(model);

  return (
    <section aria-labelledby="activity-title">
      <div className="section-heading">
        <div>
          <h2 id="activity-title">Reading activity</h2>
          <p className="model-note">Readings you logged, with library history when you have it.</p>
        </div>
      </div>

      <div className="reading-primary">
        <div>
          <h3>Readings</h3>
          {model.sessions.length === 0 ? (
            <p>
              No readings logged yet. Open a book from your shelf and choose{' '}
              <strong>Log a reading</strong>.
            </p>
          ) : (
            <ul data-testid="session-list">
              {model.sessions.map((session) => (
                <li key={session.id}>
                  <strong>{session.title}</strong> · {session.participantNames.join(', ')}
                  <br />
                  <small>
                    {new Date(session.occurredAt).toLocaleDateString()} · {session.context} ·{' '}
                    {session.durationMinutes ?? '?'} min
                  </small>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <details className="library-activity">
        <summary>Library borrowing history</summary>
        <p className="model-note">
          Borrowing records can suggest a pattern, but they never count as a reading unless you log
          one.
        </p>
        <div className="reading-columns">
          <div>
            <h3>Borrowing patterns</h3>
            {episodes.length === 0 ? (
              <p>No borrowing history yet.</p>
            ) : (
              <ul>
                {episodes.map((episode) => (
                  <li key={episode.id}>
                    <strong>{episode.title}</strong> · {episode.readerName}
                    <br />
                    <small>
                      {episode.checkoutCount} checkout{episode.checkoutCount === 1 ? '' : 's'} ·{' '}
                      {episode.recurrenceKind.replace('_', ' ')}
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3>Library records</h3>
            {checkouts.length === 0 ? (
              <p>Nothing borrowed from a library yet.</p>
            ) : (
              <ul>
                {checkouts.map((checkout) => (
                  <li key={checkout.id}>
                    <strong>{checkout.title}</strong> · {checkout.readers.join(', ')}
                    <br />
                    <small>{new Date(checkout.occurredAt).toLocaleDateString()}</small>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </details>
    </section>
  );
}
