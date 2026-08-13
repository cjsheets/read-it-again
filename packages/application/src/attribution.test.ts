import { afterEach, describe, expect, it } from 'vitest';
import type { CatalogMetadata } from '@read-it-again/domain';
import { NodeSqliteDatabase } from '@read-it-again/storage-node';
import { listAttributionTriage, migrate } from '@read-it-again/storage-schema';
import { correctAttribution, enrichResolvedCatalogRecords } from './attribution.js';

describe('enrichment and attribution workflow', () => {
  let database: NodeSqliteDatabase | undefined;
  afterEach(async () => database?.close());

  it('enriches once, reviews ambiguity, and applies scoped multi-reader corrections', async () => {
    database = new NodeSqliteDatabase();
    await migrate(database);
    await seedSharedResolvedHistory(database);
    let sequence = 0;
    const idFactory = () => `phase4-${String(sequence++).padStart(3, '0')}`;
    const metadata: CatalogMetadata = {
      audience: 'b',
      juvenileHeading: true,
      subjects: ['Kites -- Juvenile fiction'],
      genres: ['Picture books'],
      contributors: [{ name: 'River, Sam', role: 'illustrator' }],
      pageCount: 32,
      callNumber: 'E NORTH',
      summary: 'A quiet kite story.',
      series: [{ name: 'Moonlit adventures', volume: '1' }],
    };
    let calls = 0;
    const catalog = {
      getMarcMetadata: async () => {
        calls += 1;
        return metadata;
      },
    };

    await expect(
      enrichResolvedCatalogRecords(database, catalog, {
        idFactory,
        now: () => new Date('2026-08-13T12:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ editionsEnriched: 1, attributionResultsChanged: 2 });
    expect(calls).toBe(1);
    expect(await listAttributionTriage(database)).toHaveLength(2);
    await expect(
      enrichResolvedCatalogRecords(database, catalog, { idFactory }),
    ).resolves.toMatchObject({ editionsEnriched: 0, attributionResultsChanged: 0 });
    expect(calls).toBe(1);

    await correctAttribution(database, {
      scope: 'work',
      workId: 'work',
      state: 'assigned',
      readerIds: ['child-a', 'child-b'],
      note: 'Both children share this title',
      idFactory,
      now: () => new Date('2026-08-13T13:00:00.000Z'),
    });
    expect(await currentStates(database)).toEqual([
      { import_record_id: 'record-1', state: 'assigned', method: 'work_override', reader_count: 2 },
      { import_record_id: 'record-2', state: 'assigned', method: 'work_override', reader_count: 2 },
    ]);

    await correctAttribution(database, {
      scope: 'checkout',
      importRecordId: 'record-1',
      state: 'excluded',
      readerIds: [],
      note: 'This checkout was for an adult',
      idFactory,
      now: () => new Date('2026-08-13T14:00:00.000Z'),
    });
    expect(await currentStates(database)).toEqual([
      {
        import_record_id: 'record-1',
        state: 'excluded',
        method: 'checkout_override',
        reader_count: 0,
      },
      { import_record_id: 'record-2', state: 'assigned', method: 'work_override', reader_count: 2 },
    ]);
    expect(
      (await database.query<{ count: number }>('SELECT count(*) AS count FROM derived_rebuilds'))[0]
        ?.count,
    ).toBe(0);
    expect(
      (
        await database.query<{ raw_payload_json: string }>(
          'SELECT raw_payload_json FROM import_records WHERE id = ?',
          ['record-1'],
        )
      )[0]?.raw_payload_json,
    ).toBe('{"immutable":true}');
    expect(
      await database.query<{ checkout_count: number }>(
        'SELECT checkout_count FROM acquisition_episodes ORDER BY window_start',
      ),
    ).toEqual([{ checkout_count: 1 }, { checkout_count: 1 }]);
  });
});

async function seedSharedResolvedHistory(database: NodeSqliteDatabase): Promise<void> {
  const now = '2026-08-13T10:00:00.000Z';
  await database.exec(`
    INSERT INTO households (id, name, created_at) VALUES ('household', 'Family', '${now}');
    INSERT INTO people (id, household_id, display_name, created_at) VALUES
      ('child-a', 'household', 'A', '${now}'), ('child-b', 'household', 'B', '${now}');
    INSERT INTO reader_profiles (person_id, kind, created_at) VALUES
      ('child-a', 'child', '${now}'), ('child-b', 'child', '${now}');
    INSERT INTO source_accounts (id, household_id, kind, label, config_json, created_at)
      VALUES ('source', 'household', 'libby', 'Shared Libby', '{}', '${now}');
    INSERT INTO import_blobs (id, source_account_id, sha256, media_type, content_text, byte_length, created_at)
      VALUES ('blob', 'source', '${'0'.repeat(64)}', 'application/json', '[]', 2, '${now}');
    INSERT INTO import_runs (id, source_account_id, import_blob_id, status, rows_seen, rows_new, rows_ignored, started_at, finished_at)
      VALUES ('run', 'source', 'blob', 'completed', 2, 2, 0, '${now}', '${now}');
    INSERT INTO import_records (id, source_account_id, first_import_run_id, source_key, normalization_version, raw_payload_json, title, authors_json, source_format, occurred_at, created_at) VALUES
      ('record-1', 'source', 'run', 'one', 1, '{"immutable":true}', 'Moonlit Kite', '[]', 'ebook', '${now}', '${now}'),
      ('record-2', 'source', 'run', 'two', 1, '{}', 'Moonlit Kite', '[]', 'ebook', '2026-08-14T10:00:00.000Z', '${now}');
    INSERT INTO works (id, canonical_title, created_at) VALUES ('work', 'Moonlit Kite', '${now}');
    INSERT INTO editions (id, work_id, title, authors_json, created_at) VALUES ('edition', 'work', 'Moonlit Kite', '[]', '${now}');
    INSERT INTO external_identifiers (id, entity_kind, entity_id, namespace, value, source, confidence, created_at)
      VALUES ('identifier', 'edition', 'edition', 'kcls-bibid', '101', 'kcls', 1, '${now}');
    INSERT INTO resolution_cases (id, import_record_id, cache_key, status, algorithm_version, created_at, updated_at) VALUES
      ('case-1', 'record-1', 'shape', 'resolved', 'v1', '${now}', '${now}'),
      ('case-2', 'record-2', 'shape', 'resolved', 'v1', '${now}', '${now}');
    INSERT INTO resolution_decisions (id, resolution_case_id, action, edition_id, method, confidence, current, created_at) VALUES
      ('decision-1', 'case-1', 'accept', 'edition', 'manual', 1, 1, '${now}'),
      ('decision-2', 'case-2', 'accept', 'edition', 'manual', 1, 1, '${now}');
  `);
}

async function currentStates(database: NodeSqliteDatabase) {
  return database.query<{
    import_record_id: string;
    state: string;
    method: string;
    reader_count: number;
  }>(
    `SELECT a.import_record_id, a.state, a.method, count(ar.person_id) AS reader_count
     FROM attribution_results a LEFT JOIN attribution_result_readers ar ON ar.attribution_result_id = a.id
     WHERE a.current = 1 GROUP BY a.id ORDER BY a.import_record_id`,
  );
}
