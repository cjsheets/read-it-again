import { parseLibbySnapshot } from '@read-it-again/adapter-libby';
import {
  ensureDefaultImportContext,
  importNormalizedRecords,
  listImportRecords,
  listImportRuns,
  type Database,
  type ImportBatchResult,
  type ImportRecord,
  type ImportRun,
} from '@read-it-again/storage-schema';

export interface ImportLibbySnapshotInput {
  readonly rawText: string;
  readonly fileName?: string;
  readonly sourceAccountId: string;
  readonly householdId: string;
  readonly idFactory?: () => string;
  readonly now?: () => Date;
}

export interface ImportInbox {
  readonly records: readonly ImportRecord[];
  readonly runs: readonly ImportRun[];
}

export async function importLibbySnapshot(
  database: Database,
  input: ImportLibbySnapshotInput,
): Promise<ImportBatchResult> {
  // Validation is deliberately complete before any database write begins.
  const parsed = parseLibbySnapshot(input.rawText);
  const idFactory = input.idFactory ?? (() => crypto.randomUUID());
  const timestamp = (input.now ?? (() => new Date()))().toISOString();
  const bytes = new TextEncoder().encode(input.rawText);
  const blobSha256 = await sha256Hex(input.rawText);

  await ensureDefaultImportContext(
    database,
    { householdId: input.householdId, sourceAccountId: input.sourceAccountId },
    timestamp,
  );

  return importNormalizedRecords(database, {
    sourceAccountId: input.sourceAccountId,
    blobId: idFactory(),
    runId: idFactory(),
    blobSha256,
    fileName: input.fileName,
    mediaType: 'application/json',
    contentText: input.rawText,
    byteLength: bytes.byteLength,
    rowsSeen: parsed.rowsSeen,
    rowsIgnored: parsed.rowsIgnored,
    records: parsed.records.map((record) => ({ ...record, id: idFactory() })),
    now: timestamp,
  });
}

export async function getImportInbox(
  database: Database,
  sourceAccountId: string,
): Promise<ImportInbox> {
  const [records, runs] = await Promise.all([
    listImportRecords(database, sourceAccountId),
    listImportRuns(database, sourceAccountId),
  ]);
  return { records, runs };
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
