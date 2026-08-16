import { useApp } from '../app-state.js';
import { librarySourced } from '../components/book-controls.js';

/**
 * What the household has actually read, plus the borrowing history that hints at
 * it. ADR 0009's distinction is the organising principle here: confirmed sessions
 * are things a person recorded, while checkouts and acquisition episodes are
 * library facts that do not prove anyone read anything.
 */
export function Activity() {
  const { bookshelf } = useApp();
  const model = bookshelf.readingModel;
  const { checkouts, episodes } = librarySourced(model);

  return (
    <section aria-labelledby="activity-title">
      <div className="section-heading">
        <div>
          <h2 id="activity-title">Activity</h2>
          <p className="model-note">
            Readings you recorded, and what the library says you borrowed.
          </p>
        </div>
      </div>

      <div className="reading-columns">
        <div>
          <h3>Confirmed reading sessions</h3>
          <p className="model-note">Only sessions a household member explicitly records.</p>
          {model.sessions.length === 0 ? (
            <p>
              No confirmed sessions yet. Use <strong>Read tonight</strong> on any book to log one.
            </p>
          ) : (
            <ul data-testid="session-list">
              {model.sessions.map((session) => (
                <li key={session.id}>
                  <strong>{session.title}</strong> · {session.participantNames.join(', ')}
                  <br />
                  <small>
                    {session.context} · {session.durationMinutes ?? '?'} min
                  </small>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3>Acquisition episodes</h3>
          <p className="model-note">Derived from checkout proximity; not confirmed readings.</p>
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
          <h3>Checkout observations</h3>
          <p className="model-note">Imported library facts; a checkout does not prove reading.</p>
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
    </section>
  );
}
