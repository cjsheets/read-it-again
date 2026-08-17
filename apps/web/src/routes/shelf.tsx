import { useState } from 'react';
import type { ReadingModelView } from '@read-it-again/storage-schema';
import { taskCount, useApp } from '../app-state.js';
import { BookDetail } from '../components/book-detail.js';
import { Cover } from '../components/cover.js';
import { useCover } from '../components/use-cover.js';
import type { Route } from '../router.js';

type ShelfItem = ReadingModelView['shelf'][number];

/**
 * The home screen, and the object the product is about. A grid of covers rather
 * than a list of forms: the audit's single biggest visual-density note was that
 * every card rendered a full assessment form — two dials, seven chips, three
 * checkboxes, a number input and two buttons — simultaneously. That form now lives
 * in the detail view, one tap away (F-15, audit §7.1).
 */
export function Shelf({ go }: { readonly go: (route: Route) => void }) {
  const { bookshelf } = useApp();
  const [openBook, setOpenBook] = useState<string | null>(null);
  const shelf = bookshelf.readingModel.shelf;
  const tasks = taskCount(bookshelf);
  const selected = shelf.find((item) => keyOf(item) === openBook);

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
      <ul className="cover-grid">
        {shelf.map((item) => (
          <ShelfTile key={keyOf(item)} item={item} onOpen={() => setOpenBook(keyOf(item))} />
        ))}
      </ul>
      {selected && <BookDetail item={selected} onClose={() => setOpenBook(null)} />}
    </section>
  );
}

function keyOf(item: ShelfItem): string {
  return `${item.workId}:${item.personId}`;
}

function ShelfTile({ item, onOpen }: { readonly item: ShelfItem; readonly onOpen: () => void }) {
  const cover = useCover(item.workId, item.hasCover);
  const author = item.authors[0] ?? null;
  const rated = item.childEngagement !== null;

  return (
    <li className="cover-tile" data-testid="shelf-card">
      <button type="button" className="cover-button" onClick={onOpen}>
        <Cover
          workId={item.workId}
          title={item.title}
          author={author}
          bytes={cover?.bytes}
          mime={cover?.mime}
        />
        <span className="cover-caption">
          <span className="cover-title">{item.title}</span>
          {author && <span className="cover-author">{author}</span>}
          <span className="cover-meta">
            {rated ? (
              <span aria-label={`Child engagement: ${String(item.childEngagement)} of 3`}>
                {'●'.repeat((item.childEngagement ?? 0) + 1)}
                <span className="cover-meta-dim">
                  {'○'.repeat(3 - (item.childEngagement ?? 0))}
                </span>
              </span>
            ) : (
              <span className="cover-meta-dim">Not rated</span>
            )}
            {item.veto && <span className="cover-flag">Veto</span>}
          </span>
        </span>
      </button>
    </li>
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
