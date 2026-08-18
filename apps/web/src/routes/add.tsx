import { useEffect, useRef, useState } from 'react';
import { canonicalIsbn, isValidIsbn } from '@read-it-again/domain';
import { useApp } from '../app-state.js';
import { ScanDialog } from '../components/scan-dialog.js';
import type { Route } from '../router.js';
import { cameraSupported } from '../scanner.js';

/** Entry points for manual books, barcode scans, and file imports. */
export function Add({ go }: { readonly go: (route: Route) => void }) {
  return (
    <section aria-labelledby="add-title">
      <div className="section-heading">
        <div>
          <h2 id="add-title">Add a book</h2>
          <p className="model-note">Books land on your shelf straight away.</p>
        </div>
      </div>
      <div className="tool-grid">
        <TypeItIn go={go} />
      </div>
      <p className="add-elsewhere model-note">
        Have a list already?{' '}
        <button type="button" className="link-button" onClick={() => go('settings')}>
          Bring in books from elsewhere
        </button>
        .
      </p>
    </section>
  );
}

function TypeItIn({ go }: { readonly go: (route: Route) => void }) {
  const {
    busy,
    addBook,
    readerFilter,
    summary,
    setShelfQuery,
    catalogLookupEnabled,
    lookupIsbnMetadata,
  } = useApp();
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [isbn, setIsbn] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scannedProposal, setScannedProposal] = useState(false);
  const [proposal, setProposal] = useState<{
    readonly isbn: string;
    readonly title: string;
    readonly authors: readonly string[];
  } | null>(null);
  const [lookupState, setLookupState] = useState<'idle' | 'loading' | 'unavailable'>('idle');
  const [confirmation, setConfirmation] = useState<{
    readonly title: string;
    readonly created: boolean;
    readonly scanned: boolean;
  } | null>(null);
  const titleField = useRef<HTMLInputElement>(null);

  // Landing on Add — from the nav, the manifest shortcut, or a deep link — should
  // put the cursor where the work happens.
  useEffect(() => titleField.current?.focus(), []);

  // ISBN is optional, but a supplied value must have a valid check digit.
  const isbnBad = isbn.trim().length > 0 && !isValidIsbn(isbn);
  const titleMissing = title.trim().length === 0;

  const submitBook = (nextTitle: string, nextAuthor: string, nextIsbn: string, scanned = false) => {
    const normalizedIsbn = canonicalIsbn(nextIsbn);
    const displayTitle = nextTitle.trim() || `ISBN ${normalizedIsbn ?? nextIsbn.trim()}`;
    setConfirmation(null);
    void addBook({
      title: displayTitle,
      author: nextAuthor.trim() || undefined,
      isbn: normalizedIsbn,
      readerId: readerFilter,
    }).then((result) => {
      if (!result.ok) {
        titleField.current?.focus();
        return;
      }
      setTitle('');
      setAuthor('');
      setIsbn('');
      setProposal(null);
      setLookupState('idle');
      setConfirmation({ title: displayTitle, created: result.created, scanned });
      // Keep the cursor here: this is the rapid-entry surface (P2, J5).
      titleField.current?.focus();
    });
  };

  const lookUp = async (candidate: string, oneTimeConsent = false) => {
    setProposal(null);
    setLookupState('loading');
    const metadata = await lookupIsbnMetadata(candidate, { oneTimeConsent });
    if (metadata) {
      setProposal(metadata);
      setScannedProposal(oneTimeConsent);
      setLookupState('idle');
    } else setLookupState('unavailable');
  };

  return (
    <article>
      <h3>Type it in</h3>
      {cameraSupported() && (
        <>
          <button
            type="button"
            className="scan-button"
            data-testid="open-scanner"
            onClick={() => setScanning(true)}
          >
            Scan a barcode
          </button>
          <p className="model-note scan-disclosure">
            Your camera stays on this device. After a scan, this one ISBN is sent to openlibrary.org
            for suggested details.
          </p>
        </>
      )}
      {scanning && (
        <ScanDialog
          onClose={() => setScanning(false)}
          onIsbn={(scanned) => {
            setIsbn(scanned);
            setProposal(null);
            setLookupState('loading');
            setScanning(false);
            void lookUp(scanned, true);
          }}
          onShowShelf={(matchedTitle) => {
            setShelfQuery(matchedTitle);
            setScanning(false);
            go('shelf');
          }}
        />
      )}
      <form
        className="manual-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (isbnBad || (titleMissing && !isbn.trim())) return;
          submitBook(title, author, isbn);
        }}
      >
        <input
          aria-label="Book title"
          placeholder="Title"
          ref={titleField}
          required={!isbn.trim()}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <input
          aria-label="Book author"
          placeholder="Author (optional)"
          value={author}
          onChange={(event) => setAuthor(event.target.value)}
        />
        <input
          aria-label="Book ISBN"
          placeholder="ISBN (optional)"
          inputMode="numeric"
          aria-invalid={isbnBad}
          aria-describedby={isbnBad ? 'isbn-problem' : undefined}
          value={isbn}
          onChange={(event) => {
            setIsbn(event.target.value);
            setProposal(null);
            setScannedProposal(false);
            setLookupState('idle');
          }}
        />
        {isbnBad && (
          <p className="field-problem" id="isbn-problem" data-testid="isbn-problem">
            That is not a valid ISBN. Check for a mistyped digit, or leave it blank.
          </p>
        )}
        {catalogLookupEnabled && isbn.trim() && !isbnBad && (
          <button
            type="button"
            disabled={busy || lookupState === 'loading'}
            onClick={() => void lookUp(isbn)}
          >
            {lookupState === 'loading' ? 'Looking up…' : 'Look up this ISBN'}
          </button>
        )}
        {lookupState === 'unavailable' && (
          <p className="model-note" data-testid="isbn-lookup-unavailable">
            No details came back. Type the title, or add without a title.
          </p>
        )}
        {proposal && (
          <aside className="isbn-confirm-card" data-testid="isbn-confirm-card">
            <p className="model-note">Open Library suggests</p>
            <h4>{proposal.title}</h4>
            {proposal.authors.length > 0 && <p>{proposal.authors.join(', ')}</p>}
            <div className="decision-actions">
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() =>
                  submitBook(
                    proposal.title,
                    proposal.authors.join(', '),
                    proposal.isbn,
                    scannedProposal,
                  )
                }
              >
                Use these details
              </button>
              <button
                type="button"
                onClick={() => {
                  setTitle(proposal.title);
                  setAuthor(proposal.authors.join(', '));
                  setProposal(null);
                  requestAnimationFrame(() => titleField.current?.focus());
                }}
              >
                Edit them first
              </button>
            </div>
          </aside>
        )}
        {summary.readers.length > 1 && (
          <p className="model-note" data-testid="add-for-reader">
            For{' '}
            {readerFilter
              ? (summary.readers.find((reader) => reader.id === readerFilter)?.displayName ??
                'everyone')
              : (summary.readers[0]?.displayName ?? 'everyone')}
            . Change with the reader switcher above.
          </p>
        )}
        <button type="submit" disabled={busy || isbnBad || (titleMissing && !isbn.trim())}>
          {titleMissing && isbn.trim() && !isbnBad ? 'Add without a title' : 'Add to bookshelf'}
        </button>
        {confirmation && (
          <div className="add-confirmation" role="status" data-testid="add-confirmation">
            <span>
              {confirmation.created
                ? `${confirmation.title} is on your shelf.`
                : `${confirmation.title} was already on your shelf.`}
            </span>
            <button type="button" className="link-button" onClick={() => go('shelf')}>
              View shelf
            </button>
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setConfirmation(null);
                titleField.current?.focus();
              }}
            >
              Add another book
            </button>
            {confirmation.scanned && cameraSupported() && (
              <button type="button" className="link-button" onClick={() => setScanning(true)}>
                Scan another
              </button>
            )}
          </div>
        )}
      </form>
    </article>
  );
}
