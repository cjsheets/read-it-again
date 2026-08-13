import type { ImportBatchResult, ImportRecord, ImportRun } from '@read-it-again/storage-schema';
import type { AttributionTriageItem, ResolutionQueueItem } from '@read-it-again/storage-schema';

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
  | {
      readonly id: string;
      readonly type: 'correctAttribution';
      readonly scope: 'checkout' | 'work';
      readonly importRecordId: string;
      readonly workId: string;
      readonly state: 'assigned' | 'excluded';
      readonly readerIds: readonly string[];
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
      readonly result?: ImportBatchResult;
    }
  | {
      readonly id: string;
      readonly ok: false;
      readonly message: string;
      readonly issues?: readonly string[];
    };
