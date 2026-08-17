/// <reference lib="webworker" />

import { CsvImportError } from '@read-it-again/adapter-csv';
import { LibbySnapshotError } from '@read-it-again/adapter-libby';
import {
  assessWork,
  correctAttribution,
  createManualWorkForCase,
  decideCandidate,
  deferCase,
  exportEncryptedArchive,
  getHouseholdImportInbox,
  importCsvSnapshot,
  importEncryptedArchive,
  importLibbySnapshot,
  importManualBook,
  prepareResolutionQueue,
  recordReadingSession,
  rejectCase,
} from '@read-it-again/application';
import type { CompositionDefaults } from '@read-it-again/application';
import { openOpfsDatabase } from '@read-it-again/storage-browser';
import {
  archiveReader,
  createReader,
  deleteCoverImage,
  getAppMetadata,
  getCoverImage,
  getReadingModel,
  getRecommendations,
  indexWorksForSearch,
  LAST_BACKUP_AT,
  listAttributionTriage,
  listReaders,
  listShelf,
  migrate,
  renameReader,
  restoreReader,
  saveCoverImage,
} from '@read-it-again/storage-schema';
import type { Database } from '@read-it-again/storage-schema';
import type { Summary, WorkerRequest, WorkerResponse } from './protocol.js';

const SOURCE_ACCOUNT_ID = 'default-libby-source';
const CSV_SOURCE_ACCOUNT_ID = 'default-csv-source';
const MANUAL_SOURCE_ACCOUNT_ID = 'default-manual-source';
const HOUSEHOLD_ID = 'default-household';
const worker = self as unknown as DedicatedWorkerGlobalScope;

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

const emptyCatalog = {
  searchByIsbn: async () => [],
  searchByTitleAuthor: async () => [],
};

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
  // Catches up any works created before migration 9 existed.
  await indexWorksForSearch(database);
  return database;
});

worker.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  void handle(event.data);
});

async function handle(request: WorkerRequest): Promise<void> {
  try {
    const database = await databasePromise;

    switch (request.type) {
      case 'getSummary':
        return await reply(request.id, database, {});
      case 'listShelf':
        return await reply(request.id, database, { shelf: await listShelf(database, request) });
      case 'getActivity':
        return await reply(request.id, database, { activity: await getReadingModel(database) });
      case 'getTasks':
        return await reply(request.id, database, {
          tasks: {
            resolutionQueue: (
              await prepareResolutionQueue(database, emptyCatalog, { defaults: BROWSER_DEFAULTS })
            ).queue,
            attributionTriage: await listAttributionTriage(database),
          },
        });
      case 'getRecommendations':
        return await reply(request.id, database, {
          recommendations: await getRecommendations(database),
        });
      case 'getImportHistory':
        return await reply(request.id, database, {
          importHistory: await getHouseholdImportInbox(database),
        });
      case 'listReaders':
        return await reply(request.id, database, {
          readers: await listReaders(database, { includeArchived: true }),
        });
      case 'getCover': {
        const cover = await getCoverImage(database, request.workId);
        return await reply(request.id, database, {
          cover: cover ? { bytes: cover.bytes, mime: cover.mime } : null,
        });
      }
      default:
        break;
    }

    let result;
    let archiveText;

    if (request.type === 'importLibby') {
      result = await importLibbySnapshot(database, {
        rawText: request.rawText,
        fileName: request.fileName,
        sourceAccountId: SOURCE_ACCOUNT_ID,
        householdId: HOUSEHOLD_ID,
      });
      await settle(database);
    } else if (request.type === 'importCsv') {
      result = await importCsvSnapshot(database, {
        rawText: request.rawText,
        fileName: request.fileName,
        sourceAccountId: CSV_SOURCE_ACCOUNT_ID,
        householdId: HOUSEHOLD_ID,
      });
      await settle(database);
    } else if (request.type === 'importManual') {
      const manual = await importManualBook(database, {
        ...request,
        sourceAccountId: MANUAL_SOURCE_ACCOUNT_ID,
        householdId: HOUSEHOLD_ID,
      });
      // Attributed to whoever the household is looking at, rather than a
      // hardcoded 'default-reader' (F-03). Falls back to the only active reader.
      const active = await listReaders(database);
      const readerId =
        request.readerId && active.some((reader) => reader.id === request.readerId)
          ? request.readerId
          : active[0]?.id;
      if (readerId) {
        await correctAttribution(database, {
          scope: 'work',
          workId: manual.workId,
          state: 'assigned',
          readerIds: [readerId],
          defaults: BROWSER_DEFAULTS,
        });
      }
      await indexWorksForSearch(database);
    } else if (request.type === 'exportArchive') {
      archiveText = await exportEncryptedArchive(database, request.passphrase);
    } else if (request.type === 'importArchive') {
      await importEncryptedArchive(database, request.encryptedText, request.passphrase);
      await settle(database);
    } else if (request.type === 'saveCover') {
      await saveCoverImage(database, {
        workId: request.workId,
        bytes: request.bytes,
        mime: request.mime,
        width: request.width,
        height: request.height,
        source: 'user_file',
        now: new Date().toISOString(),
      });
    } else if (request.type === 'removeCover') {
      await deleteCoverImage(database, request.workId);
    } else if (request.type === 'createReader') {
      await createReader(database, {
        id: crypto.randomUUID(),
        householdId: HOUSEHOLD_ID,
        displayName: request.displayName,
        now: new Date().toISOString(),
      });
      // A second reader changes what attribution can conclude on its own
      // (ADR 0012), so the queues are re-derived immediately rather than at the
      // next import.
      await settle(database);
    } else if (request.type === 'renameReader') {
      await renameReader(database, request.personId, request.displayName);
    } else if (request.type === 'archiveReader') {
      await archiveReader(database, request.personId, new Date().toISOString());
      await settle(database);
    } else if (request.type === 'restoreReader') {
      await restoreReader(database, request.personId);
      await settle(database);
    } else if (request.type === 'acceptCandidate') {
      await decideCandidate(database, request.caseId, request.candidateId, {
        defaults: BROWSER_DEFAULTS,
      });
      await indexWorksForSearch(database);
    } else if (request.type === 'manualResolve') {
      await createManualWorkForCase(database, request.caseId, request.title, request.authorsJson, {
        defaults: BROWSER_DEFAULTS,
      });
      await indexWorksForSearch(database);
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

    await reply(request.id, database, { result, archiveText });
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

/**
 * The resolution and attribution pass new records need, plus search indexing.
 * Called only by operations that can introduce records. Previously every request
 * ended with this, so rating a book or logging a reading paid for a full recompute
 * and reading-model rebuild across the entire library.
 */
async function settle(database: Database): Promise<void> {
  await prepareResolutionQueue(database, emptyCatalog, { defaults: BROWSER_DEFAULTS });
  await indexWorksForSearch(database);
}

async function reply(
  id: string,
  database: Database,
  extra: Omit<Extract<WorkerResponse, { ok: true }>, 'id' | 'ok' | 'summary'>,
): Promise<void> {
  worker.postMessage({
    id,
    ok: true,
    summary: await summarize(database),
    ...extra,
  } satisfies WorkerResponse);
}

/** Four counts, whatever the size of the library. */
async function summarize(database: Database): Promise<Summary> {
  const rows = await database.query<{ books: number; records: number; tasks: number }>(
    `SELECT
       (SELECT count(*) FROM preference_summaries) AS books,
       (SELECT count(*) FROM import_records) AS records,
       (SELECT count(*) FROM resolution_cases WHERE status IN ('pending', 'deferred'))
         + (SELECT count(*) FROM attribution_results WHERE current = 1 AND state = 'review')
         AS tasks`,
  );
  const counts = rows[0];
  const readers = await listReaders(database);
  return {
    bookCount: counts?.books ?? 0,
    recordCount: counts?.records ?? 0,
    taskCount: counts?.tasks ?? 0,
    lastBackupAt: (await getAppMetadata(database, LAST_BACKUP_AT)) ?? null,
    readers: readers.map(({ id, displayName }) => ({ id, displayName })),
  };
}
