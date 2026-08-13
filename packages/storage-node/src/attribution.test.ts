import { afterEach, describe, expect, it } from 'vitest';
import {
  applyExclusiveCardAttribution,
  ensureExclusiveCardContext,
  migrate,
  overrideAttribution,
} from '@read-it-again/storage-schema';
import { NodeSqliteDatabase } from './database.js';

describe('attribution decisions', () => {
  let database: NodeSqliteDatabase | undefined;
  afterEach(async () => database?.close());

  it('preserves deterministic history when a human later corrects it', async () => {
    database = new NodeSqliteDatabase();
    await migrate(database);
    const now = '2026-08-12T12:00:00.000Z';
    await ensureExclusiveCardContext(
      database,
      {
        householdId: 'h',
        personId: 'child',
        personName: 'Child',
        cardId: 'card',
        cardLabel: 'Child card',
        sourceAccountId: 'source',
      },
      now,
    );
    await database.exec(`
      INSERT INTO import_blobs
        (id, source_account_id, sha256, media_type, content_text, byte_length, created_at)
        VALUES ('blob', 'source', '${'0'.repeat(64)}', 'text/html', 'x', 1, '${now}');
      INSERT INTO import_runs
        (id, source_account_id, import_blob_id, status, rows_seen, rows_new, rows_ignored,
         started_at, finished_at)
        VALUES ('run', 'source', 'blob', 'completed', 1, 1, 0, '${now}', '${now}');
      INSERT INTO import_records
        (id, source_account_id, first_import_run_id, source_key, normalization_version,
         raw_payload_json, title, authors_json, occurred_at, created_at)
        VALUES ('record', 'source', 'run', 'key', 1, '{}', 'Book', '[]', '${now}', '${now}');
      INSERT INTO works (id, canonical_title, created_at) VALUES ('work', 'Book', '${now}');
      INSERT INTO editions (id, work_id, title, authors_json, created_at)
        VALUES ('edition', 'work', 'Book', '[]', '${now}');
      INSERT INTO resolution_cases
        (id, import_record_id, cache_key, status, algorithm_version, created_at, updated_at)
        VALUES ('case', 'record', 'shape', 'resolved', 'v1', '${now}', '${now}');
      INSERT INTO resolution_decisions
        (id, resolution_case_id, action, edition_id, method, confidence, current, created_at)
        VALUES ('resolution', 'case', 'accept', 'edition', 'manual', 1, 1, '${now}');
    `);
    await expect(
      applyExclusiveCardAttribution(database, { idFactory: () => 'automatic', now }),
    ).resolves.toBe(1);
    await overrideAttribution(database, {
      id: 'correction',
      importRecordId: 'record',
      personId: null,
      note: 'Not for this reader',
      now: '2026-08-13T12:00:00.000Z',
    });

    expect(
      await database.query<{
        id: string;
        method: string;
        supersedes_decision_id: string | null;
        current: number;
      }>(
        `SELECT id, method, supersedes_decision_id, current
         FROM attribution_decisions ORDER BY created_at`,
      ),
    ).toEqual([
      { id: 'automatic', method: 'exclusive_card', supersedes_decision_id: null, current: 0 },
      {
        id: 'correction',
        method: 'override',
        supersedes_decision_id: 'automatic',
        current: 1,
      },
    ]);
    await expect(applyExclusiveCardAttribution(database)).resolves.toBe(0);
  });
});
