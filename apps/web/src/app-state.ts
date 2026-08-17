import { createContext, useContext, useEffect, useState } from 'react';
import type { AttributionTriageItem } from '@read-it-again/storage-schema';
import { requestWorker } from './client.js';
import type { PersistenceState } from './durability.js';
import type { Summary, WorkerRequestInput, WorkerResponse } from './protocol.js';

/** F-06: errors name the artefact they are actually about, so a mistyped backup
 *  passphrase never reports that a Libby file is invalid. */
export type ErrorOperation =
  | 'libby'
  | 'wrongSlot'
  | 'csv'
  | 'manual'
  | 'archiveExport'
  | 'archiveImport'
  | 'inbox'
  | 'decision';

export const ERROR_TITLES: Readonly<Record<ErrorOperation, string>> = {
  libby: 'That Libby file could not be read',
  wrongSlot: 'That is a backup, not a Libby file',
  csv: 'That CSV file could not be read',
  manual: 'That book could not be added',
  archiveExport: 'That backup could not be created',
  archiveImport: 'That backup could not be restored',
  inbox: 'Your bookshelf could not be opened',
  decision: 'That change could not be saved',
};

export const ERROR_ACTIONS: Readonly<Partial<Record<ErrorOperation, string>>> = {
  libby: 'In Libby, choose Timeline → Export Timeline → Data (JSON), then try that file.',
  wrongSlot: 'Use Import archive under Settings → Backup and restore, with its passphrase.',
  csv: 'The first row must name the columns, and one of them must be a title.',
  archiveExport: 'Choose a passphrase of at least 12 characters, then export again.',
  archiveImport:
    'Enter the passphrase you chose when you exported this backup, then pick the file again.',
  inbox: 'Reload the page. If it keeps happening, this browser may be blocking local storage.',
};

export interface ErrorState {
  readonly operation: ErrorOperation;
  readonly issues: readonly string[];
}

export const EMPTY_SUMMARY: Summary = {
  bookCount: 0,
  recordCount: 0,
  taskCount: 0,
  lastBackupAt: null,
  readers: [],
};

/**
 * ADR 0014. Shared state is now a summary of constant size. Each destination asks
 * the worker for what it renders, so opening Settings no longer costs a thousand
 * shelf rows and rating a book no longer re-fetches the library.
 */
export interface AppState {
  readonly summary: Summary;
  readonly status: string;
  readonly error: ErrorState | null;
  readonly busy: boolean;
  readonly persistence: PersistenceState;
  readonly wiped: boolean;
  readonly archivePassphrase: string;
  /** Which reader the shelf is filtered to, or null for everyone. Device-local
   *  and persisted, so a household member's view survives a reload. */
  readonly readerFilter: string | null;
  readonly setReaderFilter: (readerId: string | null) => void;
  /** Bumped whenever a mutation lands, so destinations know to re-read. */
  readonly revision: number;
  readonly setArchivePassphrase: (value: string) => void;
  readonly dismissWipeNotice: () => void;
  readonly refresh: () => Promise<void>;
  readonly importLibbyFile: (file: File) => Promise<void>;
  readonly importCsvFile: (file: File) => Promise<void>;
  readonly importArchiveFile: (file: File) => Promise<void>;
  readonly addBook: (input: {
    title: string;
    author?: string;
    isbn?: string;
    readerId?: string | null;
  }) => Promise<void>;
  readonly exportArchive: () => Promise<void>;
  readonly applyDecision: (
    request: Extract<
      WorkerRequestInput,
      { type: 'acceptCandidate' | 'manualResolve' | 'rejectCase' | 'deferCase' }
    >,
  ) => Promise<void>;
  readonly applyAttribution: (
    item: AttributionTriageItem,
    scope: 'checkout' | 'work',
    state: 'assigned' | 'excluded',
    readerIds: readonly string[],
  ) => Promise<void>;
  /** Resolves with the id of a session it just wrote, so the caller can offer an
   *  immediate correction (F-18). */
  readonly applyReadingChange: (
    request: Extract<WorkerRequestInput, { type: 'assessWork' | 'recordReadingSession' }>,
  ) => Promise<string | null>;
  readonly reviseSession: (
    request: Extract<WorkerRequestInput, { type: 'reviseReadingSession' }>,
  ) => Promise<void>;
  /** Assigns many books to readers at once, so cleaning up an import is a few
   *  taps rather than one decision per book (X4). */
  readonly assignReaders: (
    workIds: readonly string[],
    readerIds: readonly string[],
  ) => Promise<void>;
  /** Reassigns a book to one or more readers, superseding whatever decided it —
   *  automatic or human. This is ADR 0012's promised reversibility, and it has to
   *  work for a book that is already filed, not only one sitting in review. */
  readonly reassignWork: (workId: string, readerIds: readonly string[]) => Promise<void>;
  readonly manageReaders: (
    request: Extract<
      WorkerRequestInput,
      { type: 'createReader' | 'renameReader' | 'archiveReader' | 'restoreReader' }
    >,
  ) => Promise<void>;
}

const AppContext = createContext<AppState | null>(null);

export const AppProvider = AppContext.Provider;

export function useApp(): AppState {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside AppProvider');
  return value;
}

type OkResponse = Extract<WorkerResponse, { ok: true }>;

/**
 * Fetches one destination's data, re-running when the request changes or a
 * mutation bumps the revision. Stays `undefined` until the first response, which
 * is how a destination tells "still loading" from "genuinely empty".
 */
export function useWorkerData<T>(
  request: WorkerRequestInput,
  select: (response: OkResponse) => T,
): T | undefined {
  const { revision } = useApp();
  const [value, setValue] = useState<T | undefined>(undefined);
  // Serialised so the effect compares by value; callers build the request inline.
  const key = JSON.stringify(request);

  useEffect(() => {
    let cancelled = false;
    void requestWorker(JSON.parse(key) as WorkerRequestInput).then((response) => {
      if (cancelled || !response.ok) return;
      setValue(() => select(response));
    });
    return () => {
      cancelled = true;
    };
  }, [key, revision]);

  return value;
}
