import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AttributionTriageItem, IsbnMatch } from '@read-it-again/storage-schema';
import { AppProvider, EMPTY_SUMMARY, type AppState, type ErrorState } from './app-state.js';
import { onWorkerEvent, requestWorker } from './client.js';
import { ErrorBoundary } from './components/error-boundary.js';
import { Shell } from './components/shell.js';
import {
  clearWipeMarker,
  looksWiped,
  readCatalogCoversEnabled,
  readPersistence,
  readScanningEnabled,
  readStoredReaderFilter,
  rememberBooksExist,
  requestPersistenceOnce,
  storeCatalogCoversEnabled,
  storeReaderFilter,
  storeScanningEnabled,
  type PersistenceState,
} from './durability.js';
import type { Summary, WorkerRequestInput, WorkerResponse } from './protocol.js';
import { useRoute } from './router.js';
import { Activity } from './routes/activity.js';
import { Add } from './routes/add.js';
import { Discover } from './routes/discover.js';
import { Settings } from './routes/settings.js';
import { Shelf } from './routes/shelf.js';
import { Tasks } from './routes/tasks.js';
import './styles.css';

const READER_STATUS = {
  createReader: 'Reader added.',
  renameReader: 'Reader renamed.',
  archiveReader: 'Reader archived. Their history is kept.',
  restoreReader: 'Reader restored.',
} as const;

const BROWSER_OPERATION_ERRORS = {
  importCsv: 'csv',
  importManual: 'manual',
  importArchive: 'archiveImport',
} as const;

function App() {
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState('Opening your private bookshelf…');
  const [error, setError] = useState<ErrorState | null>(null);
  const [busy, setBusy] = useState(true);
  const [persistence, setPersistence] = useState<PersistenceState>('unsupported');
  const [wiped, setWiped] = useState(false);
  const [archivePassphrase, setArchivePassphrase] = useState('');
  const [readerFilter, setReaderFilterState] = useState<string | null>(() =>
    readStoredReaderFilter(),
  );
  const [shelfQuery, setShelfQuery] = useState('');
  const [scanningEnabled, setScanningEnabledState] = useState(() => readScanningEnabled());
  const [catalogCoversEnabled, setCatalogCoversEnabledState] = useState(() =>
    readCatalogCoversEnabled(),
  );
  const [catalogFetchActive, setCatalogFetchActive] = useState(false);
  const [route, go] = useRoute();

  useEffect(() => {
    void refreshBookshelf();
    void readPersistence().then(setPersistence);
    // The worker fetches nothing until it is told it may, so tell it what this
    // device decided. Sent unconditionally, including `false`, so the answer is
    // always explicit rather than inferred from silence.
    void requestWorker({ type: 'setCatalogCovers', enabled: readCatalogCoversEnabled() });
    return onWorkerEvent((event) => {
      if (event.type === 'catalogCoverStored') setRevision((current) => current + 1);
      if (event.type === 'catalogFetchActive') setCatalogFetchActive(event.active);
    });
  }, []);

  const state: AppState = {
    summary,
    revision,
    status,
    error,
    busy,
    persistence,
    wiped,
    archivePassphrase,
    setArchivePassphrase,
    readerFilter,
    setReaderFilter: (next: string | null) => {
      storeReaderFilter(next);
      setReaderFilterState(next);
    },
    shelfQuery,
    setShelfQuery,
    scanningEnabled,
    setScanningEnabled: (enabled: boolean) => {
      storeScanningEnabled(enabled);
      setScanningEnabledState(enabled);
    },
    catalogCoversEnabled,
    setCatalogCoversEnabled: (enabled: boolean) => {
      storeCatalogCoversEnabled(enabled);
      setCatalogCoversEnabledState(enabled);
      if (!enabled) setCatalogFetchActive(false);
      void requestWorker({ type: 'setCatalogCovers', enabled });
    },
    catalogFetchActive,
    lookupIsbn,
    dismissWipeNotice: () => {
      clearWipeMarker();
      setWiped(false);
    },
    refresh: refreshBookshelf,
    importLibbyFile,
    importCsvFile,
    importArchiveFile,
    addBook,
    exportArchive,
    applyDecision,
    applyAttribution,
    applyReadingChange,
    reviseSession,
    assignReaders,
    reassignWork,
    manageReaders,
  };

  return (
    <AppProvider value={state}>
      <Shell route={route} go={go}>
        {route === 'shelf' && <Shelf go={go} />}
        {route === 'add' && <Add go={go} />}
        {route === 'activity' && <Activity />}
        {route === 'discover' && <Discover go={go} />}
        {route === 'tasks' && <Tasks />}
        {route === 'settings' && <Settings />}
      </Shell>
    </AppProvider>
  );

  /** Adopts the summary every response carries, and tells destinations to re-read
   *  when the change could have altered what they render. */
  function adopt(response: Extract<WorkerResponse, { ok: true }>, mutated = true): void {
    setSummary(response.summary);
    if (mutated) setRevision((current) => current + 1);
  }

  async function refreshBookshelf() {
    setBusy(true);
    const response = await requestWorker({ type: 'getSummary' });
    if (response.ok) {
      adopt(response);
      const count = response.summary.recordCount;
      setWiped(looksWiped(count));
      rememberBooksExist(count);
      setStatus(count === 0 ? 'No books imported yet.' : 'Bookshelf ready.');
    } else {
      setError({ operation: 'inbox', issues: response.issues ?? [response.message] });
      setStatus('Could not open your bookshelf.');
    }
    setBusy(false);
  }

  async function importLibbyFile(file: File) {
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
        setStatus('Use Import archive under Settings.');
        return;
      }
      const response = await requestWorker({ type: 'importLibby', rawText, fileName: file.name });
      if (!response.ok) {
        setError({ operation: 'libby', issues: response.issues ?? [response.message] });
        setStatus('Nothing was imported. Fix the file and try again.');
        return;
      }
      adopt(response);
      await settle(response.summary.recordCount);
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

  async function applyDecision(
    request: Extract<
      WorkerRequestInput,
      { type: 'acceptCandidate' | 'manualResolve' | 'rejectCase' | 'deferCase' }
    >,
  ) {
    setBusy(true);
    const response = await requestWorker(request);
    if (response.ok) {
      adopt(response);
      setStatus('Decision saved.');
    } else {
      setError({ operation: 'decision', issues: response.issues ?? [response.message] });
    }
    setBusy(false);
  }

  async function applyAttribution(
    item: AttributionTriageItem,
    scope: 'checkout' | 'work',
    attributionState: 'assigned' | 'excluded',
    readerIds: readonly string[],
  ) {
    setBusy(true);
    // `attribution_overrides` allows exactly one target per scope; sending both
    // violates its CHECK constraint and every correction fails.
    const response = await requestWorker(
      scope === 'checkout'
        ? {
            type: 'correctAttribution',
            scope,
            importRecordId: item.importRecordId,
            state: attributionState,
            readerIds,
          }
        : {
            type: 'correctAttribution',
            scope,
            workId: item.workId,
            state: attributionState,
            readerIds,
          },
    );
    if (response.ok) {
      adopt(response);
      setStatus('Attribution correction saved.');
    } else setError({ operation: 'decision', issues: response.issues ?? [response.message] });
    setBusy(false);
  }

  async function reassignWork(workId: string, readerIds: readonly string[]) {
    setBusy(true);
    const response = await requestWorker({
      type: 'correctAttribution',
      scope: 'work',
      workId,
      state: readerIds.length === 0 ? 'excluded' : 'assigned',
      readerIds,
    });
    if (response.ok) {
      adopt(response);
      setStatus('Attribution correction saved.');
    } else setError({ operation: 'decision', issues: response.issues ?? [response.message] });
    setBusy(false);
  }

  async function manageReaders(
    request: Extract<
      WorkerRequestInput,
      { type: 'createReader' | 'renameReader' | 'archiveReader' | 'restoreReader' }
    >,
  ) {
    setBusy(true);
    setError(null);
    const response = await requestWorker(request);
    if (response.ok) {
      adopt(response);
      // A reader who is no longer active cannot stay selected.
      if (readerFilter && !response.summary.readers.some((reader) => reader.id === readerFilter)) {
        storeReaderFilter(null);
        setReaderFilterState(null);
      }
      setStatus(READER_STATUS[request.type]);
    } else setError({ operation: 'decision', issues: response.issues ?? [response.message] });
    setBusy(false);
  }

  async function applyReadingChange(
    request: Extract<WorkerRequestInput, { type: 'assessWork' | 'recordReadingSession' }>,
  ): Promise<string | null> {
    setBusy(true);
    const response = await requestWorker(request);
    let sessionId: string | null = null;
    if (response.ok) {
      adopt(response);
      sessionId = response.sessionId ?? null;
      setStatus(request.type === 'assessWork' ? 'Assessment saved.' : 'Confirmed session saved.');
    } else setError({ operation: 'decision', issues: response.issues ?? [response.message] });
    setBusy(false);
    return sessionId;
  }

  async function reviseSession(
    request: Extract<WorkerRequestInput, { type: 'reviseReadingSession' }>,
  ) {
    setBusy(true);
    const response = await requestWorker(request);
    if (response.ok) {
      adopt(response);
      setStatus('Reading updated.');
    } else setError({ operation: 'decision', issues: response.issues ?? [response.message] });
    setBusy(false);
  }

  async function assignReaders(workIds: readonly string[], readerIds: readonly string[]) {
    if (workIds.length === 0) return;
    setBusy(true);
    const response = await requestWorker({ type: 'assignReaders', workIds, readerIds });
    if (response.ok) {
      adopt(response);
      setStatus(`${String(workIds.length)} ${workIds.length === 1 ? 'book' : 'books'} filed.`);
    } else setError({ operation: 'decision', issues: response.issues ?? [response.message] });
    setBusy(false);
  }

  async function lookupIsbn(isbn: string): Promise<IsbnMatch | null> {
    const response = await requestWorker({ type: 'findByIsbn', isbn });
    return response.ok ? (response.isbnMatch ?? null) : null;
  }

  async function importCsvFile(file: File) {
    await applyBrowserOperation(
      { type: 'importCsv', rawText: await file.text(), fileName: file.name },
      'CSV import complete.',
    );
  }

  async function addBook(input: {
    title: string;
    author?: string;
    isbn?: string;
    readerId?: string | null;
  }) {
    const response = await applyBrowserOperation(
      { type: 'importManual', ...input, format: 'book' },
      'Book added.',
    );
    return { ok: response !== null, created: response?.manualCreated ?? false };
  }

  async function importArchiveFile(file: File) {
    await applyBrowserOperation(
      { type: 'importArchive', encryptedText: await file.text(), passphrase: archivePassphrase },
      'Encrypted archive restored.',
    );
  }

  async function exportArchive() {
    setBusy(true);
    setError(null);
    const response = await requestWorker({ type: 'exportArchive', passphrase: archivePassphrase });
    if (response.ok && response.archiveText) {
      // The export is what sets last_backup_at, so take the fresh value rather
      // than making the user reload to see that the backup registered.
      adopt(response);
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

  async function applyBrowserOperation(
    request: Extract<WorkerRequestInput, { type: 'importCsv' | 'importManual' | 'importArchive' }>,
    success: string,
  ): Promise<Extract<WorkerResponse, { readonly ok: true }> | null> {
    setBusy(true);
    setError(null);
    const response = await requestWorker(request);
    if (response.ok) {
      adopt(response);
      await settle(response.summary.recordCount);
      setStatus(
        request.type === 'importCsv'
          ? importSummary(response.result)
          : request.type === 'importManual' && response.manualCreated === false
            ? 'Already on your shelf.'
            : success,
      );
      setBusy(false);
      return response;
    } else {
      setError({
        operation: BROWSER_OPERATION_ERRORS[request.type],
        issues: response.issues ?? [response.message],
      });
      setStatus('Nothing was changed.');
    }
    setBusy(false);
    return null;
  }

  /** Books exist again, so any earlier loss has been made good — and a real add is
   *  the user gesture a browser weighs most when granting persistent storage. */
  async function settle(recordCount: number) {
    if (recordCount === 0) return;
    setWiped(false);
    clearWipeMarker();
    rememberBooksExist(recordCount);
    setPersistence(await requestPersistenceOnce());
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

function downloadText(value: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([value], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function importSummary(result: { rowsNew: number; rowsSeen: number } | undefined): string {
  if (!result) return 'Import complete.';
  if (result.rowsNew === 0) return `Already up to date — ${result.rowsSeen} rows checked, 0 new.`;
  return `Imported ${result.rowsNew} new of ${result.rowsSeen} rows.`;
}

const root = document.querySelector('#root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

if ('serviceWorker' in navigator) {
  window.addEventListener(
    'load',
    () => void navigator.serviceWorker.register('/service-worker.js'),
  );
}
