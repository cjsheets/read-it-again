import type { ImportBatchResult, ImportRecord, ImportRun } from '@read-it-again/storage-schema';

export type WorkerRequest =
  | { readonly id: string; readonly type: 'getInbox' }
  | {
      readonly id: string;
      readonly type: 'importLibby';
      readonly rawText: string;
      readonly fileName: string;
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
      readonly result?: ImportBatchResult;
    }
  | {
      readonly id: string;
      readonly ok: false;
      readonly message: string;
      readonly issues?: readonly string[];
    };
