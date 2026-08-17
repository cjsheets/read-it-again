import type {
  AttributionTriageItem,
  IsbnMatch,
  Reader,
  ImportBatchResult,
  ImportRecord,
  ImportRun,
  ReadingModelView,
  ReadingTrait,
  RecommendationView,
  ResolutionQueueItem,
  ShelfPage,
  ShelfSort,
} from '@read-it-again/storage-schema';

/**
 * ADR 0014. Reads are separated from mutations and asked for by destination.
 *
 * Every response used to carry the complete dataset: records, runs, both review
 * queues, the whole reading model and every recommendation. A thousand-book
 * household paid for all thousand on every keystroke. Now a mutation returns a
 * small summary, and each destination asks for what it renders.
 */
export type WorkerRequest =
  // ── Reads ────────────────────────────────────────────────────────────────
  | { readonly id: string; readonly type: 'getSummary' }
  | {
      readonly id: string;
      readonly type: 'listShelf';
      readonly query?: string;
      readonly sort?: ShelfSort;
      readonly offset?: number;
      readonly limit?: number;
      readonly readerId?: string | null;
    }
  | { readonly id: string; readonly type: 'getActivity' }
  | { readonly id: string; readonly type: 'getTasks' }
  | { readonly id: string; readonly type: 'getRecommendations' }
  | { readonly id: string; readonly type: 'getImportHistory' }
  | { readonly id: string; readonly type: 'getCover'; readonly workId: string }
  | { readonly id: string; readonly type: 'listReaders' }
  /** Whether a scanned or typed ISBN is already on the shelf. A read, because a
   *  scan must be able to say "you have this" without writing anything. */
  | { readonly id: string; readonly type: 'findByIsbn'; readonly isbn: string }
  // ── Mutations ────────────────────────────────────────────────────────────
  | {
      readonly id: string;
      readonly type: 'importLibby';
      readonly rawText: string;
      readonly fileName: string;
    }
  | {
      readonly id: string;
      readonly type: 'importCsv';
      readonly rawText: string;
      readonly fileName: string;
    }
  | {
      readonly id: string;
      readonly type: 'importManual';
      readonly title: string;
      readonly author?: string;
      readonly isbn?: string;
      readonly format?: string;
      /** Who the book is for. Omitted means the household's only reader, which is
       *  the single-reader case ADR 0012 already handles. */
      readonly readerId?: string | null;
    }
  | { readonly id: string; readonly type: 'exportArchive'; readonly passphrase: string }
  | {
      readonly id: string;
      readonly type: 'importArchive';
      readonly encryptedText: string;
      readonly passphrase: string;
    }
  | {
      readonly id: string;
      readonly type: 'saveCover';
      readonly workId: string;
      readonly bytes: Uint8Array;
      readonly mime: string;
      readonly width: number;
      readonly height: number;
    }
  | { readonly id: string; readonly type: 'removeCover'; readonly workId: string }
  | { readonly id: string; readonly type: 'createReader'; readonly displayName: string }
  | {
      readonly id: string;
      readonly type: 'renameReader';
      readonly personId: string;
      readonly displayName: string;
    }
  | { readonly id: string; readonly type: 'archiveReader'; readonly personId: string }
  | { readonly id: string; readonly type: 'restoreReader'; readonly personId: string }
  | {
      readonly id: string;
      readonly type: 'acceptCandidate';
      readonly caseId: string;
      readonly candidateId: string;
    }
  | {
      readonly id: string;
      readonly type: 'manualResolve';
      readonly caseId: string;
      readonly title: string;
      readonly authorsJson: string;
    }
  | { readonly id: string; readonly type: 'rejectCase'; readonly caseId: string }
  | { readonly id: string; readonly type: 'deferCase'; readonly caseId: string }
  // Split by scope on purpose. `attribution_overrides` has a CHECK constraint
  // allowing exactly one target per scope, so a shape carrying both is always a
  // runtime failure; this makes that shape impossible to construct.
  | {
      readonly id: string;
      readonly type: 'correctAttribution';
      readonly scope: 'checkout';
      readonly importRecordId: string;
      readonly state: 'assigned' | 'excluded';
      readonly readerIds: readonly string[];
    }
  | {
      readonly id: string;
      readonly type: 'correctAttribution';
      readonly scope: 'work';
      readonly workId: string;
      readonly state: 'assigned' | 'excluded';
      readonly readerIds: readonly string[];
    }
  | {
      readonly id: string;
      readonly type: 'assessWork';
      readonly workId: string;
      readonly personId: string;
      // Optional because "not rated yet" is a real state the storage layer already
      // persists as NULL. Defaulting these to 2 fabricated assessments (F-12).
      readonly childEngagement?: number;
      readonly adultTolerance?: number;
      readonly asksByName: boolean;
      readonly veto: boolean;
      readonly estimatedReadMinutes?: number;
      readonly traits: readonly ReadingTrait[];
    }
  | {
      readonly id: string;
      readonly type: 'recordReadingSession';
      readonly householdId: string;
      readonly workId: string;
      readonly participantIds: readonly string[];
      readonly durationMinutes?: number;
      readonly context: 'bedtime' | 'daytime' | 'travel' | 'school' | 'other';
      readonly occurredAt?: string;
    }
  // F-18: a session used to be write-once with a hardcoded context, the current
  // time and one participant. Correcting it is what makes one-tap logging safe.
  | {
      readonly id: string;
      readonly type: 'reviseReadingSession';
      readonly sessionId: string;
      readonly participantIds: readonly string[];
      readonly occurredAt: string;
      readonly durationMinutes?: number;
      readonly context: 'bedtime' | 'daytime' | 'travel' | 'school' | 'other';
    }
  | {
      readonly id: string;
      readonly type: 'assignReaders';
      readonly workIds: readonly string[];
      readonly readerIds: readonly string[];
    };

export type WorkerRequestInput = WorkerRequest extends infer Request
  ? Request extends { readonly id: string }
    ? Omit<Request, 'id'>
    : never
  : never;

/**
 * What every screen needs and nothing more: how many books, how many decisions are
 * outstanding, and when the last backup was. Constant size regardless of library.
 */
export interface Summary {
  readonly bookCount: number;
  readonly recordCount: number;
  readonly taskCount: number;
  readonly lastBackupAt: string | null;
  /** Active readers. The shell needs this on every screen for the switcher, and
   *  it is what decides whether attribution has a genuine choice to offer. */
  readonly readers: readonly { readonly id: string; readonly displayName: string }[];
}

export type WorkerResponse =
  | {
      readonly id: string;
      readonly ok: true;
      readonly summary: Summary;
      readonly result?: ImportBatchResult;
      readonly archiveText?: string;
      readonly cover?: { readonly bytes: Uint8Array; readonly mime: string } | null;
      readonly shelf?: ShelfPage;
      readonly activity?: ReadingModelView;
      readonly tasks?: {
        readonly resolutionQueue: readonly ResolutionQueueItem[];
        readonly attributionTriage: readonly AttributionTriageItem[];
      };
      readonly recommendations?: RecommendationView;
      readonly importHistory?: {
        readonly records: readonly ImportRecord[];
        readonly runs: readonly ImportRun[];
      };
      readonly readers?: readonly Reader[];
      /** null means the ISBN resolved to nothing on this device. Absent means the
       *  request was not a lookup at all. */
      readonly isbnMatch?: IsbnMatch | null;
      /** The session just written, so the UI can offer an inline correction
       *  without a second lookup (F-18). */
      readonly sessionId?: string;
    }
  | {
      readonly id: string;
      readonly ok: false;
      readonly message: string;
      readonly issues?: readonly string[];
    };
