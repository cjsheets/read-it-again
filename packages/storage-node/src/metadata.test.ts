import { afterEach, describe, expect, it } from 'vitest';
import { getEffectiveMetadata, migrate, storeMetadataFacts } from '@read-it-again/storage-schema';
import { NodeSqliteDatabase } from './database.js';

describe('metadata fact precedence', () => {
  let database: NodeSqliteDatabase | undefined;
  afterEach(async () => database?.close());

  it('selects the highest-precedence fact without deleting lower-precedence provenance', async () => {
    database = new NodeSqliteDatabase();
    await migrate(database);
    let id = 0;
    const idFactory = () => `fact-${id++}`;
    await storeMetadataFacts(database, {
      entityKind: 'edition',
      entityId: 'edition',
      source: 'google',
      sourceRef: 'g',
      metadata: {
        juvenileHeading: false,
        subjects: [],
        genres: [],
        contributors: [],
        pageCount: 40,
        series: [],
      },
      idFactory,
      fetchedAt: '2026-08-13T10:00:00.000Z',
    });
    await storeMetadataFacts(database, {
      entityKind: 'edition',
      entityId: 'edition',
      source: 'marc',
      sourceRef: '101',
      metadata: {
        juvenileHeading: true,
        subjects: [],
        genres: [],
        contributors: [],
        pageCount: 32,
        series: [],
      },
      idFactory,
      fetchedAt: '2026-08-13T11:00:00.000Z',
    });
    await storeMetadataFacts(database, {
      entityKind: 'edition',
      entityId: 'edition',
      source: 'human',
      sourceRef: 'correction',
      metadata: {
        juvenileHeading: true,
        subjects: [],
        genres: [],
        contributors: [],
        pageCount: 36,
        series: [],
      },
      idFactory,
      fetchedAt: '2026-08-13T12:00:00.000Z',
    });
    await expect(getEffectiveMetadata(database, 'edition', 'edition')).resolves.toMatchObject({
      pageCount: 36,
    });
    expect(
      (
        await database.query<{ count: number }>(
          "SELECT count(*) AS count FROM metadata_facts WHERE field = 'pageCount'",
        )
      )[0]?.count,
    ).toBe(3);
  });
});
