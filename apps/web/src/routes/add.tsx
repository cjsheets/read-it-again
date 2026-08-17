import { useEffect, useRef, useState } from 'react';
import { isValidIsbn } from '@read-it-again/domain';
import { useApp } from '../app-state.js';
import { ScanDialog } from '../components/scan-dialog.js';
import type { Route } from '../router.js';
import { cameraSupported } from '../scanner.js';

/** Entry points for manual books, barcode scans, and file imports. */
export function Add({ go }: { readonly go: (route: Route) => void }) {
  const { busy, importCsvFile, importLibbyFile } = useApp();
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
        <article>
          <h3>Import a spreadsheet</h3>
          <p>A CSV with title, author, ISBN, date, and format columns.</p>
          <label className={busy ? 'file-button disabled' : 'file-button'}>
            <span>Choose CSV file</span>
            <input
              data-testid="csv-file"
              type="file"
              accept="text/csv,.csv"
              disabled={busy}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void importCsvFile(file);
                event.currentTarget.value = '';
              }}
            />
          </label>
        </article>
        <article>
          <h3>Import a Libby timeline</h3>
          <p>In Libby, choose Timeline → Export Timeline → Data (JSON).</p>
          <label className={busy ? 'file-button disabled' : 'file-button'}>
            <span>{busy ? 'Working…' : 'Choose JSON file'}</span>
            <input
              data-testid="libby-file"
              type="file"
              accept="application/json,.json"
              disabled={busy}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void importLibbyFile(file);
                event.currentTarget.value = '';
              }}
            />
          </label>
        </article>
      </div>
    </section>
  );
}

function TypeItIn({ go }: { readonly go: (route: Route) => void }) {
  const { busy, addBook, readerFilter, summary, scanningEnabled, setShelfQuery } = useApp();
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [isbn, setIsbn] = useState('');
  const [scanning, setScanning] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    readonly title: string;
    readonly created: boolean;
  } | null>(null);
  const titleField = useRef<HTMLInputElement>(null);

  // Landing on Add — from the nav, the manifest shortcut, or a deep link — should
  // put the cursor where the work happens.
  useEffect(() => titleField.current?.focus(), []);

  // ISBN is optional, but a supplied value must have a valid check digit.
  const isbnBad = isbn.trim().length > 0 && !isValidIsbn(isbn);

  return (
    <article>
      <h3>Type it in</h3>
      {/* Scanning is opt-in until the field test is complete. */}
      {scanningEnabled && cameraSupported() && (
        <button
          type="button"
          className="scan-button"
          data-testid="open-scanner"
          onClick={() => setScanning(true)}
        >
          Scan a barcode
        </button>
      )}
      {scanning && (
        <ScanDialog
          onClose={() => setScanning(false)}
          onIsbn={(scanned) => {
            // A scan yields an edition identifier and nothing else: there is no
            // catalog to turn it into a title (ADR 0002). So it fills the field it
            // can and hands the person back the one it cannot.
            setIsbn(scanned);
            setScanning(false);
            titleField.current?.focus();
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
          if (isbnBad) return;
          const submittedTitle = title.trim();
          setConfirmation(null);
          void addBook({
            title,
            author: author || undefined,
            isbn: isbn || undefined,
            readerId: readerFilter,
          }).then((result) => {
            if (!result.ok) {
              titleField.current?.focus();
              return;
            }
            setTitle('');
            setAuthor('');
            setIsbn('');
            setConfirmation({ title: submittedTitle, created: result.created });
            // Keep the cursor here: this is the rapid-entry surface (P2, J5).
            titleField.current?.focus();
          });
        }}
      >
        <input
          aria-label="Book title"
          placeholder="Title"
          ref={titleField}
          required
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
          onChange={(event) => setIsbn(event.target.value)}
        />
        {isbnBad && (
          <p className="field-problem" id="isbn-problem" data-testid="isbn-problem">
            That is not a valid ISBN. Check for a mistyped digit, or leave it blank.
          </p>
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
        <button type="submit" disabled={busy || isbnBad}>
          Add to bookshelf
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
          </div>
        )}
      </form>
    </article>
  );
}
