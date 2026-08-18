import { useEffect, useMemo, useRef, useState } from 'react';
import type { ShelfEntry, ShelfSort } from '@read-it-again/storage-schema';
import { useApp } from '../app-state.js';
import { requestWorker } from '../client.js';
import { BookDetail } from '../components/book-detail.js';
import { Cover } from '../components/cover.js';
import { PrivacyCopy } from '../components/privacy-copy.js';
import { useCover } from '../components/use-cover.js';
import { VirtualGrid, type AriaPosition, type GridWindow } from '../components/virtual-grid.js';
import type { Route } from '../router.js';

/** Tile height plus the 20px row gap, matching `.cover-tile` in the stylesheet. */
const ROW_HEIGHT = 350;
const MIN_COLUMN = 150;
/** Shelf pages are fetched in blocks of this size. */
const PAGE = 60;

const SORTS: readonly { readonly value: ShelfSort; readonly label: string }[] = [
  { value: 'recent', label: 'Recently added' },
  { value: 'title', label: 'Title' },
  { value: 'author', label: 'Author' },
  { value: 'rating', label: 'Rating' },
];

/**
 * The home screen, and the object the product is about. Since ADR 0014 it reads a
 * page at a time and renders only what is near the viewport, so a household with a
 * thousand books pays for a screenful rather than a library.
 */
export function Shelf({ go }: { readonly go: (route: Route) => void }) {
  const {
    summary,
    summaryReady,
    revision,
    readerFilter,
    assignReaders,
    shelfQuery: query,
    setShelfQuery: setQuery,
  } = useApp();
  const [selection, setSelection] = useState<readonly string[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [sort, setSort] = useState<ShelfSort>('recent');
  const [openBook, setOpenBook] = useState<string | null>(null);
  const [window, setWindow] = useState<GridWindow>({
    first: 0,
    count: 60,
    columns: 1,
    rowHeight: ROW_HEIGHT,
    totalRows: 0,
  });
  const page = useShelfPage(query, sort, window.first, window.count, revision, readerFilter);
  // Keyed by work alone, not by (work, reader): reassigning a book from inside its
  // own drawer changes which reader represents it, and a composite key would make
  // the drawer vanish mid-edit.
  const selected = page?.entries.find((entry) => entry.workId === openBook);
  const searching = query.trim().length > 0;

  const total = page?.total ?? summary.bookCount;
  const filtered = readerFilter !== null;
  const readerName = summary.readers.find((reader) => reader.id === readerFilter)?.displayName;

  if (!summaryReady && !searching && !filtered) return <ShelfSkeleton />;

  // Only a genuinely empty household gets the first-run screen. A filter or a
  // search that matches nothing is a different situation and must say which.
  if (summary.bookCount === 0 && !searching && !filtered) {
    return <FirstRun go={go} hasTasks={summary.taskCount > 0} />;
  }

  return (
    <section aria-labelledby="shelf-title" data-testid="shelf">
      <div className="section-heading">
        <div>
          <h2 id="shelf-title">Your bookshelf</h2>
          <p className="model-note">Every book this household has on the shelf.</p>
        </div>
        <span className="count" data-testid="shelf-count">
          {total} {total === 1 ? 'book' : 'books'}
        </span>
      </div>

      <div className="shelf-controls">
        <input
          type="search"
          aria-label="Search your bookshelf"
          data-testid="shelf-search"
          placeholder="Search title or author"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <label className="shelf-sort">
          Sort{' '}
          <select
            aria-label="Sort the bookshelf"
            data-testid="shelf-sort"
            value={sort}
            onChange={(event) => setSort(event.target.value as ShelfSort)}
          >
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="select-mode"
          data-testid="selection-mode"
          aria-pressed={selectionMode}
          onClick={() => {
            setSelectionMode((current) => !current);
            setSelection([]);
          }}
        >
          {selectionMode ? 'Done selecting' : 'Select books'}
        </button>
      </div>

      {summary.taskCount > 0 && (
        <p className="shelf-tasks">
          <button type="button" className="link-button" onClick={() => go('tasks')}>
            {summary.taskCount} {summary.taskCount === 1 ? 'book needs' : 'books need'} a decision
          </button>
        </p>
      )}

      {total === 0 && searching ? (
        <div className="empty" data-testid="no-matches">
          Nothing on your shelf matches “{query}”.
        </div>
      ) : total === 0 && filtered ? (
        <div className="empty" data-testid="reader-empty">
          No books are filed under {readerName ?? 'this reader'} yet. Switch to Everyone to see the
          whole shelf.
        </div>
      ) : (
        <VirtualGrid
          total={total}
          items={page?.entries ?? []}
          offset={page?.offset ?? 0}
          minColumnWidth={MIN_COLUMN}
          rowHeight={ROW_HEIGHT}
          onWindowChange={setWindow}
        >
          {(entry, _index, aria) => (
            <ShelfTile
              key={entry.workId}
              entry={entry}
              aria={aria}
              selected={selection.includes(entry.workId)}
              selecting={selectionMode}
              onToggle={() =>
                setSelection((current) =>
                  current.includes(entry.workId)
                    ? current.filter((id) => id !== entry.workId)
                    : [...current, entry.workId],
                )
              }
              onOpen={() => setOpenBook(entry.workId)}
            />
          )}
        </VirtualGrid>
      )}

      {selection.length > 0 && (
        <SelectionBar
          count={selection.length}
          readers={summary.readers}
          onAssign={(readerIds) => {
            void assignReaders(selection, readerIds).then(() => setSelection([]));
          }}
          onClear={() => setSelection([])}
        />
      )}

      {selected && <BookDetail item={selected} onClose={() => setOpenBook(null)} />}
    </section>
  );
}

/**
 * Fetches the page covering the visible window. Search is debounced because a
 * keystroke should not cost a query, and the request is widened to whole pages so
 * scrolling a row does not re-fetch.
 */
function useShelfPage(
  query: string,
  sort: ShelfSort,
  first: number,
  count: number,
  revision: number,
  readerId: string | null,
) {
  const [page, setPage] = useState<
    { entries: readonly ShelfEntry[]; total: number; offset: number } | undefined
  >(undefined);
  const debounced = useDebounced(query, 120);
  // Page-aligned in blocks of 60, so ordinary scrolling reuses what is loaded.
  // The limit is measured from the aligned offset to the end of the window, not
  // from the window's own size — otherwise a window straddling a boundary asks
  // for a page that stops short of the rows it needs.
  const offset = Math.floor(first / PAGE) * PAGE;
  const limit = Math.max(PAGE, Math.ceil((first + count - offset) / PAGE) * PAGE);

  useEffect(() => {
    let cancelled = false;
    void requestWorker({ type: 'listShelf', query: debounced, sort, offset, limit, readerId }).then(
      (response) => {
        if (cancelled || !response.ok || !response.shelf) return;
        setPage(response.shelf);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [debounced, sort, offset, limit, revision, readerId]);

  return page;
}

function useDebounced(value: string, delay: number): string {
  const [settled, setSettled] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer.current);
  }, [value, delay]);
  return settled;
}

/** Applies one reader assignment to the selected books. */
function SelectionBar({
  count,
  readers,
  onAssign,
  onClear,
}: {
  readonly count: number;
  readonly readers: readonly { readonly id: string; readonly displayName: string }[];
  readonly onAssign: (readerIds: readonly string[]) => void;
  readonly onClear: () => void;
}) {
  return (
    <div
      className="selection-bar"
      role="region"
      aria-label="Selected books"
      data-testid="selection-bar"
    >
      <span data-testid="selection-count">
        {count} {count === 1 ? 'book' : 'books'} selected
      </span>
      <div className="decision-actions">
        {readers.map((reader) => (
          <button
            key={reader.id}
            type="button"
            data-testid={`bulk-assign-${reader.id}`}
            onClick={() => onAssign([reader.id])}
          >
            File under {reader.displayName}
          </button>
        ))}
        {readers.length > 1 && (
          <button type="button" onClick={() => onAssign(readers.map((reader) => reader.id))}>
            File under everyone
          </button>
        )}
        <button type="button" data-testid="clear-selection" onClick={onClear}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function ShelfTile({
  entry,
  aria,
  selected,
  selecting,
  onToggle,
  onOpen,
}: {
  readonly entry: ShelfEntry;
  readonly aria: AriaPosition;
  readonly selected: boolean;
  readonly selecting: boolean;
  readonly onToggle: () => void;
  readonly onOpen: () => void;
}) {
  const cover = useCover(entry.workId, entry.hasCover);
  const author = entry.authors[0] ?? null;
  const rated = entry.childEngagement !== null;
  const dots = useMemo(
    () => ({
      filled: '●'.repeat((entry.childEngagement ?? 0) + 1),
      empty: '○'.repeat(3 - (entry.childEngagement ?? 0)),
    }),
    [entry.childEngagement],
  );

  return (
    <li
      className={selected ? 'cover-tile is-selected' : 'cover-tile'}
      data-testid="shelf-card"
      {...aria}
    >
      {selecting && (
        <label className="cover-select">
          <input
            type="checkbox"
            aria-label={`Select ${entry.title}`}
            checked={selected}
            onChange={onToggle}
          />
        </label>
      )}
      {/* While a selection exists the tile toggles rather than opens, so a
          mis-tap adds a book instead of losing the selection to a drawer. */}
      <button
        type="button"
        className="cover-button"
        aria-label={`Open ${entry.title}`}
        onClick={selecting ? onToggle : onOpen}
      >
        <Cover
          workId={entry.workId}
          title={entry.title}
          author={author}
          bytes={cover?.bytes}
          mime={cover?.mime}
        />
        <span className="cover-caption">
          {!!cover?.bytes?.byteLength && <span className="cover-title">{entry.title}</span>}
          {author && <span className="cover-author">{author}</span>}
          {entry.readers.length > 1 && (
            <span className="cover-readers">
              {entry.readers.map((reader) => (
                <span key={reader.id} className="reader-chip" title={reader.displayName}>
                  {reader.displayName.slice(0, 1).toLocaleUpperCase('en-US')}
                </span>
              ))}
            </span>
          )}
          <span className="cover-meta">
            {rated ? (
              <span aria-label={`Kid liked it: ${String(entry.childEngagement)} of 3`}>
                {dots.filled}
                <span className="cover-meta-dim">{dots.empty}</span>
              </span>
            ) : (
              <span className="cover-meta-dim">Not rated</span>
            )}
            {entry.veto && <span className="cover-flag">Don&rsquo;t suggest this again</span>}
          </span>
        </span>
      </button>
    </li>
  );
}

/** Empty-state copy for a household that has not added its first book. */
function FirstRun({
  go,
  hasTasks,
}: {
  readonly go: (route: Route) => void;
  readonly hasTasks: boolean;
}) {
  const [explaining, setExplaining] = useState(false);
  const explanationTrigger = useRef<HTMLButtonElement>(null);
  const closeExplanation = () => {
    setExplaining(false);
    requestAnimationFrame(() => explanationTrigger.current?.focus());
  };

  return (
    <>
      <section className="first-run" aria-labelledby="first-run-title" data-testid="first-run">
        <h2 id="first-run-title">Your shelf is empty</h2>
        {hasTasks ? (
          <p>Some books came in but none are on the shelf yet. Check what needs a decision.</p>
        ) : (
          <p>
            Add the books you already own, and this becomes the place to check before you buy a
            picture book twice.
          </p>
        )}
        <div className="first-run-actions">
          <button type="button" className="primary" onClick={() => go(hasTasks ? 'tasks' : 'add')}>
            {hasTasks ? 'See what needs a decision' : 'Add your first book'}
          </button>
        </div>
        <p className="first-run-privacy">
          Your books and reading history stay in this browser.{' '}
          <button
            type="button"
            className="link-button"
            ref={explanationTrigger}
            onClick={() => setExplaining(true)}
          >
            How this works
          </button>
        </p>
      </section>
      {explaining && <PrivacyExplanation onClose={closeExplanation} />}
    </>
  );
}

function PrivacyExplanation({ onClose }: { readonly onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="detail-scrim" role="presentation" onClick={onClose}>
      <div
        className="privacy-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="privacy-dialog-title"
        ref={panel}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="privacy-dialog-head">
          <h2 id="privacy-dialog-title">How this works</h2>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <PrivacyCopy />
      </div>
    </div>
  );
}

function ShelfSkeleton() {
  return (
    <section className="shelf-loading" data-testid="shelf-loading" aria-label="Loading your shelf">
      <span className="shelf-loading-heading" />
      <div aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </section>
  );
}
