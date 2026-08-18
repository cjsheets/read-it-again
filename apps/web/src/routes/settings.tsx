import { useState } from 'react';
import { useApp, useWorkerData } from '../app-state.js';
import type { PersistenceState } from '../durability.js';
import { cameraSupported } from '../scanner.js';

/** Nag once a shelf is worth losing, not on the first book. */
const BACKUP_REMINDER_THRESHOLD = 5;

/** Backup, sources, readers, experiments, and privacy settings. */
export function Settings() {
  const {
    summary,
    busy,
    archivePassphrase,
    setArchivePassphrase,
    exportArchive,
    importArchiveFile,
    persistence,
  } = useApp();
  const history = useWorkerData({ type: 'getImportHistory' }, (response) => response.importHistory);

  return (
    <section aria-labelledby="settings-title">
      <div className="section-heading">
        <div>
          <h2 id="settings-title">Settings</h2>
        </div>
      </div>

      <article className="settings-card" aria-labelledby="backup-title">
        <h3 id="backup-title">Backup and restore</h3>
        <p>
          A backup is an encrypted file you keep yourself. Use a memorable passphrase of at least 12
          characters; it is never stored, and without it the file cannot be read.
        </p>
        <input
          aria-label="Archive passphrase"
          type="password"
          minLength={12}
          autoComplete="new-password"
          value={archivePassphrase}
          onChange={(event) => setArchivePassphrase(event.target.value)}
        />
        <div className="archive-actions">
          <button type="button" disabled={busy} onClick={() => void exportArchive()}>
            Export encrypted backup
          </button>
          <label className={busy ? 'file-button disabled' : 'file-button'}>
            <span>Import archive</span>
            <input
              data-testid="archive-file"
              type="file"
              accept="application/json,.ria-archive"
              disabled={busy}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void importArchiveFile(file);
                event.currentTarget.value = '';
              }}
            />
          </label>
        </div>
        <DurabilityNote
          persistence={persistence}
          lastBackupAt={summary.lastBackupAt}
          bookCount={summary.recordCount}
        />
      </article>

      <Readers />

      <article className="settings-card" aria-labelledby="sources-title">
        <h3 id="sources-title">Connected sources</h3>
        {!history || history.runs.length === 0 ? (
          <p>Nothing has been imported yet.</p>
        ) : (
          <>
            <p>
              <span data-testid="record-count">{history.records.length} books</span> came in across{' '}
              {history.runs.length} {history.runs.length === 1 ? 'import' : 'imports'}.
            </p>
            <ul className="runs">
              {history.runs.map((run) => (
                <li key={run.id}>
                  {run.fileName ?? 'JSON snapshot'}: {run.rowsNew} new of {run.rowsSeen}
                </li>
              ))}
            </ul>
          </>
        )}
      </article>

      <CoverLookup />

      <Experiments />

      <article className="settings-card" aria-labelledby="privacy-title">
        <h3 id="privacy-title">Privacy</h3>
        <p>
          <strong>Your library stays in this browser.</strong> Your books, readers, ratings and
          reading history are stored on this device and are never uploaded. There is no account and
          no server holding them, which also means they cannot be recovered from one if this browser
          loses them — hence the backup above.
        </p>
        <p>
          One feature can reach the network, and only if you switch it on: cover lookup sends an
          ISBN to <strong>covers.openlibrary.org</strong> to fetch a picture. That is described in
          full under <em>Cover art from the internet</em>, it is off unless you turn it on, and
          while it is running the app says so at the top of the screen.
        </p>
        <p className="model-note">
          It cannot sign in to a library or read your borrowing history directly, because library
          systems do not permit browser access. The local runtime does that work and hands the
          results over in a backup.
        </p>
      </article>
    </section>
  );
}

/**
 * The one place the app can be given permission to talk to anyone. It is a
 * separate card from Experiments on purpose: scanning is a feature that might not
 * work well yet, whereas this is a question about who learns what (ADR 0016), and
 * the two should not be answered by the same shrug.
 */
function CoverLookup() {
  const { catalogCoversEnabled, setCatalogCoversEnabled } = useApp();
  return (
    <article className="settings-card" aria-labelledby="covers-title">
      <h3 id="covers-title">Cover art from the internet</h3>
      <label className="toggle">
        <input
          type="checkbox"
          data-testid="catalog-covers-toggle"
          checked={catalogCoversEnabled}
          onChange={(event) => setCatalogCoversEnabled(event.target.checked)}
        />
        <span>Look up covers on openlibrary.org</span>
      </label>
      <p className="model-note">
        Off by default, and the only thing this app ever sends anywhere. When it is on, this device
        asks <strong>covers.openlibrary.org</strong> for one book at a time, by ISBN — so that
        service learns which books are on this shelf, and when you added them. No account, no name,
        and no reading history is sent. Covers are downloaded once and kept on this device, so a
        book is only ever asked about once. Turn it off and every request stops, including one
        already part-way through the shelf; the covers already downloaded stay.
      </p>
    </article>
  );
}

/** Opt-in features that still need field testing. */
function Experiments() {
  const { scanningEnabled, setScanningEnabled } = useApp();
  if (!cameraSupported()) return null;
  return (
    <article className="settings-card" aria-labelledby="experiments-title">
      <h3 id="experiments-title">Experiments</h3>
      <label className="toggle">
        <input
          type="checkbox"
          data-testid="scanning-toggle"
          checked={scanningEnabled}
          onChange={(event) => setScanningEnabled(event.target.checked)}
        />
        <span>Scan barcodes with the camera</span>
      </label>
      <p className="model-note">
        Adds a scan button to Add a book. It reads the ISBN off the barcode and checks it against
        the books you already have. It cannot look up a title, because this app has no catalog — you
        still type that in. The camera image never leaves this device, and typing the ISBN in works
        just as well.
      </p>
    </article>
  );
}

/** Reader labels are local and do not need to be real names. */
function Readers() {
  const { summary, busy, manageReaders } = useApp();
  const readers = useWorkerData({ type: 'listReaders' }, (response) => response.readers);
  const [name, setName] = useState('');
  const active = (readers ?? []).filter((reader) => reader.archivedAt === null);
  const archived = (readers ?? []).filter((reader) => reader.archivedAt !== null);

  return (
    <article className="settings-card" aria-labelledby="readers-title">
      <h3 id="readers-title">Readers</h3>
      <p>
        Who this bookshelf is for. A first name, a nickname or “Kid 1” — whatever you use at home.
        These names stay in this browser.
      </p>

      <ul className="reader-list" data-testid="reader-list">
        {active.map((reader) => (
          <li key={reader.id} data-testid={`reader-row-${reader.id}`}>
            <input
              aria-label={`Name for ${reader.displayName}`}
              defaultValue={reader.displayName}
              onBlur={(event) => {
                const next = event.target.value.trim();
                if (next && next !== reader.displayName)
                  void manageReaders({
                    type: 'renameReader',
                    personId: reader.id,
                    displayName: next,
                  });
              }}
            />
            <span className="model-note">
              {reader.bookCount} {reader.bookCount === 1 ? 'book' : 'books'}
            </span>
            <button
              type="button"
              disabled={busy || active.length <= 1}
              title={active.length <= 1 ? 'A household needs at least one reader.' : undefined}
              onClick={() => void manageReaders({ type: 'archiveReader', personId: reader.id })}
            >
              Archive
            </button>
          </li>
        ))}
      </ul>

      <form
        className="reader-add"
        onSubmit={(event) => {
          event.preventDefault();
          const displayName = name.trim();
          if (!displayName) return;
          void manageReaders({ type: 'createReader', displayName }).then(() => setName(''));
        }}
      >
        <input
          aria-label="New reader name"
          data-testid="new-reader-name"
          placeholder="Add a reader"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button type="submit" disabled={busy || !name.trim()}>
          Add reader
        </button>
      </form>

      {summary.readers.length === 1 && (
        <p className="model-note" data-testid="single-reader-note">
          With one reader, books are filed automatically. Add a second and the app stops guessing:
          books it filed on its own move to Tasks to be sorted, where you can file them all at once.
        </p>
      )}

      {archived.length > 0 && (
        <>
          <h4>Archived</h4>
          <p className="model-note">
            Their reading history is kept. Restoring brings them back to the switcher.
          </p>
          <ul className="reader-list" data-testid="archived-readers">
            {archived.map((reader) => (
              <li key={reader.id}>
                <span>{reader.displayName}</span>
                <span className="model-note">
                  {reader.bookCount} {reader.bookCount === 1 ? 'book' : 'books'}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void manageReaders({ type: 'restoreReader', personId: reader.id })}
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </article>
  );
}

/** Reports browser persistence and the most recent encrypted backup. */
function DurabilityNote({
  persistence,
  lastBackupAt,
  bookCount,
}: {
  readonly persistence: PersistenceState;
  readonly lastBackupAt: string | null;
  readonly bookCount: number;
}) {
  const overdue = bookCount >= BACKUP_REMINDER_THRESHOLD && lastBackupAt === null;
  return (
    <div className="durability" data-testid="durability">
      <p>
        <span className="durability-label">Storage</span>{' '}
        <span data-testid="persistence-state">
          {persistence === 'persistent'
            ? 'Protected from automatic cleanup.'
            : persistence === 'evictable'
              ? 'This browser may delete these books to reclaim space.'
              : 'This browser cannot report whether these books are protected.'}
        </span>
      </p>
      <p>
        <span className="durability-label">Last backup</span>{' '}
        <span data-testid="last-backup">
          {lastBackupAt === null ? 'Never' : new Date(lastBackupAt).toLocaleDateString()}
        </span>
      </p>
      {overdue && (
        <p className="durability-warning" data-testid="backup-reminder">
          You have {bookCount} books and no backup. Export one and keep it somewhere else.
        </p>
      )}
    </div>
  );
}
