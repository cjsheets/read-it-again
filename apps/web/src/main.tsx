import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  ImportBatchResult,
  ImportRecord,
  ImportRun,
  AttributionTriageItem,
  ReadingModelView,
  ReadingTrait,
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
}

function App() {
  const [inbox, setInbox] = useState<InboxState>({
    records: [],
    runs: [],
    resolutionQueue: [],
    attributionTriage: [],
    readingModel: { checkouts: [], episodes: [], sessions: [], shelf: [] },
  });
  const [status, setStatus] = useState('Opening your private bookshelf…');
  const [error, setError] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(true);

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
      const response = await requestWorker({
        type: 'importLibby',
        rawText: await file.text(),
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
      });
      setStatus(request.type === 'assessWork' ? 'Assessment saved.' : 'Confirmed session saved.');
    } else setError(response.issues ?? [response.message]);
    setBusy(false);
  }
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
              householdId: 'default-household',
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
