import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { NodeSqliteDatabase } from '@read-it-again/storage-node';
import { migrate } from '@read-it-again/storage-schema';
import { getImportInbox, importLibbySnapshot } from './libby-import.js';

const fixture = fileURLToPath(new URL('../../test-fixtures/libby/timeline.json', import.meta.url));

describe('Libby import application service', () => {
  let database: NodeSqliteDatabase | undefined;

  afterEach(async () => database?.close());

  it('stores observations once while retaining idempotent audit runs', async () => {
    database = new NodeSqliteDatabase();
    await migrate(database);
    const rawText = await readFile(fixture, 'utf8');
    let sequence = 0;
    const idFactory = () => `test-${String(sequence++).padStart(3, '0')}`;
    const input = {
      rawText,
      fileName: 'timeline.json',
      householdId: 'household-test',
      sourceAccountId: 'source-libby-test',
      idFactory,
      now: () => new Date('2026-08-12T12:00:00.000Z'),
    };

    await expect(importLibbySnapshot(database, input)).resolves.toMatchObject({
      rowsSeen: 2,
      rowsNew: 2,
      rowsIgnored: 0,
      reusedSnapshot: false,
    });
    await expect(importLibbySnapshot(database, input)).resolves.toMatchObject({
      rowsSeen: 2,
      rowsNew: 0,
      rowsIgnored: 0,
      reusedSnapshot: true,
    });

    const inbox = await getImportInbox(database, input.sourceAccountId);
    expect(inbox.records).toHaveLength(2);
    expect(inbox.runs).toHaveLength(2);
    expect(inbox.runs.map(({ rowsNew }) => rowsNew)).toEqual([0, 2]);
    const blobCount = await database.query<{ count: number }>(
      'SELECT count(*) AS count FROM import_blobs',
    );
    expect(blobCount[0]?.count).toBe(1);
  });

  it('writes nothing when validation fails', async () => {
    database = new NodeSqliteDatabase();
    await migrate(database);

    await expect(
      importLibbySnapshot(database, {
        rawText: '[{"title":{}}]',
        householdId: 'should-not-exist',
        sourceAccountId: 'should-not-exist',
      }),
    ).rejects.toThrow('Libby snapshot is invalid');

    const households = await database.query<{ count: number }>(
      'SELECT count(*) AS count FROM households',
    );
    expect(households[0]?.count).toBe(0);
  });
});
