/// <reference lib="webworker" />

import { LibbySnapshotError } from '@read-it-again/adapter-libby';
import {
  assessWork,
  createManualWorkForCase,
  correctAttribution,
  decideCandidate,
  deferCase,
  getImportInbox,
  importLibbySnapshot,
  prepareResolutionQueue,
  rebuildReadingModel,
  recordReadingSession,
  rejectCase,
} from '@read-it-again/application';
import { openOpfsDatabase } from '@read-it-again/storage-browser';
import { getReadingModel, listAttributionTriage, migrate } from '@read-it-again/storage-schema';
import type { WorkerRequest, WorkerResponse } from './protocol.js';

const SOURCE_ACCOUNT_ID = 'default-libby-source';
const HOUSEHOLD_ID = 'default-household';
const worker = self as unknown as DedicatedWorkerGlobalScope;

const databasePromise = openOpfsDatabase('/read-it-again.sqlite3').then(async (database) => {
  await migrate(database);
  return database;
});

worker.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  void handle(event.data);
});

async function handle(request: WorkerRequest): Promise<void> {
  try {
    const database = await databasePromise;
    if (request.type === 'importLibby') {
      const result = await importLibbySnapshot(database, {
        rawText: request.rawText,
        fileName: request.fileName,
        sourceAccountId: SOURCE_ACCOUNT_ID,
        householdId: HOUSEHOLD_ID,
      });
      const resolution = await prepareResolutionQueue(database, emptyCatalog);
      worker.postMessage({
        id: request.id,
        ok: true,
        result,
        inbox: await getImportInbox(database, SOURCE_ACCOUNT_ID),
        resolutionQueue: resolution.queue,
        attributionTriage: await listAttributionTriage(database),
        readingModel: await rebuildReadingModel(database),
      } satisfies WorkerResponse);
      return;
    }

    if (request.type === 'acceptCandidate') {
      await decideCandidate(database, request.caseId, request.candidateId);
    } else if (request.type === 'manualResolve') {
      await createManualWorkForCase(database, request.caseId, request.title, request.authorsJson);
    } else if (request.type === 'rejectCase') {
      await rejectCase(database, request.caseId);
    } else if (request.type === 'deferCase') {
      await deferCase(database, request.caseId);
    } else if (request.type === 'correctAttribution') {
      await correctAttribution(database, request);
    } else if (request.type === 'assessWork') {
      await assessWork(database, request);
    } else if (request.type === 'recordReadingSession') {
      await recordReadingSession(database, request);
    }

    const resolution = await prepareResolutionQueue(database, emptyCatalog);

    worker.postMessage({
      id: request.id,
      ok: true,
      inbox: await getImportInbox(database, SOURCE_ACCOUNT_ID),
      resolutionQueue: resolution.queue,
      attributionTriage: await listAttributionTriage(database),
      readingModel: await getReadingModel(database),
    } satisfies WorkerResponse);
  } catch (error) {
    worker.postMessage({
      id: request.id,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      issues: error instanceof LibbySnapshotError ? error.issues : undefined,
    } satisfies WorkerResponse);
  }
}

const emptyCatalog = {
  searchByIsbn: async () => [],
  searchByTitleAuthor: async () => [],
};
