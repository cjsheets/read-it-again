import { parseCsvSnapshot } from '@read-it-again/adapter-csv';
import {
  createManualResolution,
  ensureImportContext,
  ensureResolutionCase,
  importNormalizedRecords,
  listImportRecords,
  listImportRuns,
  type Database,
  type ImportBatchResult,
} from '@read-it-again/storage-schema';
import { rebuildReadingModel } from './reading.js';

export async function importCsvSnapshot(
  database: Database,
  input: {
    readonly rawText: string;
    readonly fileName?: string;
    readonly sourceAccountId: string;
    readonly householdId: string;
    readonly idFactory?: () => string;
    readonly now?: () => Date;
  },
): Promise<ImportBatchResult> {
  const parsed = parseCsvSnapshot(input.rawText);
  const idFactory = input.idFactory ?? (() => crypto.randomUUID());
  const now = (input.now ?? (() => new Date()))().toISOString();
  await ensureImportContext(database, {
    sourceAccountId: input.sourceAccountId,
    householdId: input.householdId,
    kind: 'csv',
    label: 'Generic CSV',
    now,
  });
  return importNormalizedRecords(database, {
    sourceAccountId: input.sourceAccountId,
    blobId: idFactory(),
    runId: idFactory(),
    blobSha256: await sha256Hex(input.rawText),
    fileName: input.fileName,
    mediaType: 'text/csv',
    contentText: input.rawText,
    byteLength: new TextEncoder().encode(input.rawText).byteLength,
    rowsSeen: parsed.rowsSeen,
    rowsIgnored: parsed.rowsIgnored,
    records: parsed.records.map((record) => ({ ...record, id: idFactory() })),
    now,
  });
}

export async function importManualBook(
  database: Database,
  input: {
    readonly householdId: string;
    readonly sourceAccountId: string;
    readonly title: string;
    readonly author?: string;
    readonly isbn?: string;
    readonly format?: string;
    readonly idFactory?: () => string;
    readonly now?: () => Date;
  },
): Promise<{ readonly workId: string }> {
  const title = input.title.trim();
  if (!title) throw new Error('A title is required');
  const idFactory = input.idFactory ?? (() => crypto.randomUUID());
  const now = (input.now ?? (() => new Date()))().toISOString();
  const recordId = idFactory();
  const author = input.author?.trim();
  const isbn = input.isbn?.toUpperCase().replaceAll(/[^0-9X]/gu, '') || undefined;
  const sourceKey = `manual:v1:${encodeURIComponent(title.toLocaleLowerCase('en-US'))}:${encodeURIComponent(author?.toLocaleLowerCase('en-US') ?? '')}:${isbn ?? ''}`;
  await ensureImportContext(database, {
    sourceAccountId: input.sourceAccountId,
    householdId: input.householdId,
    kind: 'manual',
    label: 'Manual books',
    now,
  });
  await importNormalizedRecords(database, {
    sourceAccountId: input.sourceAccountId,
    blobId: idFactory(),
    runId: idFactory(),
    blobSha256: await sha256Hex(sourceKey),
    mediaType: 'application/vnd.read-it-again.manual+json',
    contentText: JSON.stringify({ title, author, isbn, format: input.format }),
    byteLength: new TextEncoder().encode(sourceKey).byteLength,
    rowsSeen: 1,
    rowsIgnored: 0,
    records: [
      {
        id: recordId,
        sourceKey,
        normalizationVersion: 1,
        rawPayloadJson: JSON.stringify({ title, author, isbn, format: input.format }),
        title,
        authorsJson: JSON.stringify(
          author
            ? [{ display: author, raw: author, family: author.split(/\s+/u).at(-1) ?? author }]
            : [],
        ),
        isbn,
        sourceFormat: input.format,
        occurredAt: now,
      },
    ],
    now,
  });
  const storedRecord = (
    await database.query<{ id: string }>(
      'SELECT id FROM import_records WHERE source_account_id = ? AND source_key = ?',
      [input.sourceAccountId, sourceKey],
    )
  )[0];
  if (!storedRecord) throw new Error('Manual book was not stored');
  const existing = await database.query<{ id: string }>(
    'SELECT id FROM resolution_cases WHERE import_record_id = ?',
    [storedRecord.id],
  );
  if (!existing[0]) {
    const workId = idFactory();
    const resolutionCase = await ensureResolutionCase(database, {
      id: idFactory(),
      importRecordId: storedRecord.id,
      cacheKey: sourceKey,
      algorithmVersion: 'manual-v1',
      now,
    });
    await createManualResolution(database, {
      caseId: resolutionCase.id,
      decisionId: idFactory(),
      workId,
      editionId: idFactory(),
      title,
      authorsJson: JSON.stringify(author ? [{ display: author }] : []),
      now,
    });
    await rebuildReadingModel(database, { idFactory, now: () => new Date(now) });
    return { workId };
  }
  await rebuildReadingModel(database, { idFactory, now: () => new Date(now) });
  const resolved = (
    await database.query<{ work_id: string }>(
      `SELECT e.work_id FROM resolution_cases c
       JOIN resolution_decisions d ON d.resolution_case_id = c.id AND d.current = 1
       JOIN editions e ON e.id = d.edition_id WHERE c.import_record_id = ?`,
      [storedRecord.id],
    )
  )[0];
  if (!resolved) throw new Error('Manual book resolution is missing');
  return { workId: resolved.work_id };
}

export async function getHouseholdImportInbox(database: Database) {
  return { records: await listImportRecords(database), runs: await listImportRuns(database) };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
