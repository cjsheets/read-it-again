import { afterEach, describe, expect, it } from 'vitest';
import { NodeSqliteDatabase } from '@read-it-again/storage-node';
import { migrate } from '@read-it-again/storage-schema';
import { importCsvSnapshot, importManualBook } from './browser-imports.js';

describe('browser-safe imports', () => {
  let database: NodeSqliteDatabase | undefined;
  afterEach(async () => database?.close());

  it('imports CSV idempotently and resolves manual books without a catalog', async () => {
    database = new NodeSqliteDatabase();
    await migrate(database);
    let id = 0;
    const options = {
      householdId: 'h',
      sourceAccountId: 'csv',
      idFactory: () => `id-${id++}`,
      now: () => new Date('2026-08-13T00:00:00Z'),
    };
    const first = await importCsvSnapshot(database, {
      ...options,
      rawText: 'Title,Author\nCloud Boat,Ada Fox',
    });
    const second = await importCsvSnapshot(database, {
      ...options,
      rawText: 'Title,Author\nCloud Boat,Ada Fox',
    });
    expect(first.rowsNew).toBe(1);
    expect(second.rowsNew).toBe(0);
    const manual = await importManualBook(database, {
      ...options,
      sourceAccountId: 'manual',
      title: 'Paper Moon',
      author: 'Rae Finch',
      isbn: '978-1',
    });
    expect(manual.workId).toBeTruthy();
    expect(await database.query('SELECT canonical_title FROM works')).toEqual([
      { canonical_title: 'Paper Moon' },
    ]);
  });
});
