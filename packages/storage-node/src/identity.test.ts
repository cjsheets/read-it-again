import { afterEach, describe, expect, it } from 'vitest';
import {
  mergeWorks,
  migrate,
  repointResolution,
  splitEditionToWork,
} from '@read-it-again/storage-schema';
import { NodeSqliteDatabase } from './database.js';

describe('identity operations', () => {
  let database: NodeSqliteDatabase | undefined;
  afterEach(async () => database?.close());

  it('merges and splits editions transactionally with an audit trail', async () => {
    database = new NodeSqliteDatabase();
    await migrate(database);
    const now = '2026-08-12T12:00:00.000Z';
    await database.run(
      `INSERT INTO works (id, canonical_title, created_at) VALUES ('w1', 'One', ?)`,
      [now],
    );
    await database.run(
      `INSERT INTO works (id, canonical_title, created_at) VALUES ('w2', 'Two', ?)`,
      [now],
    );
    await database.run(
      `INSERT INTO editions (id, work_id, title, authors_json, created_at) VALUES ('e2', 'w2', 'Two', '[]', ?)`,
      [now],
    );

    await mergeWorks(database, {
      survivorWorkId: 'w1',
      mergedWorkId: 'w2',
      operationId: 'op1',
      now,
    });
    expect(
      (
        await database.query<{ work_id: string }>('SELECT work_id FROM editions WHERE id = ?', [
          'e2',
        ])
      )[0]?.work_id,
    ).toBe('w1');
    await splitEditionToWork(database, {
      editionId: 'e2',
      newWorkId: 'w3',
      title: 'Two',
      operationId: 'op2',
      now,
    });
    expect(
      (
        await database.query<{ work_id: string }>('SELECT work_id FROM editions WHERE id = ?', [
          'e2',
        ])
      )[0]?.work_id,
    ).toBe('w3');
    expect(
      (
        await database.query<{ count: number }>('SELECT count(*) AS count FROM identity_operations')
      )[0]?.count,
    ).toBe(2);
  });

  it('re-points a resolution without deleting the prior decision', async () => {
    database = new NodeSqliteDatabase();
    await migrate(database);
    const now = '2026-08-12T12:00:00.000Z';
    await database.exec(`
      INSERT INTO households (id, name, created_at) VALUES ('h', 'Household', '${now}');
      INSERT INTO source_accounts
        (id, household_id, kind, label, config_json, created_at)
        VALUES ('s', 'h', 'manual', 'Manual', '{}', '${now}');
      INSERT INTO import_blobs
        (id, source_account_id, sha256, media_type, content_text, byte_length, created_at)
        VALUES ('b', 's', '${'0'.repeat(64)}', 'application/json', '[]', 2, '${now}');
      INSERT INTO import_runs
        (id, source_account_id, import_blob_id, status, rows_seen, rows_new, rows_ignored,
         started_at, finished_at)
        VALUES ('r', 's', 'b', 'completed', 1, 1, 0, '${now}', '${now}');
      INSERT INTO import_records
        (id, source_account_id, first_import_run_id, source_key, normalization_version,
         raw_payload_json, title, authors_json, occurred_at, created_at)
        VALUES ('ir', 's', 'r', 'key', 1, '{}', 'Book', '[]', '${now}', '${now}');
      INSERT INTO works (id, canonical_title, created_at) VALUES ('wa', 'A', '${now}');
      INSERT INTO works (id, canonical_title, created_at) VALUES ('wb', 'B', '${now}');
      INSERT INTO editions (id, work_id, title, authors_json, created_at)
        VALUES ('ea', 'wa', 'A', '[]', '${now}');
      INSERT INTO editions (id, work_id, title, authors_json, created_at)
        VALUES ('eb', 'wb', 'B', '[]', '${now}');
      INSERT INTO resolution_cases
        (id, import_record_id, cache_key, status, algorithm_version, created_at, updated_at)
        VALUES ('case', 'ir', 'cache', 'resolved', 'v1', '${now}', '${now}');
      INSERT INTO resolution_decisions
        (id, resolution_case_id, action, edition_id, method, confidence, current, created_at)
        VALUES ('old', 'case', 'accept', 'ea', 'manual', 1, 1, '${now}');
    `);

    await repointResolution(database, {
      caseId: 'case',
      decisionId: 'new',
      editionId: 'eb',
      operationId: 'op',
      now,
    });
    const decisions = await database.query<{
      id: string;
      edition_id: string;
      supersedes_decision_id: string | null;
      current: number;
    }>(
      `SELECT id, edition_id, supersedes_decision_id, current FROM resolution_decisions ORDER BY id`,
    );
    expect(decisions).toEqual([
      { id: 'new', edition_id: 'eb', supersedes_decision_id: 'old', current: 1 },
      { id: 'old', edition_id: 'ea', supersedes_decision_id: null, current: 0 },
    ]);
  });
});
