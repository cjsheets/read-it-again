/// <reference lib="webworker" />

import { LibbySnapshotError } from '@read-it-again/adapter-libby';
import { getImportInbox, importLibbySnapshot } from '@read-it-again/application';
import { openOpfsDatabase } from '@read-it-again/storage-browser';
import { migrate } from '@read-it-again/storage-schema';
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
      worker.postMessage({
        id: request.id,
        ok: true,
        result,
        inbox: await getImportInbox(database, SOURCE_ACCOUNT_ID),
      } satisfies WorkerResponse);
      return;
    }

    worker.postMessage({
      id: request.id,
      ok: true,
      inbox: await getImportInbox(database, SOURCE_ACCOUNT_ID),
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
