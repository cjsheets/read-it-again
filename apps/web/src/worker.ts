/// <reference lib="webworker" />

import { CsvImportError } from '@read-it-again/adapter-csv';
import { LibbySnapshotError } from '@read-it-again/adapter-libby';
import {
  assessWork,
  createManualWorkForCase,
  correctAttribution,
  decideCandidate,
  deferCase,
  exportEncryptedArchive,
  getHouseholdImportInbox,
  importCsvSnapshot,
  importEncryptedArchive,
  importLibbySnapshot,
  importManualBook,
  prepareResolutionQueue,
  rebuildReadingModel,
  recordReadingSession,
  rejectCase,
} from '@read-it-again/application';
import { openOpfsDatabase } from '@read-it-again/storage-browser';
import {
  getAppMetadata,
  getReadingModel,
  getRecommendations,
  LAST_BACKUP_AT,
  listAttributionTriage,
  migrate,
} from '@read-it-again/storage-schema';
import type { CompositionDefaults } from '@read-it-again/application';
import type { WorkerRequest, WorkerResponse } from './protocol.js';

const SOURCE_ACCOUNT_ID = 'default-libby-source';
const CSV_SOURCE_ACCOUNT_ID = 'default-csv-source';
const MANUAL_SOURCE_ACCOUNT_ID = 'default-manual-source';
const HOUSEHOLD_ID = 'default-household';
const worker = self as unknown as DedicatedWorkerGlobalScope;

const databasePromise = openOpfsDatabase('/read-it-again.sqlite3').then(async (database) => {
  await migrate(database);
  const now = new Date().toISOString();
  await database.run('INSERT OR IGNORE INTO households (id, name, created_at) VALUES (?, ?, ?)', [
    HOUSEHOLD_ID,
    'My Household',
    now,
  ]);
  await database.run(
    'INSERT OR IGNORE INTO people (id, household_id, display_name, created_at) VALUES (?, ?, ?, ?)',
    ['default-reader', HOUSEHOLD_ID, 'Child', now],
  );
  await database.run(
    "INSERT OR IGNORE INTO reader_profiles (person_id, kind, created_at) VALUES (?, 'child', ?)",
    ['default-reader', now],
  );
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
      const resolution = await prepareResolutionQueue(database, emptyCatalog, {
        defaults: BROWSER_DEFAULTS,
      });
      worker.postMessage({
        id: request.id,
        ok: true,
        result,
        inbox: await getHouseholdImportInbox(database),
        resolutionQueue: resolution.queue,
        attributionTriage: await listAttributionTriage(database),
        readingModel: await rebuildReadingModel(database),
        recommendations: await getRecommendations(database),
        lastBackupAt: (await getAppMetadata(database, LAST_BACKUP_AT)) ?? null,
      } satisfies WorkerResponse);
      return;
    }

    if (request.type === 'importCsv') {
      const result = await importCsvSnapshot(database, {
        rawText: request.rawText,
        fileName: request.fileName,
        sourceAccountId: CSV_SOURCE_ACCOUNT_ID,
        householdId: HOUSEHOLD_ID,
      });
      const resolution = await prepareResolutionQueue(database, emptyCatalog, {
        defaults: BROWSER_DEFAULTS,
      });
      worker.postMessage({
        id: request.id,
        ok: true,
        result,
        inbox: await getHouseholdImportInbox(database),
        resolutionQueue: resolution.queue,
        attributionTriage: await listAttributionTriage(database),
        readingModel: await getReadingModel(database),
        recommendations: await getRecommendations(database),
        lastBackupAt: (await getAppMetadata(database, LAST_BACKUP_AT)) ?? null,
      } satisfies WorkerResponse);
      return;
    }

    if (request.type === 'importManual') {
      const manual = await importManualBook(database, {
        ...request,
        sourceAccountId: MANUAL_SOURCE_ACCOUNT_ID,
        householdId: HOUSEHOLD_ID,
      });
      await correctAttribution(database, {
        scope: 'work',
        workId: manual.workId,
        state: 'assigned',
        readerIds: ['default-reader'],
        defaults: BROWSER_DEFAULTS,
      });
    } else if (request.type === 'exportArchive') {
      const archiveText = await exportEncryptedArchive(database, request.passphrase);
      worker.postMessage({
        id: request.id,
        ok: true,
        archiveText,
        inbox: await getHouseholdImportInbox(database),
        resolutionQueue: (
          await prepareResolutionQueue(database, emptyCatalog, { defaults: BROWSER_DEFAULTS })
        ).queue,
        attributionTriage: await listAttributionTriage(database),
        readingModel: await getReadingModel(database),
        recommendations: await getRecommendations(database),
        lastBackupAt: (await getAppMetadata(database, LAST_BACKUP_AT)) ?? null,
      } satisfies WorkerResponse);
      return;
    } else if (request.type === 'importArchive') {
      await importEncryptedArchive(database, request.encryptedText, request.passphrase);
    }

    if (request.type === 'acceptCandidate') {
      await decideCandidate(database, request.caseId, request.candidateId, {
        defaults: BROWSER_DEFAULTS,
      });
    } else if (request.type === 'manualResolve') {
      await createManualWorkForCase(database, request.caseId, request.title, request.authorsJson, {
        defaults: BROWSER_DEFAULTS,
      });
    } else if (request.type === 'rejectCase') {
      await rejectCase(database, request.caseId);
    } else if (request.type === 'deferCase') {
      await deferCase(database, request.caseId);
    } else if (request.type === 'correctAttribution') {
      await correctAttribution(database, { ...request, defaults: BROWSER_DEFAULTS });
    } else if (request.type === 'assessWork') {
      await assessWork(database, request);
    } else if (request.type === 'recordReadingSession') {
      await recordReadingSession(database, request);
    }

    const resolution = await prepareResolutionQueue(database, emptyCatalog, {
      defaults: BROWSER_DEFAULTS,
    });

    worker.postMessage({
      id: request.id,
      ok: true,
      inbox: await getHouseholdImportInbox(database),
      resolutionQueue: resolution.queue,
      attributionTriage: await listAttributionTriage(database),
      readingModel: await getReadingModel(database),
      recommendations: await getRecommendations(database),
      lastBackupAt: (await getAppMetadata(database, LAST_BACKUP_AT)) ?? null,
    } satisfies WorkerResponse);
  } catch (error) {
    worker.postMessage({
      id: request.id,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      issues:
        error instanceof LibbySnapshotError || error instanceof CsvImportError
          ? error.issues
          : undefined,
    } satisfies WorkerResponse);
  }
}

const emptyCatalog = {
  searchByIsbn: async () => [],
  searchByTitleAuthor: async () => [],
};

/**
 * ADR 0012. The browser has no catalog (ADR 0002), so the conservative domain
 * rules have nothing to work with and every imported book stalls in a review
 * queue (F-01). These defaults let imports land on the shelf; the decisions they
 * write are append-only and any human choice supersedes them.
 */
const BROWSER_DEFAULTS = {
  acceptSourceDetails: true,
  assignSingleReader: true,
} as const satisfies CompositionDefaults;
