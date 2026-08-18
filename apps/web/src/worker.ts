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
  reviseReadingSession,
} from '@read-it-again/application';
import type { CompositionDefaults } from '@read-it-again/application';
import { openOpfsDatabase } from '@read-it-again/storage-browser';
import {
  archiveReader,
  createReader,
  deleteCoverImage,
  enqueueMissingCatalogCovers,
  findWorkByIsbn,
  getAppMetadata,
  getCoverImage,
  getReadingModel,
  getRecommendations,
  indexWorksForSearch,
  LAST_BACKUP_AT,
  listAttributionTriage,
  listBookDetailVersions,
  listReaders,
  listShelf,
  migrate,
  renameReader,
  restoreReader,
  saveCoverImage,
  saveBookDetails,
  setBookShelfState,
} from '@read-it-again/storage-schema';
import type { Database } from '@read-it-again/storage-schema';
import type { Summary, WorkerEvent, WorkerRequest, WorkerResponse } from './protocol.js';
import { drainCatalogCoverQueue } from './catalog-cover.js';
import { lookupCatalogMetadata } from './catalog-metadata.js';

const SOURCE_ACCOUNT_ID = 'default-libby-source';
const CSV_SOURCE_ACCOUNT_ID = 'default-csv-source';
const MANUAL_SOURCE_ACCOUNT_ID = 'default-manual-source';
const HOUSEHOLD_ID = 'default-household';
const worker = self as unknown as DedicatedWorkerGlobalScope;
let coverDrain: Promise<void> | undefined;
let coverDrainRequested = false;

/** Browser-only defaults for imports that have no catalog evidence. */
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
  // Deliberately no cover queue here. Cover art is the only thing this app
  // fetches from anyone, and it waits to be asked (ADR 0016). The main thread
  // pushes the stored answer once it has read it.
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
      case 'setCatalogLookup':
        await setCatalogLookup(database, request.enabled);
        return await reply(request.id, database, {});
      case 'lookupIsbnMetadata': {
        if (!catalogLookupEnabled) throw new Error('Open Library lookup permission is off.');
        worker.postMessage({ type: 'catalogFetchActive', active: true } satisfies WorkerEvent);
        try {
          return await reply(request.id, database, {
            isbnMetadata: await lookupCatalogMetadata(database, request.isbn),
          });
        } finally {
          worker.postMessage({ type: 'catalogFetchActive', active: false } satisfies WorkerEvent);
        }
      }
      case 'findByIsbn':
        return await reply(request.id, database, {
          isbnMatch: await findWorkByIsbn(database, request.isbn),
        });
      case 'getCover': {
        const cover = await getCoverImage(database, request.workId);
        return await reply(request.id, database, {
          cover: cover ? { bytes: cover.bytes, mime: cover.mime } : null,
        });
      }
      case 'getBookEdits':
        return await reply(request.id, database, {
          bookEdits: await listBookDetailVersions(database, request.workId),
        });
      default:
        break;
    }

    let result;
    let archiveText;
    let sessionId;
    let manualCreated;
    const mayAddCoverCandidates = new Set<WorkerRequest['type']>([
      'importLibby',
      'importCsv',
      'importManual',
      'importArchive',
      'acceptCandidate',
      'manualResolve',
    ]).has(request.type);

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
      manualCreated = manual.created;
      // Prefer the selected reader; otherwise use the only active reader.
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
    } else if (request.type === 'saveBookDetails') {
      await saveBookDetails(database, {
        id: crypto.randomUUID(),
        workId: request.workId,
        title: request.title,
        author: request.author,
        now: new Date().toISOString(),
      });
    } else if (request.type === 'setBookShelfState') {
      await setBookShelfState(database, {
        id: crypto.randomUUID(),
        workId: request.workId,
        state: request.state,
        now: new Date().toISOString(),
      });
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
      ({ sessionId } = await recordReadingSession(database, request));
    } else if (request.type === 'reviseReadingSession') {
      await reviseReadingSession(database, { ...request, id: request.sessionId });
    } else if (request.type === 'assignReaders') {
      // Keep a bulk assignment in one transaction.
      for (const workId of request.workIds) {
        await correctAttribution(database, {
          scope: 'work',
          workId,
          state: request.readerIds.length === 0 ? 'excluded' : 'assigned',
          readerIds: request.readerIds,
          defaults: BROWSER_DEFAULTS,
        });
      }
    }

    if (mayAddCoverCandidates && catalogLookupEnabled) {
      await enqueueMissingCatalogCovers(database, new Date().toISOString());
    }
    await reply(request.id, database, { result, archiveText, sessionId, manualCreated });
    if (mayAddCoverCandidates && catalogLookupEnabled) scheduleCoverDrain(database);
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
 * Whether this household has agreed to cover lookups. False until the main thread
 * says otherwise, so a message that never arrives means no requests rather than
 * silent ones — the failure mode has to be the private one.
 */
let catalogLookupEnabled = false;

async function setCatalogLookup(database: Database, enabled: boolean): Promise<void> {
  if (enabled === catalogLookupEnabled) return;
  catalogLookupEnabled = enabled;
  if (!enabled) return;
  // Consent covers the shelf as it stands, not just books added from here on.
  await enqueueMissingCatalogCovers(database, new Date().toISOString());
  scheduleCoverDrain(database);
}

function scheduleCoverDrain(database: Database): void {
  if (!catalogLookupEnabled) return;
  if (coverDrain) {
    coverDrainRequested = true;
    return;
  }
  coverDrainRequested = false;
  worker.postMessage({ type: 'catalogFetchActive', active: true } satisfies WorkerEvent);
  coverDrain = drainCatalogCoverQueue(
    database,
    (workId) => {
      worker.postMessage({ type: 'catalogCoverStored', workId } satisfies WorkerEvent);
    },
    { shouldContinue: () => catalogLookupEnabled },
  ).finally(() => {
    coverDrain = undefined;
    if (coverDrainRequested && catalogLookupEnabled) scheduleCoverDrain(database);
    else worker.postMessage({ type: 'catalogFetchActive', active: false } satisfies WorkerEvent);
  });
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
  const rows = await database.query<{
    books: number;
    records: number;
    tasks: number;
    recommendations: number;
  }>(
    `SELECT
       (SELECT count(DISTINCT ps.work_id) FROM preference_summaries ps
        WHERE COALESCE(
          (SELECT state FROM work_shelf_events event
           WHERE event.work_id = ps.work_id ORDER BY revision DESC LIMIT 1),
          'present'
        ) = 'present') AS books,
       (SELECT count(*) FROM import_records) AS records,
       (SELECT count(*) FROM resolution_cases WHERE status IN ('pending', 'deferred'))
         + (SELECT count(*) FROM attribution_results WHERE current = 1 AND state = 'review')
         AS tasks,
       (SELECT count(*) FROM recommendation_items) AS recommendations`,
  );
  const counts = rows[0];
  const readers = await listReaders(database);
  return {
    bookCount: counts?.books ?? 0,
    recordCount: counts?.records ?? 0,
    taskCount: counts?.tasks ?? 0,
    recommendationCount: counts?.recommendations ?? 0,
    lastBackupAt: (await getAppMetadata(database, LAST_BACKUP_AT)) ?? null,
    readers: readers.map(({ id, displayName }) => ({ id, displayName })),
  };
}
