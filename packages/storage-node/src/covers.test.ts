import { afterEach, describe, expect, it } from 'vitest';
import {
  enqueueMissingCatalogCovers,
  finishCatalogCoverFetch,
  listCoverIsbns,
  migrate,
  nextCatalogCoverFetch,
} from '@read-it-again/storage-schema';
import { NodeSqliteDatabase } from './database.js';

describe('catalog cover identifiers', () => {
  let database: NodeSqliteDatabase | undefined;
  afterEach(async () => database?.close());

  it('finds ISBNs from both source records and accepted catalog candidates', async () => {
    database = new NodeSqliteDatabase();
    await migrate(database);
    const now = '2026-08-16T12:00:00.000Z';
    await database.exec(`
      INSERT INTO households (id, name, created_at) VALUES ('h', 'Household', '${now}');
      INSERT INTO source_accounts
        (id, household_id, kind, label, config_json, created_at)
        VALUES ('source', 'h', 'csv', 'CSV', '{}', '${now}');
      INSERT INTO import_blobs
        (id, source_account_id, sha256, media_type, content_text, byte_length, created_at)
        VALUES ('blob', 'source', '${'0'.repeat(64)}', 'text/csv', 'x', 1, '${now}');
      INSERT INTO import_runs
        (id, source_account_id, import_blob_id, status, rows_seen, rows_new, rows_ignored,
         started_at, finished_at)
        VALUES ('run', 'source', 'blob', 'completed', 1, 1, 0, '${now}', '${now}');
      INSERT INTO import_records
        (id, source_account_id, first_import_run_id, source_key, normalization_version,
         raw_payload_json, title, authors_json, isbn, occurred_at, created_at)
        VALUES ('record', 'source', 'run', 'key', 1, '{}', 'Book', '[]', '0306406152',
                '${now}', '${now}');
      INSERT INTO works (id, canonical_title, created_at) VALUES ('work', 'Book', '${now}');
      INSERT INTO editions (id, work_id, title, authors_json, created_at)
        VALUES ('edition', 'work', 'Book', '[]', '${now}');
      INSERT INTO resolution_cases
        (id, import_record_id, cache_key, status, algorithm_version, created_at, updated_at)
        VALUES ('case', 'record', 'shape', 'resolved', 'v1', '${now}', '${now}');
      INSERT INTO resolution_candidates
        (id, resolution_case_id, catalog_namespace, catalog_key, rank, total_score, margin,
         score_json, snapshot_json, created_at)
        VALUES ('candidate', 'case', 'kcls-bibid', '1', 1, 1, 1, '{}',
                '{"isbns":["9780333710937"]}', '${now}');
      INSERT INTO resolution_decisions
        (id, resolution_case_id, action, edition_id, candidate_id, method, confidence, current,
         created_at)
        VALUES ('decision', 'case', 'accept', 'edition', 'candidate', 'isbn', 1, 1, '${now}');
    `);

    await expect(listCoverIsbns(database, 'work')).resolves.toEqual([
      '0306406152',
      '9780306406157',
      '9780333710937',
      '0333710932',
    ]);

    await expect(enqueueMissingCatalogCovers(database, now)).resolves.toBe(1);
    await expect(nextCatalogCoverFetch(database, now)).resolves.toEqual({
      workId: 'work',
      isbn: '0306406152',
    });
    await finishCatalogCoverFetch(database, 'work', 'not_found', now);
    await expect(enqueueMissingCatalogCovers(database, now)).resolves.toBe(0);
    await expect(nextCatalogCoverFetch(database, now)).resolves.toBeUndefined();
  });
});
