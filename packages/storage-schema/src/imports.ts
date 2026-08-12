import type { Database } from './database.js';
import { inTransaction } from './database.js';

export interface DefaultImportContext {
  readonly householdId: string;
  readonly sourceAccountId: string;
}

export interface NormalizedImportRecord {
  readonly sourceKey: string;
  readonly normalizationVersion: number;
  readonly rawPayloadJson: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly authorsJson: string;
  readonly sourceFormat?: string;
  readonly isbn?: string;
  readonly editionIdentifierNamespace?: string;
  readonly editionIdentifierValue?: string;
  readonly callNumber?: string;
  readonly occurredAt: string;
  readonly details?: string;
}

export interface ImportBatch {
  readonly sourceAccountId: string;
  readonly blobId: string;
  readonly runId: string;
  readonly blobSha256: string;
  readonly fileName?: string;
  readonly mediaType: string;
  readonly contentText: string;
  readonly byteLength: number;
  readonly rowsSeen: number;
  readonly rowsIgnored: number;
  readonly records: readonly (NormalizedImportRecord & { readonly id: string })[];
  readonly now: string;
}

export interface ImportBatchResult {
  readonly runId: string;
  readonly rowsSeen: number;
  readonly rowsNew: number;
  readonly rowsIgnored: number;
  readonly reusedSnapshot: boolean;
}

export interface ImportRecord {
  readonly id: string;
  readonly title: string;
  readonly authorsJson: string;
  readonly sourceFormat: string | null;
  readonly isbn: string | null;
  readonly occurredAt: string;
  readonly sourceKey: string;
}

export interface ImportRun {
  readonly id: string;
  readonly rowsSeen: number;
  readonly rowsNew: number;
  readonly rowsIgnored: number;
  readonly finishedAt: string;
  readonly fileName: string | null;
}

export async function ensureDefaultImportContext(
  database: Database,
  context: DefaultImportContext,
  now: string,
): Promise<void> {
  await inTransaction(database, async () => {
    await database.run('INSERT OR IGNORE INTO households (id, name, created_at) VALUES (?, ?, ?)', [
      context.householdId,
      'My Household',
      now,
    ]);
    await database.run(
      `INSERT OR IGNORE INTO source_accounts
       (id, household_id, kind, label, retention_horizon, config_json, created_at)
       VALUES (?, ?, 'libby', 'Libby Timeline', 'years:6', '{}', ?)`,
      [context.sourceAccountId, context.householdId, now],
    );
  });
}

export async function importNormalizedRecords(
  database: Database,
  batch: ImportBatch,
): Promise<ImportBatchResult> {
  return inTransaction(database, async () => {
    await database.run(
      `INSERT INTO import_blobs
       (id, source_account_id, sha256, file_name, media_type, content_text, byte_length, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (source_account_id, sha256) DO NOTHING`,
      [
        batch.blobId,
        batch.sourceAccountId,
        batch.blobSha256,
        batch.fileName ?? null,
        batch.mediaType,
        batch.contentText,
        batch.byteLength,
        batch.now,
      ],
    );

    const blob = await database.query<{ id: string }>(
      'SELECT id FROM import_blobs WHERE source_account_id = ? AND sha256 = ?',
      [batch.sourceAccountId, batch.blobSha256],
    );
    const importBlobId = blob[0]?.id;
    if (!importBlobId) throw new Error('Import snapshot was not stored');
    const reusedSnapshot = importBlobId !== batch.blobId;

    const before = await database.query<{ count: number }>(
      'SELECT count(*) AS count FROM import_records WHERE source_account_id = ?',
      [batch.sourceAccountId],
    );

    await database.run(
      `INSERT INTO import_runs
       (id, source_account_id, import_blob_id, status, rows_seen, rows_new, rows_ignored,
        file_name, started_at, finished_at)
       VALUES (?, ?, ?, 'completed', ?, 0, ?, ?, ?, ?)`,
      [
        batch.runId,
        batch.sourceAccountId,
        importBlobId,
        batch.rowsSeen,
        batch.rowsIgnored,
        batch.fileName ?? null,
        batch.now,
        batch.now,
      ],
    );

    for (const record of batch.records) {
      await database.run(
        `INSERT INTO import_records
         (id, source_account_id, first_import_run_id, source_key, normalization_version,
          raw_payload_json, title, subtitle, authors_json, source_format, isbn,
          edition_identifier_namespace, edition_identifier_value, call_number, occurred_at,
          details, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (source_account_id, source_key) DO NOTHING`,
        [
          record.id,
          batch.sourceAccountId,
          batch.runId,
          record.sourceKey,
          record.normalizationVersion,
          record.rawPayloadJson,
          record.title,
          record.subtitle ?? null,
          record.authorsJson,
          record.sourceFormat ?? null,
          record.isbn ?? null,
          record.editionIdentifierNamespace ?? null,
          record.editionIdentifierValue ?? null,
          record.callNumber ?? null,
          record.occurredAt,
          record.details ?? null,
          batch.now,
        ],
      );
    }

    const after = await database.query<{ count: number }>(
      'SELECT count(*) AS count FROM import_records WHERE source_account_id = ?',
      [batch.sourceAccountId],
    );
    const rowsNew = (after[0]?.count ?? 0) - (before[0]?.count ?? 0);
    await database.run('UPDATE import_runs SET rows_new = ? WHERE id = ?', [rowsNew, batch.runId]);

    return {
      runId: batch.runId,
      rowsSeen: batch.rowsSeen,
      rowsNew,
      rowsIgnored: batch.rowsIgnored,
      reusedSnapshot,
    };
  });
}

export async function listImportRecords(
  database: Database,
  sourceAccountId: string,
): Promise<readonly ImportRecord[]> {
  const rows = await database.query<{
    id: string;
    title: string;
    authors_json: string;
    source_format: string | null;
    isbn: string | null;
    occurred_at: string;
    source_key: string;
  }>(
    `SELECT id, title, authors_json, source_format, isbn, occurred_at, source_key
     FROM import_records
     WHERE source_account_id = ?
     ORDER BY occurred_at DESC, id`,
    [sourceAccountId],
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    authorsJson: row.authors_json,
    sourceFormat: row.source_format,
    isbn: row.isbn,
    occurredAt: row.occurred_at,
    sourceKey: row.source_key,
  }));
}

export async function listImportRuns(
  database: Database,
  sourceAccountId: string,
): Promise<readonly ImportRun[]> {
  const rows = await database.query<{
    id: string;
    rows_seen: number;
    rows_new: number;
    rows_ignored: number;
    finished_at: string;
    file_name: string | null;
  }>(
    `SELECT r.id, r.rows_seen, r.rows_new, r.rows_ignored, r.finished_at, r.file_name
     FROM import_runs r
     WHERE r.source_account_id = ?
     ORDER BY r.finished_at DESC, r.id DESC`,
    [sourceAccountId],
  );
  return rows.map((row) => ({
    id: row.id,
    rowsSeen: row.rows_seen,
    rowsNew: row.rows_new,
    rowsIgnored: row.rows_ignored,
    finishedAt: row.finished_at,
    fileName: row.file_name,
  }));
}
