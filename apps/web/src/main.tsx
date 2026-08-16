import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  ImportBatchResult,
  ImportRecord,
  ImportRun,
  AttributionTriageItem,
  ReadingModelView,
  ReadingTrait,
  RecommendationView,
  ResolutionQueueItem,
} from '@read-it-again/storage-schema';
import { isLibrarySource } from '@read-it-again/storage-schema';
import { requestWorker } from './client.js';
import {
  clearWipeMarker,
  looksWiped,
  readPersistence,
  rememberBooksExist,
  requestPersistenceOnce,
  type PersistenceState,
} from './durability.js';
import type { WorkerRequestInput } from './protocol.js';
import './styles.css';

/** F-06: one hardcoded headline told users their Libby file was invalid when they
 *  had merely mistyped a backup passphrase. Errors now name the artefact they are
 *  actually about, and most carry a specific next action. */
type ErrorOperation =
  | 'libby'
  | 'wrongSlot'
  | 'csv'
  | 'manual'
  | 'archiveExport'
  | 'archiveImport'
  | 'inbox'
  | 'decision';

const ERROR_TITLES: Readonly<Record<ErrorOperation, string>> = {
  libby: 'That Libby file could not be read',
  wrongSlot: 'That is a backup, not a Libby file',
  csv: 'That CSV file could not be read',
  manual: 'That book could not be added',
  archiveExport: 'That backup could not be created',
  archiveImport: 'That backup could not be restored',
  inbox: 'Your bookshelf could not be opened',
  decision: 'That change could not be saved',
};

const ERROR_ACTIONS: Readonly<Partial<Record<ErrorOperation, string>>> = {
  libby: 'In Libby, choose Timeline → Export Timeline → Data (JSON), then try that file.',
  wrongSlot: 'Use Import archive under “Add or transfer books”, with its passphrase.',
  csv: 'The first row must name the columns, and one of them must be a title.',
  archiveExport: 'Choose a passphrase of at least 12 characters, then export again.',
  archiveImport:
    'Enter the passphrase you chose when you exported this backup, then pick the file again.',
  inbox: 'Reload the page. If it keeps happening, this browser may be blocking local storage.',
};

const BROWSER_OPERATION_ERRORS = {
  importCsv: 'csv',
  importManual: 'manual',
  importArchive: 'archiveImport',
} as const satisfies Readonly<Record<string, ErrorOperation>>;

interface ErrorState {
  readonly operation: ErrorOperation;
  readonly issues: readonly string[];
}

interface InboxState {
  readonly records: readonly ImportRecord[];
  readonly runs: readonly ImportRun[];
  readonly resolutionQueue: readonly ResolutionQueueItem[];
  readonly attributionTriage: readonly AttributionTriageItem[];
  readonly readingModel: ReadingModelView;
  readonly recommendations: RecommendationView;
  readonly lastBackupAt: string | null;
}

/** Nag once a shelf is worth losing, not on the first book. */
const BACKUP_REMINDER_THRESHOLD = 5;

function App() {
  const [inbox, setInbox] = useState<InboxState>({
    records: [],
    runs: [],
    resolutionQueue: [],
    attributionTriage: [],
    readingModel: { checkouts: [], episodes: [], sessions: [], shelf: [] },
    recommendations: { generatedAt: null, constraints: null, discovery: [], readAgain: [] },
    lastBackupAt: null,
  });
  const [persistence, setPersistence] = useState<PersistenceState>('unsupported');
  const [wiped, setWiped] = useState(false);
  const [status, setStatus] = useState('Opening your private bookshelf…');
  const [error, setError] = useState<ErrorState | null>(null);
  const [busy, setBusy] = useState(true);
  const [archivePassphrase, setArchivePassphrase] = useState('');

  useEffect(() => {
    void refreshInbox();
    void readPersistence().then(setPersistence);
  }, []);

  async function refreshInbox() {
    setBusy(true);
    const response = await requestWorker({ type: 'getInbox' });
    if (response.ok) {
      setInbox({
        ...response.inbox,
        resolutionQueue: response.resolutionQueue,
        attributionTriage: response.attributionTriage,
        readingModel: response.readingModel,
        recommendations: response.recommendations,
        lastBackupAt: response.lastBackupAt,
      });
      const count = response.inbox.records.length;
      setWiped(looksWiped(count));
      rememberBooksExist(count);
      setStatus(count === 0 ? 'No books imported yet.' : 'Import inbox ready.');
    } else {
      setError({ operation: 'inbox', issues: response.issues ?? [response.message] });
      setStatus('Could not open the import inbox.');
    }
    setBusy(false);
  }

  async function importFile(file: File) {
    setBusy(true);
    setError(null);
    setStatus(`Checking ${file.name}…`);
    try {
      const rawText = await file.text();
      if (isEncryptedArchive(rawText)) {
        setError({
          operation: 'wrongSlot',
          issues: ['This file is an encrypted bookshelf archive, not a Libby timeline.'],
        });
        setStatus('Use Import archive under Add or transfer books.');
        return;
      }
      const response = await requestWorker({
        type: 'importLibby',
        rawText,
        fileName: file.name,
      });
      if (!response.ok) {
        setError({ operation: 'libby', issues: response.issues ?? [response.message] });
        setStatus('Nothing was imported. Fix the file and try again.');
        return;
      }
      setInbox({
        ...response.inbox,
        resolutionQueue: response.resolutionQueue,
        attributionTriage: response.attributionTriage,
        readingModel: response.readingModel,
        recommendations: response.recommendations,
        lastBackupAt: response.lastBackupAt,
      });
      setStatus(importSummary(response.result));
    } catch (caught) {
      setError({
        operation: 'libby',
        issues: [caught instanceof Error ? caught.message : String(caught)],
      });
      setStatus('Nothing was imported.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <header>
        <p className="eyebrow">Private family reading history</p>
        <h1>Read It Again</h1>
        <p className="lede">Import a Libby timeline snapshot. It stays in this browser.</p>
      </header>

      <aside className="capability-note">
        <strong>Client-only and private by construction.</strong> This installed app works offline
        and stores data in this browser. It cannot sign in to BiblioCommons or automatically query
        KCLS while KCLS blocks browser access; use manual resolution or import an encrypted archive
        created by the local runtime.
      </aside>

      {wiped && (
        <section className="wipe-notice" role="alert" data-testid="wipe-notice">
          <strong>Your books are gone from this browser.</strong>
          <p>
            This device had a bookshelf and its storage is now empty. That usually means the browser
            cleared site data, or reclaimed space because storage was not marked as persistent.
            Nothing was sent anywhere, so nothing can be recovered from a server — but an encrypted
            backup will restore everything.
          </p>
          <p>
            Enter your passphrase under <strong>Encrypted archive</strong> below and choose{' '}
            <strong>Import archive</strong>.
          </p>
          <button
            type="button"
            onClick={() => {
              clearWipeMarker();
              setWiped(false);
            }}
          >
            Start over instead
          </button>
        </section>
      )}

      <section className="import-panel" aria-labelledby="import-title">
        <div>
          <h2 id="import-title">Libby timeline</h2>
          <p>Choose the Data (JSON) file from Libby’s Export Timeline flow.</p>
        </div>
        <label className={busy ? 'file-button disabled' : 'file-button'}>
          <span>{busy ? 'Working…' : 'Choose JSON file'}</span>
          <input
            data-testid="libby-file"
            type="file"
            accept="application/json,.json"
            disabled={busy}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void importFile(file);
              event.currentTarget.value = '';
            }}
          />
        </label>
      </section>

      <section className="browser-tools" aria-labelledby="browser-tools-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Offline inputs</p>
            <h2 id="browser-tools-title">Add or transfer books</h2>
          </div>
        </div>
        <div className="tool-grid">
          <article>
            <h3>Generic CSV</h3>
            <p>Recognizes title, author, ISBN, date, and format columns.</p>
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
          <ManualBookForm busy={busy} onSubmit={importManual} />
          <article>
            <h3>Encrypted archive</h3>
            <p>Use a memorable passphrase of at least 12 characters. It is never stored.</p>
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
              lastBackupAt={inbox.lastBackupAt}
              bookCount={inbox.records.length}
            />
          </article>
        </div>
      </section>

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

      <section aria-labelledby="inbox-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Unresolved</p>
            <h2 id="inbox-title">Import inbox</h2>
          </div>
          <span className="count" data-testid="record-count">
            {inbox.records.length} books
          </span>
        </div>
        {inbox.records.length === 0 ? (
          <div className="empty">Your imported books will wait here for record resolution.</div>
        ) : (
          <ol className="books">
            {inbox.records.map((record) => (
              <BookRow key={record.id} record={record} />
            ))}
          </ol>
        )}
      </section>

      {inbox.resolutionQueue.length > 0 && (
        <section className="resolution" aria-labelledby="resolution-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Needs a decision</p>
              <h2 id="resolution-title">Resolution queue</h2>
            </div>
            <span className="count" data-testid="resolution-count">
              {inbox.resolutionQueue.length} pending
            </span>
          </div>
          <ol className="resolution-list">
            {inbox.resolutionQueue.map((item) => (
              <ResolutionCard key={item.caseId} item={item} onChanged={applyDecision} />
            ))}
          </ol>
        </section>
      )}

      {inbox.attributionTriage.length > 0 && (
        <section className="resolution" aria-labelledby="attribution-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Who was this for?</p>
              <h2 id="attribution-title">Attribution review</h2>
            </div>
            <span className="count" data-testid="attribution-count">
              {inbox.attributionTriage.length} pending
            </span>
          </div>
          <ol className="resolution-list">
            {inbox.attributionTriage.map((item) => (
              <AttributionCard key={item.importRecordId} item={item} onChanged={applyAttribution} />
            ))}
          </ol>
        </section>
      )}

      {inbox.readingModel.shelf.length > 0 && (
        <ReadingDashboard model={inbox.readingModel} onChanged={applyReadingChange} />
      )}

      {(inbox.recommendations.discovery.length > 0 ||
        inbox.recommendations.readAgain.length > 0) && (
        <RecommendationDashboard recommendations={inbox.recommendations} />
      )}

      {inbox.runs.length > 0 && (
        <details>
          <summary>Import history ({inbox.runs.length})</summary>
          <ul className="runs">
            {inbox.runs.map((run) => (
              <li key={run.id}>
                {run.fileName ?? 'JSON snapshot'}: {run.rowsNew} new of {run.rowsSeen}
              </li>
            ))}
          </ul>
        </details>
      )}
    </main>
  );

  async function applyDecision(
    request:
      | { readonly type: 'acceptCandidate'; readonly caseId: string; readonly candidateId: string }
      | {
          readonly type: 'manualResolve';
          readonly caseId: string;
          readonly title: string;
          readonly authorsJson: string;
        }
      | { readonly type: 'rejectCase'; readonly caseId: string }
      | { readonly type: 'deferCase'; readonly caseId: string },
  ) {
    setBusy(true);
    const response = await requestWorker(request);
    if (response.ok) {
      setInbox({
        ...response.inbox,
        resolutionQueue: response.resolutionQueue,
        attributionTriage: response.attributionTriage,
        readingModel: response.readingModel,
        recommendations: response.recommendations,
        lastBackupAt: response.lastBackupAt,
      });
      setStatus('Resolution decision saved.');
    } else {
      setError({ operation: 'decision', issues: response.issues ?? [response.message] });
    }
    setBusy(false);
  }

  async function applyAttribution(
    item: AttributionTriageItem,
    scope: 'checkout' | 'work',
    state: 'assigned' | 'excluded',
    readerIds: readonly string[],
  ) {
    setBusy(true);
    const response = await requestWorker(
      scope === 'checkout'
        ? {
            type: 'correctAttribution',
            scope,
            importRecordId: item.importRecordId,
            state,
            readerIds,
          }
        : { type: 'correctAttribution', scope, workId: item.workId, state, readerIds },
    );
    if (response.ok) {
      setInbox({
        ...response.inbox,
        resolutionQueue: response.resolutionQueue,
        attributionTriage: response.attributionTriage,
        readingModel: response.readingModel,
        recommendations: response.recommendations,
        lastBackupAt: response.lastBackupAt,
      });
      setStatus('Attribution correction saved.');
    } else setError({ operation: 'decision', issues: response.issues ?? [response.message] });
    setBusy(false);
  }

  async function applyReadingChange(
    request: Extract<WorkerRequestInput, { type: 'assessWork' | 'recordReadingSession' }>,
  ) {
    setBusy(true);
    const response = await requestWorker(request);
    if (response.ok) {
      setInbox({
        ...response.inbox,
        resolutionQueue: response.resolutionQueue,
        attributionTriage: response.attributionTriage,
        readingModel: response.readingModel,
        recommendations: response.recommendations,
        lastBackupAt: response.lastBackupAt,
      });
      setStatus(request.type === 'assessWork' ? 'Assessment saved.' : 'Confirmed session saved.');
    } else setError({ operation: 'decision', issues: response.issues ?? [response.message] });
    setBusy(false);
  }

  async function importCsvFile(file: File) {
    await applyBrowserOperation(
      { type: 'importCsv', rawText: await file.text(), fileName: file.name },
      'CSV import complete.',
    );
  }

  async function importManual(input: { title: string; author?: string; isbn?: string }) {
    await applyBrowserOperation({ type: 'importManual', ...input, format: 'book' }, 'Book added.');
  }

  async function exportArchive() {
    setBusy(true);
    setError(null);
    const response = await requestWorker({ type: 'exportArchive', passphrase: archivePassphrase });
    if (response.ok && response.archiveText) {
      // The export is what sets last_backup_at, so take the fresh value rather
      // than making the user reload to see that the backup registered.
      setInbox((current) => ({ ...current, lastBackupAt: response.lastBackupAt }));
      downloadText(
        response.archiveText,
        `read-it-again-${new Date().toISOString().slice(0, 10)}.ria-archive`,
      );
      setStatus('Encrypted archive downloaded. Keep its passphrase separately.');
    } else if (!response.ok) {
      setError({ operation: 'archiveExport', issues: response.issues ?? [response.message] });
      setStatus('Archive export failed.');
    }
    setBusy(false);
  }

  async function importArchiveFile(file: File) {
    await applyBrowserOperation(
      { type: 'importArchive', encryptedText: await file.text(), passphrase: archivePassphrase },
      'Encrypted archive restored.',
    );
  }

  async function applyBrowserOperation(
    request: Extract<WorkerRequestInput, { type: 'importCsv' | 'importManual' | 'importArchive' }>,
    success: string,
  ) {
    setBusy(true);
    setError(null);
    const response = await requestWorker(request);
    if (response.ok) {
      setInbox({
        ...response.inbox,
        resolutionQueue: response.resolutionQueue,
        attributionTriage: response.attributionTriage,
        readingModel: response.readingModel,
        recommendations: response.recommendations,
        lastBackupAt: response.lastBackupAt,
      });
      if (response.inbox.records.length > 0) {
        // Books exist again, so any earlier loss has been made good.
        setWiped(false);
        clearWipeMarker();
        rememberBooksExist(response.inbox.records.length);
        // Asked here rather than on load: a real add is the user gesture that
        // makes a browser most likely to grant persistent storage.
        setPersistence(await requestPersistenceOnce());
      }
      setStatus(request.type === 'importCsv' ? importSummary(response.result) : success);
    } else {
      setError({
        operation: BROWSER_OPERATION_ERRORS[request.type],
        issues: response.issues ?? [response.message],
      });
      setStatus('Nothing was changed.');
    }
    setBusy(false);
  }
}

/**
 * F-05. ADR 0011 warns that browser storage disappears when a profile is cleared,
 * and the UI said nothing. This states where the data stands in plain language:
 * whether the browser has agreed not to evict it, and when it was last backed up.
 */
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

function isEncryptedArchive(rawText: string): boolean {
  try {
    const value = JSON.parse(rawText) as unknown;
    return (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (value as { readonly format?: unknown }).format === 'read-it-again-encrypted-v1'
    );
  } catch {
    return false;
  }
}

function ManualBookForm({
  busy,
  onSubmit,
}: {
  readonly busy: boolean;
  readonly onSubmit: (input: { title: string; author?: string; isbn?: string }) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [isbn, setIsbn] = useState('');
  const titleField = useRef<HTMLInputElement>(null);

  // The manifest's "Add a book" shortcut opens /?action=add. Honour it, so the
  // shortcut lands on the form rather than merely opening the app.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('action') !== 'add') return;
    titleField.current?.scrollIntoView({ block: 'center' });
    titleField.current?.focus();
  }, []);

  return (
    <article>
      <h3>Manual or ISBN</h3>
      <form
        className="manual-form"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit({ title, author: author || undefined, isbn: isbn || undefined }).then(
            () => {
              setTitle('');
              setAuthor('');
              setIsbn('');
            },
          );
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
          value={isbn}
          onChange={(event) => setIsbn(event.target.value)}
        />
        <button type="submit" disabled={busy}>
          Add to bookshelf
        </button>
      </form>
    </article>
  );
}

function downloadText(value: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([value], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/** ADR 0009 separates a library checkout from a book you simply added. These are
 *  the plain-language names for that distinction (F-13). */
const SOURCE_LABELS: Readonly<Record<string, string>> = {
  manual: 'Added by you',
  csv: 'Imported from a CSV file',
  libby: 'From your library history',
  bibliocommons: 'From your library history',
};

function provenanceLabel(sourceKinds: readonly string[]): string {
  const labels = [...new Set(sourceKinds.map((kind) => SOURCE_LABELS[kind] ?? 'Imported'))];
  return labels.length === 0 ? 'On your shelf' : labels.join(' · ');
}

const TRAITS: readonly { readonly value: ReadingTrait; readonly label: string }[] = [
  { value: 'rhyme_meter', label: 'Rhyme & meter' },
  { value: 'refrain_repetition', label: 'Refrain' },
  { value: 'interactive', label: 'Interactive' },
  { value: 'quiet_arc', label: 'Quiet arc' },
  { value: 'humor', label: 'Humor' },
  { value: 'vocabulary_stretch', label: 'Vocabulary' },
  { value: 'illustration_led', label: 'Illustration-led' },
];

function RecommendationDashboard({
  recommendations,
}: {
  readonly recommendations: RecommendationView;
}) {
  return (
    <section className="recommendations" aria-labelledby="recommendations-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">KCLS hold list</p>
          <h2 id="recommendations-title">What to bring home next</h2>
        </div>
        {recommendations.generatedAt && (
          <span className="count">
            Checked {new Date(recommendations.generatedAt).toLocaleDateString()}
          </span>
        )}
      </div>
      <p className="model-note">
        Deterministic suggestions from your household’s history. Availability is a cached KCLS
        observation, not a reservation.
      </p>
      <div className="recommendation-columns">
        <div>
          <h3>Discover something new</h3>
          <p className="model-note">Works already on the bookshelf are excluded.</p>
          <RecommendationList items={recommendations.discovery} />
        </div>
        <div>
          <h3>Read it again</h3>
          <p className="model-note">Known favorites, kept separate from discovery.</p>
          <RecommendationList items={recommendations.readAgain} />
        </div>
      </div>
    </section>
  );
}

function RecommendationList({ items }: { readonly items: RecommendationView['discovery'] }) {
  if (items.length === 0) return <p>No recommendations in this group.</p>;
  return (
    <ol className="recommendation-list">
      {items.map((item) => (
        <li key={item.catalogKey} className="recommendation-card">
          <div className="recommendation-title">
            <div>
              <h4>{item.title}</h4>
              <p>{item.authors.join(', ') || 'Unknown author'}</p>
            </div>
            <span className={item.holdings.systemAvailable > 0 ? 'available' : 'unavailable'}>
              {item.holdings.systemAvailable} of {item.holdings.systemTotal} available
            </span>
          </div>
          <ul className="recommendation-evidence">
            {item.evidence.map((evidence) => (
              <li key={evidence}>{evidence}</li>
            ))}
          </ul>
          <p className="recommendation-meta">
            {item.estimatedReadMinutes ? `~${item.estimatedReadMinutes} min · ` : ''}
            KCLS record {item.catalogKey}
          </p>
        </li>
      ))}
    </ol>
  );
}

function ReadingDashboard({
  model,
  onChanged,
}: {
  readonly model: ReadingModelView;
  readonly onChanged: (
    request: Extract<WorkerRequestInput, { type: 'assessWork' | 'recordReadingSession' }>,
  ) => Promise<void>;
}) {
  // Only library-sourced records are checkout observations, and an acquisition
  // episode is only an acquisition if a real checkout produced it (F-13).
  const libraryCheckouts = model.checkouts.filter((checkout) =>
    isLibrarySource(checkout.sourceKind),
  );
  const libraryWorkIds = new Set(libraryCheckouts.map((checkout) => checkout.workId));
  const acquisitionEpisodes = model.episodes.filter((episode) =>
    libraryWorkIds.has(episode.workId),
  );
  return (
    <section className="reading-model" aria-labelledby="shelf-title" data-testid="shelf">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Preference model</p>
          <h2 id="shelf-title">Family bookshelf</h2>
        </div>
      </div>
      <div className="shelf-grid">
        {model.shelf.map((item) => (
          <AssessmentCard
            key={`${item.workId}:${item.personId}`}
            item={item}
            onChanged={onChanged}
          />
        ))}
      </div>
      <div className="reading-columns">
        <div>
          <h3>Acquisition episodes</h3>
          <p className="model-note">Derived from checkout proximity; not confirmed readings.</p>
          {acquisitionEpisodes.length === 0 ? (
            <p>No borrowing history yet.</p>
          ) : (
            <ul>
              {acquisitionEpisodes.map((episode) => (
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
          <h3>Confirmed reading sessions</h3>
          <p className="model-note">Only sessions a household member explicitly records.</p>
          {model.sessions.length === 0 ? (
            <p>No confirmed sessions yet.</p>
          ) : (
            <ul>
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
          <h3>Checkout observations</h3>
          <p className="model-note">Imported library facts; a checkout does not prove reading.</p>
          {libraryCheckouts.length === 0 ? (
            <p>Nothing borrowed from a library yet.</p>
          ) : (
            <ul>
              {libraryCheckouts.map((checkout) => (
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

function AssessmentCard({
  item,
  onChanged,
}: {
  readonly item: ReadingModelView['shelf'][number];
  readonly onChanged: (
    request: Extract<WorkerRequestInput, { type: 'assessWork' | 'recordReadingSession' }>,
  ) => Promise<void>;
}) {
  const [engagement, setEngagement] = useState<number | null>(item.childEngagement);
  const [tolerance, setTolerance] = useState<number | null>(item.adultTolerance);
  const [asks, setAsks] = useState(item.asksByName);
  const [veto, setVeto] = useState(item.veto);
  const [minutes, setMinutes] = useState(item.estimatedReadMinutes?.toString() ?? '');
  const [traits, setTraits] = useState<readonly ReadingTrait[]>(item.traits);
  const unrated = item.childEngagement === null && item.adultTolerance === null;
  const changed =
    engagement !== item.childEngagement ||
    tolerance !== item.adultTolerance ||
    asks !== item.asksByName ||
    veto !== item.veto ||
    minutes !== (item.estimatedReadMinutes?.toString() ?? '') ||
    traits.length !== item.traits.length ||
    traits.some((trait) => !item.traits.includes(trait));
  return (
    <article className="assessment-card" data-testid="shelf-card">
      <h3>{item.title}</h3>
      <p>
        {item.readerName} · {provenanceLabel(item.sourceKinds)}
      </p>
      <div className="quick-rating">
        <RatingButtons label="Child engagement" value={engagement} onChange={setEngagement} />
        <RatingButtons label="Adult tolerance" value={tolerance} onChange={setTolerance} />
      </div>
      {unrated && (
        <p className="rating-unset" data-testid="rating-unset">
          Not rated yet.
        </p>
      )}
      <div className="trait-chips">
        {TRAITS.map((trait) => (
          <button
            aria-pressed={traits.includes(trait.value)}
            type="button"
            key={trait.value}
            onClick={() =>
              setTraits(
                traits.includes(trait.value)
                  ? traits.filter((value) => value !== trait.value)
                  : [...traits, trait.value],
              )
            }
          >
            {trait.label}
          </button>
        ))}
      </div>
      <div className="assessment-options">
        <label>
          <input
            type="checkbox"
            checked={asks}
            onChange={(event) => setAsks(event.target.checked)}
          />{' '}
          Asked by name
        </label>
        <label>
          <input
            type="checkbox"
            checked={veto}
            onChange={(event) => setVeto(event.target.checked)}
          />{' '}
          Veto
        </label>
        <label>
          Minutes{' '}
          <input
            aria-label="Estimated read minutes"
            type="number"
            min="1"
            max="180"
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
          />
        </label>
      </div>
      <div className="decision-actions">
        <button
          type="button"
          disabled={!changed}
          onClick={() =>
            void onChanged({
              type: 'assessWork',
              workId: item.workId,
              personId: item.personId,
              childEngagement: engagement ?? undefined,
              adultTolerance: tolerance ?? undefined,
              asksByName: asks,
              veto,
              estimatedReadMinutes: minutes ? Number(minutes) : undefined,
              traits,
            })
          }
        >
          Save assessment
        </button>
        <button
          type="button"
          onClick={() =>
            void onChanged({
              type: 'recordReadingSession',
              householdId: item.householdId,
              workId: item.workId,
              participantIds: [item.personId],
              durationMinutes: minutes ? Number(minutes) : undefined,
              context: 'bedtime',
            })
          }
        >
          Read tonight
        </button>
      </div>
    </article>
  );
}

const RATING_MEANINGS = ['no', 'a little', 'a lot', 'loved it'] as const;

function RatingButtons({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: number | null;
  readonly onChange: (value: number) => void;
}) {
  // role="group" rather than fieldset/legend: a <legend> cannot be laid out
  // reliably, and the float hack it forced was the 320px overflow (F-10).
  return (
    <div className="rating-row" role="group" aria-label={label}>
      <span className="rating-label">{label}</span>
      <div className="rating-buttons">
        {[0, 1, 2, 3].map((score) => (
          <button
            aria-label={`${label}: ${score} of 3 — ${RATING_MEANINGS[score]}`}
            aria-pressed={score === value}
            type="button"
            key={score}
            onClick={() => onChange(score)}
          >
            {score}
          </button>
        ))}
      </div>
    </div>
  );
}

function AttributionCard({
  item,
  onChanged,
}: {
  readonly item: AttributionTriageItem;
  readonly onChanged: (
    item: AttributionTriageItem,
    scope: 'checkout' | 'work',
    state: 'assigned' | 'excluded',
    readerIds: readonly string[],
  ) => Promise<void>;
}) {
  return (
    <li className="resolution-card">
      <div>
        <h3>{item.title}</h3>
        <p>{item.explanation}</p>
        <small>
          {item.sourceLabel} · {new Date(item.occurredAt).toLocaleDateString()}
        </small>
      </div>
      {item.evidence.length > 0 && (
        <ul>
          {item.evidence.map((evidence) => (
            <li key={evidence.explanation}>{evidence.explanation}</li>
          ))}
        </ul>
      )}
      <div className="decision-actions">
        {item.readers.map((reader) => (
          <button
            key={reader.id}
            type="button"
            onClick={() => void onChanged(item, 'checkout', 'assigned', [reader.id])}
          >
            For {reader.displayName}
          </button>
        ))}
        {item.readers.length > 1 && (
          <button
            type="button"
            onClick={() =>
              void onChanged(
                item,
                'checkout',
                'assigned',
                item.readers.map(({ id }) => id),
              )
            }
          >
            For all children
          </button>
        )}
        {item.readers.map((reader) => (
          <button
            key={`work-${reader.id}`}
            type="button"
            onClick={() => void onChanged(item, 'work', 'assigned', [reader.id])}
          >
            Always for {reader.displayName}
          </button>
        ))}
        <button type="button" onClick={() => void onChanged(item, 'checkout', 'excluded', [])}>
          Not for a child
        </button>
      </div>
    </li>
  );
}

function BookRow({ record }: { readonly record: ImportRecord }) {
  const authors = JSON.parse(record.authorsJson) as { readonly display: string }[];
  return (
    <li className="book">
      <div className="format" aria-hidden="true">
        {record.sourceFormat === 'audiobook' ? '♪' : 'Aa'}
      </div>
      <div>
        <h3>{record.title}</h3>
        <p>{authors.map(({ display }) => display).join(', ')}</p>
      </div>
      <div className="meta">
        <span>{record.sourceFormat}</span>
        <time dateTime={record.occurredAt}>{new Date(record.occurredAt).toLocaleDateString()}</time>
      </div>
    </li>
  );
}

function ResolutionCard({
  item,
  onChanged,
}: {
  readonly item: ResolutionQueueItem;
  readonly onChanged: (
    request:
      | { readonly type: 'acceptCandidate'; readonly caseId: string; readonly candidateId: string }
      | {
          readonly type: 'manualResolve';
          readonly caseId: string;
          readonly title: string;
          readonly authorsJson: string;
        }
      | { readonly type: 'rejectCase'; readonly caseId: string }
      | { readonly type: 'deferCase'; readonly caseId: string },
  ) => Promise<void>;
}) {
  return (
    <li className="resolution-card">
      <div>
        <h3>{item.title}</h3>
        <p>{authorText(item.authorsJson)}</p>
      </div>
      {item.candidates.length > 0 && (
        <div className="candidates">
          {item.candidates.map((candidate) => {
            const snapshot = JSON.parse(candidate.snapshotJson) as {
              title: string;
              authorDisplays: string[];
            };
            return (
              <button
                key={candidate.id}
                type="button"
                onClick={() =>
                  void onChanged({
                    type: 'acceptCandidate',
                    caseId: item.caseId,
                    candidateId: candidate.id,
                  })
                }
              >
                <strong>{snapshot.title}</strong>
                <span>{snapshot.authorDisplays.join(', ') || 'Unknown author'}</span>
                <small>{Math.round(candidate.totalScore * 100)}% match</small>
              </button>
            );
          })}
        </div>
      )}
      <div className="decision-actions">
        <button
          type="button"
          onClick={() =>
            void onChanged({
              type: 'manualResolve',
              caseId: item.caseId,
              title: item.title,
              authorsJson: item.authorsJson,
            })
          }
        >
          Use source details
        </button>
        <button
          type="button"
          onClick={() => void onChanged({ type: 'deferCase', caseId: item.caseId })}
        >
          Defer
        </button>
        <button
          type="button"
          onClick={() => void onChanged({ type: 'rejectCase', caseId: item.caseId })}
        >
          Not a book
        </button>
      </div>
    </li>
  );
}

function authorText(authorsJson: string): string {
  const authors = JSON.parse(authorsJson) as { readonly display: string }[];
  return authors.map(({ display }) => display).join(', ');
}

function importSummary(result: ImportBatchResult | undefined): string {
  if (!result) return 'Import complete.';
  if (result.rowsNew === 0) return `Already up to date — ${result.rowsSeen} rows checked, 0 new.`;
  return `Imported ${result.rowsNew} new of ${result.rowsSeen} rows.`;
}

const root = document.querySelector('#root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator) {
  window.addEventListener(
    'load',
    () => void navigator.serviceWorker.register('/service-worker.js'),
  );
}
