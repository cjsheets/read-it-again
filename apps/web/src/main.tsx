import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ImportBatchResult, ImportRecord, ImportRun } from '@read-it-again/storage-schema';
import { requestWorker } from './client.js';
import './styles.css';

interface InboxState {
  readonly records: readonly ImportRecord[];
  readonly runs: readonly ImportRun[];
}

function App() {
  const [inbox, setInbox] = useState<InboxState>({ records: [], runs: [] });
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
      setInbox(response.inbox);
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
      setInbox(response.inbox);
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
