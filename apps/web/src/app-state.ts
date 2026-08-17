import { createContext, useContext } from 'react';
import type {
  AttributionTriageItem,
  ImportRecord,
  ImportRun,
  ReadingModelView,
  RecommendationView,
  ResolutionQueueItem,
} from '@read-it-again/storage-schema';
import type { PersistenceState } from './durability.js';
import type { WorkerRequestInput } from './protocol.js';

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

export interface Bookshelf {
  readonly records: readonly ImportRecord[];
  readonly runs: readonly ImportRun[];
  readonly resolutionQueue: readonly ResolutionQueueItem[];
  readonly attributionTriage: readonly AttributionTriageItem[];
  readonly readingModel: ReadingModelView;
  readonly recommendations: RecommendationView;
  readonly lastBackupAt: string | null;
}

export const EMPTY_BOOKSHELF: Bookshelf = {
  records: [],
  runs: [],
  resolutionQueue: [],
  attributionTriage: [],
  readingModel: { checkouts: [], episodes: [], sessions: [], shelf: [] },
  recommendations: { generatedAt: null, constraints: null, discovery: [], readAgain: [] },
  lastBackupAt: null,
};

/** Anything a destination needs. Passed through context so the shell does not have
 *  to thread a dozen props through five levels of layout. */
export interface AppState {
  readonly bookshelf: Bookshelf;
  readonly status: string;
  readonly error: ErrorState | null;
  readonly busy: boolean;
  readonly persistence: PersistenceState;
  readonly wiped: boolean;
  readonly archivePassphrase: string;
  readonly setArchivePassphrase: (value: string) => void;
  readonly dismissWipeNotice: () => void;
  /** Re-reads everything from the worker. Needed after a change made outside the
   *  usual action helpers, such as storing a cover. */
  readonly refresh: () => Promise<void>;
  readonly importLibbyFile: (file: File) => Promise<void>;
  readonly importCsvFile: (file: File) => Promise<void>;
  readonly importArchiveFile: (file: File) => Promise<void>;
  readonly addBook: (input: { title: string; author?: string; isbn?: string }) => Promise<void>;
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
  readonly applyReadingChange: (
    request: Extract<WorkerRequestInput, { type: 'assessWork' | 'recordReadingSession' }>,
  ) => Promise<void>;
}

const AppContext = createContext<AppState | null>(null);

export const AppProvider = AppContext.Provider;

export function useApp(): AppState {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside AppProvider');
  return value;
}

/** How many decisions the review queues are demanding. Drives the Tasks badge,
 *  which is how review work stops being a section (F-14). */
export function taskCount(bookshelf: Bookshelf): number {
  return bookshelf.resolutionQueue.length + bookshelf.attributionTriage.length;
}
