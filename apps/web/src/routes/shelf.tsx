import { useApp, taskCount } from '../app-state.js';
import { AssessmentCard } from '../components/book-controls.js';
import type { Route } from '../router.js';

/**
 * The home screen, and the object the product is about. Everything that used to
 * sit above the bookshelf — an import panel, a capability disclaimer, two review
 * queues — has moved to where it belongs (audit §6.3).
 *
 * Covers and virtualization arrive in Increments 5 and 6; this is the same card
 * grid as before, finally sited as the front door.
 */
export function Shelf({ go }: { readonly go: (route: Route) => void }) {
  const { bookshelf } = useApp();
  const shelf = bookshelf.readingModel.shelf;
  const tasks = taskCount(bookshelf);

  if (shelf.length === 0) return <FirstRun go={go} hasRecords={bookshelf.records.length > 0} />;

  return (
    <section aria-labelledby="shelf-title" data-testid="shelf">
      <div className="section-heading">
        <div>
          <h2 id="shelf-title">Your bookshelf</h2>
          <p className="model-note">Every book this household has on the shelf.</p>
        </div>
        <span className="count" data-testid="shelf-count">
          {shelf.length} {shelf.length === 1 ? 'book' : 'books'}
        </span>
      </div>
      {tasks > 0 && (
        <p className="shelf-tasks">
          <button type="button" className="link-button" onClick={() => go('tasks')}>
            {tasks} {tasks === 1 ? 'book needs' : 'books need'} a decision
          </button>
        </p>
      )}
      <div className="shelf-grid">
        {shelf.map((item) => (
          <AssessmentCard key={`${item.workId}:${item.personId}`} item={item} />
        ))}
      </div>
    </section>
  );
}

/**
 * N9. The old first screen led with "Import a Libby timeline snapshot" — a
 * product-defining sentence about the journey most people will never take — and
 * followed it with a green box explaining what the app cannot do. This leads with
 * the thing that works, and states the privacy boundary once, briefly, as a
 * capability rather than an apology.
 */
function FirstRun({
  go,
  hasRecords,
}: {
  readonly go: (route: Route) => void;
  readonly hasRecords: boolean;
}) {
  return (
    <section className="first-run" aria-labelledby="first-run-title" data-testid="first-run">
      <h2 id="first-run-title">Your shelf is empty</h2>
      {hasRecords ? (
        <p>Some books came in but none are on the shelf yet. Check what needs a decision.</p>
      ) : (
        <p>
          Add the books you already own, and this becomes the place to check before you buy a
          picture book twice.
        </p>
      )}
      <div className="first-run-actions">
        <button type="button" className="primary" onClick={() => go(hasRecords ? 'tasks' : 'add')}>
          {hasRecords ? 'See what needs a decision' : 'Add your first book'}
        </button>
      </div>
      <p className="first-run-privacy">
        Everything stays in this browser. Nothing is ever sent anywhere.{' '}
        <button type="button" className="link-button" onClick={() => go('settings')}>
          How this works
        </button>
      </p>
    </section>
  );
}
