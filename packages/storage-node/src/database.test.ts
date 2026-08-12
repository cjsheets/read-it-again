import { afterEach, describe, expect, it } from 'vitest';
import { runRepositoryConformance } from '@read-it-again/storage-schema';
import { NodeSqliteDatabase } from './database.js';

describe('NodeSqliteDatabase', () => {
  let database: NodeSqliteDatabase | undefined;

  afterEach(async () => {
    await database?.close();
  });

  it('satisfies the shared repository contract', async () => {
    database = new NodeSqliteDatabase();

    await expect(runRepositoryConformance(database, 'native')).resolves.toEqual({
      migrationCount: 1,
      householdCount: 2,
    });
  });

  it('enforces schema constraints', async () => {
    database = new NodeSqliteDatabase();
    const { migrate } = await import('@read-it-again/storage-schema');
    await migrate(database);

    await expect(
      database.run('INSERT INTO households (id, name, created_at) VALUES (?, ?, ?)', [
        'empty-name',
        '   ',
        '2026-08-12T00:00:00.000Z',
      ]),
    ).rejects.toThrow();
  });
});
