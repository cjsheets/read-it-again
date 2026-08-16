import type { ImportBatchResult, ImportRecord, ImportRun } from '@read-it-again/storage-schema';
import type {
  AttributionTriageItem,
  ReadingModelView,
  ReadingTrait,
  RecommendationView,
  ResolutionQueueItem,
} from '@read-it-again/storage-schema';

export type WorkerRequest =
  | { readonly id: string; readonly type: 'getInbox' }
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
    };

export type WorkerRequestInput = WorkerRequest extends infer Request
  ? Request extends { readonly id: string }
    ? Omit<Request, 'id'>
    : never
  : never;

export type WorkerResponse =
  | {
      readonly id: string;
      readonly ok: true;
      readonly inbox: {
        readonly records: readonly ImportRecord[];
        readonly runs: readonly ImportRun[];
      };
      readonly resolutionQueue: readonly ResolutionQueueItem[];
      readonly attributionTriage: readonly AttributionTriageItem[];
      readonly readingModel: ReadingModelView;
      readonly recommendations: RecommendationView;
      /** ISO timestamp of the last successful archive export, or null if never
       *  backed up. Travels with the archive, so a restored device inherits it. */
      readonly lastBackupAt: string | null;
      readonly result?: ImportBatchResult;
      readonly archiveText?: string;
    }
  | {
      readonly id: string;
      readonly ok: false;
      readonly message: string;
      readonly issues?: readonly string[];
    };
