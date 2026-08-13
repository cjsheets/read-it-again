import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { CatalogCandidate } from '@read-it-again/domain';
import { NodeSqliteDatabase } from '@read-it-again/storage-node';
import { migrate } from '@read-it-again/storage-schema';
import { importLibbySnapshot } from './libby-import.js';
import { createManualWorkForCase, prepareResolutionQueue, rejectCase } from './resolution.js';

const fixture = fileURLToPath(new URL('../../test-fixtures/libby/timeline.json', import.meta.url));

describe('resolution workflow', () => {
  let database: NodeSqliteDatabase | undefined;
  afterEach(async () => database?.close());

  it('auto-resolves an exact ISBN and queues a zero-hit record', async () => {
    database = new NodeSqliteDatabase();
    await migrate(database);
    let sequence = 0;
    const idFactory = () => `resolution-${String(sequence++).padStart(3, '0')}`;
    await importLibbySnapshot(database, {
      rawText: await readFile(fixture, 'utf8'),
      householdId: 'household-resolution',
      sourceAccountId: 'source-resolution',
      idFactory,
      now: () => new Date('2026-08-12T12:00:00.000Z'),
    });
    const exact: CatalogCandidate = {
      catalogKey: '101',
      title: 'The Moonlit Kite',
      authorDisplays: ['North, Riley'],
      isbns: ['9780000000101'],
      format: 'ebook',
    };
    const catalog = {
      searchByIsbn: async (isbn: string) => (isbn === '9780000000101' ? [exact] : []),
      searchByTitleAuthor: async () => [],
    };

    const result = await prepareResolutionQueue(database, catalog, {
      idFactory,
      now: () => new Date('2026-08-12T12:01:00.000Z'),
    });
    expect(result).toMatchObject({
      casesCreated: 2,
      cacheHits: 0,
      automaticallyResolved: 1,
      pending: 1,
    });
    expect(result.queue[0]?.title).toBe('Bear Counts the Stars');

    const resolved = await database.query<{ count: number }>(
      `SELECT count(*) AS count FROM resolution_cases WHERE status = 'resolved'`,
    );
    expect(resolved[0]?.count).toBe(1);

    const original = await database.query<{
      id: string;
      source_account_id: string;
      first_import_run_id: string;
      raw_payload_json: string;
      title: string;
      authors_json: string;
      source_format: string | null;
      isbn: string | null;
      occurred_at: string;
    }>(
      `SELECT id, source_account_id, first_import_run_id, raw_payload_json, title, authors_json,
              source_format, isbn, occurred_at
       FROM import_records WHERE title = 'The Moonlit Kite'`,
    );
    const row = original[0];
    if (!row) throw new Error('Expected resolved import row');
    await database.run(
      `INSERT INTO import_records
       (id, source_account_id, first_import_run_id, source_key, normalization_version,
        raw_payload_json, title, authors_json, source_format, isbn, occurred_at, created_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'repeat-import',
        row.source_account_id,
        row.first_import_run_id,
        'repeat-source-key',
        row.raw_payload_json,
        row.title,
        row.authors_json,
        row.source_format,
        row.isbn,
        '2026-08-13T12:00:00.000Z',
        '2026-08-13T12:00:00.000Z',
      ],
    );
    const noNetworkCatalog = {
      searchByIsbn: async (): Promise<never> => {
        throw new Error('catalog should not run');
      },
      searchByTitleAuthor: async (): Promise<never> => {
        throw new Error('catalog should not run');
      },
    };
    await expect(
      prepareResolutionQueue(database, noNetworkCatalog, { idFactory }),
    ).resolves.toMatchObject({
      casesCreated: 1,
      cacheHits: 1,
      automaticallyResolved: 0,
    });
  });

  it('supports manual resolution and rejection with immutable decisions', async () => {
    database = new NodeSqliteDatabase();
    await migrate(database);
    let sequence = 0;
    const idFactory = () => `manual-${String(sequence++).padStart(3, '0')}`;
    await importLibbySnapshot(database, {
      rawText: await readFile(fixture, 'utf8'),
      householdId: 'household-manual',
      sourceAccountId: 'source-manual',
      idFactory,
    });
    const result = await prepareResolutionQueue(
      database,
      { searchByIsbn: async () => [], searchByTitleAuthor: async () => [] },
      { idFactory },
    );
    const [first, second] = result.queue;
    if (!first || !second) throw new Error('Expected two pending cases');

    await createManualWorkForCase(database, first.caseId, first.title, first.authorsJson, {
      idFactory,
    });
    await rejectCase(database, second.caseId);
    const statuses = await database.query<{ status: string }>(
      'SELECT status FROM resolution_cases ORDER BY status',
    );
    expect(statuses.map(({ status }) => status)).toEqual(['rejected', 'resolved']);
    const decisions = await database.query<{ count: number }>(
      'SELECT count(*) AS count FROM resolution_decisions',
    );
    expect(decisions[0]?.count).toBe(2);
  });
});
