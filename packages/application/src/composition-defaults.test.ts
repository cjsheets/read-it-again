import { afterEach, describe, expect, it } from 'vitest';
import { NodeSqliteDatabase } from '@read-it-again/storage-node';
import { migrate } from '@read-it-again/storage-schema';
import { correctAttribution, recomputeAttributions } from './attribution.js';
import { AUTOMATIC_RESOLUTION_CONFIDENCE } from './composition-defaults.js';
import { prepareResolutionQueue } from './resolution.js';

/**
 * ADR 0012. These defaults exist only for a composition with no catalog. They must
 * close the import loop (F-01) without weakening the audit trail: every automatic
 * decision stays append-only and a human choice supersedes rather than replaces it.
 */
const NO_CATALOG = {
  searchByIsbn: async () => [],
  searchByTitleAuthor: async () => [],
};
const BROWSER = { acceptSourceDetails: true, assignSingleReader: true } as const;

describe('composition defaults', () => {
  let database: NodeSqliteDatabase | undefined;
  afterEach(async () => database?.close());

  it('lands a record on the shelf with no human decision, and says it was automatic', async () => {
    database = new NodeSqliteDatabase();
    await migrate(database);
    await seedOneReaderHousehold(database);

    const result = await prepareResolutionQueue(database, NO_CATALOG, {
      idFactory: sequentialIds(),
      now: () => new Date('2026-08-16T10:00:00.000Z'),
      defaults: BROWSER,
    });

    expect(result.automaticallyResolved).toBe(1);
    expect(result.queue).toEqual([]);

    const [attribution] = await database.query<{
      state: string;
      method: string;
      explanation: string;
      reader_count: number;
    }>(
      `SELECT a.state, a.method, a.explanation, count(ar.person_id) AS reader_count
       FROM attribution_results a
       LEFT JOIN attribution_result_readers ar ON ar.attribution_result_id = a.id
       WHERE a.current = 1 GROUP BY a.id`,
    );
    expect(attribution?.state).toBe('assigned');
    expect(attribution?.method).toBe('evidence_rules');
    expect(attribution?.reader_count).toBe(1);
    expect(attribution?.explanation).toContain('automatically');

    // The resolution is distinguishable from a human one without a schema change.
    const [decision] = await database.query<{ method: string; confidence: number }>(
      `SELECT method, confidence FROM resolution_decisions WHERE current = 1`,
    );
    expect(decision?.confidence).toBe(AUTOMATIC_RESOLUTION_CONFIDENCE);
  });

  it('is idempotent, so repeated recomputes do not churn the audit trail', async () => {
    database = new NodeSqliteDatabase();
    await migrate(database);
    await seedOneReaderHousehold(database);
    const options = {
      idFactory: sequentialIds(),
      now: () => new Date('2026-08-16T10:00:00.000Z'),
      defaults: BROWSER,
    };
    await prepareResolutionQueue(database, NO_CATALOG, options);

    const before = await countResults(database);
    await recomputeAttributions(database, { defaults: BROWSER });
    await recomputeAttributions(database, { defaults: BROWSER });

    expect(await countResults(database)).toBe(before);
  });

  it('lets a human choice supersede an automatic one without deleting it', async () => {
    database = new NodeSqliteDatabase();
    await migrate(database);
    await seedOneReaderHousehold(database);
    await prepareResolutionQueue(database, NO_CATALOG, {
      idFactory: sequentialIds(),
      now: () => new Date('2026-08-16T10:00:00.000Z'),
      defaults: BROWSER,
    });

    await correctAttribution(database, {
      scope: 'checkout',
      importRecordId: 'record-1',
      state: 'excluded',
      readerIds: [],
      note: 'This one was mine, not hers',
      defaults: BROWSER,
    });

    const rows = await database.query<{
      state: string;
      method: string;
      current: number;
      supersedes_result_id: string | null;
    }>(
      `SELECT state, method, current, supersedes_result_id FROM attribution_results
       ORDER BY created_at, rowid`,
    );
    const current = rows.filter((row) => row.current === 1);
    expect(current).toHaveLength(1);
    expect(current[0]?.state).toBe('excluded');
    expect(current[0]?.method).toBe('checkout_override');
    // The automatic decision is still on record, and the correction points at it.
    expect(rows.length).toBeGreaterThan(1);
    expect(current[0]?.supersedes_result_id).not.toBeNull();
  });

  it('leaves the queue alone when the composition passes no defaults', async () => {
    database = new NodeSqliteDatabase();
    await migrate(database);
    await seedOneReaderHousehold(database);

    const result = await prepareResolutionQueue(database, NO_CATALOG, {
      idFactory: sequentialIds(),
      now: () => new Date('2026-08-16T10:00:00.000Z'),
    });

    expect(result.automaticallyResolved).toBe(0);
    expect(result.queue).toHaveLength(1);
  });
});

function sequentialIds(): () => string {
  let sequence = 0;
  return () => `auto-${String(sequence++).padStart(3, '0')}`;
}

async function countResults(database: NodeSqliteDatabase): Promise<number> {
  const [row] = await database.query<{ total: number }>(
    'SELECT count(*) AS total FROM attribution_results',
  );
  return row?.total ?? 0;
}

async function seedOneReaderHousehold(database: NodeSqliteDatabase): Promise<void> {
  const now = '2026-08-16T09:00:00.000Z';
  await database.exec(`
    INSERT INTO households (id, name, created_at) VALUES ('household', 'Family', '${now}');
    INSERT INTO people (id, household_id, display_name, created_at)
      VALUES ('only-child', 'household', 'Child', '${now}');
    INSERT INTO reader_profiles (person_id, kind, created_at)
      VALUES ('only-child', 'child', '${now}');
    INSERT INTO source_accounts (id, household_id, kind, label, config_json, created_at)
      VALUES ('source', 'household', 'csv', 'Spreadsheet', '{}', '${now}');
    INSERT INTO import_blobs (id, source_account_id, sha256, media_type, content_text, byte_length, created_at)
      VALUES ('blob', 'source', '${'0'.repeat(64)}', 'text/csv', 'x', 1, '${now}');
    INSERT INTO import_runs (id, source_account_id, import_blob_id, status, rows_seen, rows_new, rows_ignored, started_at, finished_at)
      VALUES ('run', 'source', 'blob', 'completed', 1, 1, 0, '${now}', '${now}');
    INSERT INTO import_records (id, source_account_id, first_import_run_id, source_key, normalization_version, raw_payload_json, title, authors_json, source_format, occurred_at, created_at)
      VALUES ('record-1', 'source', 'run', 'one', 1, '{}', 'The Gruffalo', '[{"display":"Julia Donaldson"}]', 'book', '${now}', '${now}');
  `);
}
