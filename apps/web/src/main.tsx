import { StrictMode, useEffect, useState } from 'react';
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
import { requestWorker } from './client.js';
import type { WorkerRequestInput } from './protocol.js';
import './styles.css';

interface InboxState {
  readonly records: readonly ImportRecord[];
  readonly runs: readonly ImportRun[];
  readonly resolutionQueue: readonly ResolutionQueueItem[];
  readonly attributionTriage: readonly AttributionTriageItem[];
  readonly readingModel: ReadingModelView;
  readonly recommendations: RecommendationView;
}

function App() {
  const [inbox, setInbox] = useState<InboxState>({
    records: [],
    runs: [],
    resolutionQueue: [],
    attributionTriage: [],
    readingModel: { checkouts: [], episodes: [], sessions: [], shelf: [] },
    recommendations: { generatedAt: null, constraints: null, discovery: [], readAgain: [] },
  });
  const [status, setStatus] = useState('Opening your private bookshelf…');
  const [error, setError] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(true);
  const [archivePassphrase, setArchivePassphrase] = useState('');

  useEffect(() => {
    void refreshInbox();
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
      });
      setStatus(
        response.inbox.records.length === 0 ? 'No books imported yet.' : 'Import inbox ready.',
      );
    } else {
      setError(response.issues ?? [response.message]);
      setStatus('Could not open the import inbox.');
    }
    setBusy(false);
  }

  async function importFile(file: File) {
    setBusy(true);
    setError([]);
    setStatus(`Checking ${file.name}…`);
    try {
      const rawText = await file.text();
      if (isEncryptedArchive(rawText)) {
        setError(['This file is an encrypted bookshelf archive, not a Libby timeline.']);
        setStatus('Use Import archive under Add or transfer books.');
        return;
      }
      const response = await requestWorker({
        type: 'importLibby',
        rawText,
        fileName: file.name,
      });
      if (!response.ok) {
        setError(response.issues ?? [response.message]);
        setStatus('Nothing was imported. Fix the file and try again.');
        return;
      }
      setInbox({
        ...response.inbox,
        resolutionQueue: response.resolutionQueue,
        attributionTriage: response.attributionTriage,
        readingModel: response.readingModel,
        recommendations: response.recommendations,
      });
      setStatus(importSummary(response.result));
    } catch (caught) {
      setError([caught instanceof Error ? caught.message : String(caught)]);
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
          </article>
        </div>
      </section>

      <p className="status" role="status" data-testid="import-status">
        {status}
      </p>
      {error.length > 0 && (
        <section className="error" role="alert">
          <strong>Libby file could not be validated</strong>
          <ul>
            {error.slice(0, 8).map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
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
      });
      setStatus('Resolution decision saved.');
    } else {
      setError(response.issues ?? [response.message]);
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
    const response = await requestWorker({
      type: 'correctAttribution',
      scope,
      importRecordId: item.importRecordId,
      workId: item.workId,
      state,
      readerIds,
    });
    if (response.ok) {
      setInbox({
        ...response.inbox,
        resolutionQueue: response.resolutionQueue,
        attributionTriage: response.attributionTriage,
        readingModel: response.readingModel,
        recommendations: response.recommendations,
      });
      setStatus('Attribution correction saved.');
    } else setError(response.issues ?? [response.message]);
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
      });
      setStatus(request.type === 'assessWork' ? 'Assessment saved.' : 'Confirmed session saved.');
    } else setError(response.issues ?? [response.message]);
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
    setError([]);
    const response = await requestWorker({ type: 'exportArchive', passphrase: archivePassphrase });
    if (response.ok && response.archiveText) {
      downloadText(
        response.archiveText,
        `read-it-again-${new Date().toISOString().slice(0, 10)}.ria-archive`,
      );
      setStatus('Encrypted archive downloaded. Keep its passphrase separately.');
    } else if (!response.ok) {
      setError(response.issues ?? [response.message]);
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
    setError([]);
    const response = await requestWorker(request);
    if (response.ok) {
      setInbox({
        ...response.inbox,
        resolutionQueue: response.resolutionQueue,
        attributionTriage: response.attributionTriage,
        readingModel: response.readingModel,
        recommendations: response.recommendations,
      });
      setStatus(request.type === 'importCsv' ? importSummary(response.result) : success);
    } else {
      setError(response.issues ?? [response.message]);
      setStatus('Nothing was changed.');
    }
    setBusy(false);
  }
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
  return (
    <section className="reading-model" aria-labelledby="shelf-title">
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
          <ul>
            {model.episodes.map((episode) => (
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
          <ul>
            {model.checkouts.map((checkout) => (
              <li key={checkout.id}>
                <strong>{checkout.title}</strong> · {checkout.readers.join(', ')}
                <br />
                <small>{new Date(checkout.occurredAt).toLocaleDateString()}</small>
              </li>
            ))}
          </ul>
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
  const [engagement, setEngagement] = useState(item.childEngagement ?? 2);
  const [tolerance, setTolerance] = useState(item.adultTolerance ?? 2);
  const [asks, setAsks] = useState(item.asksByName);
  const [veto, setVeto] = useState(item.veto);
  const [minutes, setMinutes] = useState(item.estimatedReadMinutes?.toString() ?? '');
  const [traits, setTraits] = useState<readonly ReadingTrait[]>(item.traits);
  return (
    <article className="assessment-card">
      <h3>{item.title}</h3>
      <p>
        {item.readerName} · {item.episodeCount} acquisition episode
        {item.episodeCount === 1 ? '' : 's'}
      </p>
      <div className="quick-rating">
        <RatingButtons label="Child engagement" value={engagement} onChange={setEngagement} />
        <RatingButtons label="Adult tolerance" value={tolerance} onChange={setTolerance} />
      </div>
      <div className="trait-chips">
        {TRAITS.map((trait) => (
          <button
            className={traits.includes(trait.value) ? 'selected' : ''}
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
          onClick={() =>
            void onChanged({
              type: 'assessWork',
              workId: item.workId,
              personId: item.personId,
              childEngagement: engagement,
              adultTolerance: tolerance,
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

function RatingButtons({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly onChange: (value: number) => void;
}) {
  return (
    <fieldset>
      <legend>{label}</legend>
      {[0, 1, 2, 3].map((score) => (
        <button
          aria-pressed={score === value}
          type="button"
          key={score}
          onClick={() => onChange(score)}
        >
          {score}
        </button>
      ))}
    </fieldset>
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
