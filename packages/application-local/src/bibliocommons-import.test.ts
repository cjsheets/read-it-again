import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareResolutionQueue } from '@read-it-again/application';
import type { CatalogCandidate } from '@read-it-again/domain';
import { NodeSqliteDatabase } from '@read-it-again/storage-node';
import { listReaderShelf, migrate } from '@read-it-again/storage-schema';
import { importBibliocommonsSnapshot, physicalSourceKey } from './index.js';

const fixture = fileURLToPath(
  new URL('../../test-fixtures/bibliocommons/recently-returned.html', import.meta.url),
);

describe('BiblioCommons exclusive-card vertical slice', () => {
  let database: NodeSqliteDatabase | undefined;
  afterEach(async () => database?.close());

  it('imports, resolves, attributes, and idempotently reaches the child shelf', async () => {
    database = new NodeSqliteDatabase();
    await migrate(database);
    const rawHtml = await readFile(fixture, 'utf8');
    let sequence = 0;
    const idFactory = () => `physical-${String(sequence++).padStart(3, '0')}`;
    const input = {
      rawHtml,
      householdId: 'household-physical',
      personId: 'child-reader',
      personName: 'Child',
      cardId: 'child-card',
      cardLabel: 'Child KCLS card',
      sourceAccountId: 'source-child-card',
      idFactory,
      now: () => new Date('2026-08-12T12:00:00.000Z'),
    };

    await expect(importBibliocommonsSnapshot(database, input)).resolves.toMatchObject({
      rowsSeen: 1,
      rowsNew: 1,
      reusedSnapshot: false,
    });
    await expect(importBibliocommonsSnapshot(database, input)).resolves.toMatchObject({
      rowsSeen: 1,
      rowsNew: 0,
      reusedSnapshot: true,
    });

    const candidate: CatalogCandidate = {
      catalogKey: 'moonlit-kite-bib',
      title: 'The Moonlit Kite',
      authorDisplays: ['North, Riley'],
      isbns: [],
      format: 'Book',
      publishedYear: 2025,
      juvenile: true,
    };
    await expect(
      prepareResolutionQueue(
        database,
        { searchByIsbn: async () => [], searchByTitleAuthor: async () => [candidate] },
        { idFactory, now: () => new Date('2026-08-12T12:01:00.000Z') },
      ),
    ).resolves.toMatchObject({
      casesCreated: 1,
      automaticallyResolved: 1,
      deterministicallyAttributed: 1,
      pending: 0,
    });

    expect(await listReaderShelf(database, 'child-reader')).toEqual([
      expect.objectContaining({
        title: 'The Moonlit Kite',
        callNumber: 'E NORTH',
        confidence: 1,
        method: 'exclusive_card',
      }),
    ]);
    await expect(
      prepareResolutionQueue(database, {
        searchByIsbn: async () => {
          throw new Error('catalog must not run');
        },
        searchByTitleAuthor: async () => {
          throw new Error('catalog must not run');
        },
      }),
    ).resolves.toMatchObject({ casesCreated: 0, deterministicallyAttributed: 0 });
    expect(await listReaderShelf(database, 'child-reader')).toHaveLength(1);
  });

  it('uses a versioned card/title/author/call-number/date hash', async () => {
    const key = await physicalSourceKey('card-1', {
      title: 'The Moonlit Kite',
      authors: [{ display: 'Riley North' }],
      callNumber: 'E  NORTH',
      occurredAt: '2026-08-01T00:00:00.000Z',
    });
    expect(key).toMatch(/^bibliocommons:v1:[a-f0-9]{64}$/u);
    await expect(
      physicalSourceKey('card-2', {
        title: 'The Moonlit Kite',
        authors: [{ display: 'Riley North' }],
        callNumber: 'E NORTH',
        occurredAt: '2026-08-01T00:00:00.000Z',
      }),
    ).resolves.not.toBe(key);
  });

  it('writes nothing from an incomplete saved page', async () => {
    database = new NodeSqliteDatabase();
    await migrate(database);
    await expect(
      importBibliocommonsSnapshot(database, {
        rawHtml: '<table><tr><td class="item-title"></td></tr></table>',
        householdId: 'never-created',
        personId: 'never-created',
        personName: 'Child',
        cardId: 'never-created',
        cardLabel: 'Child card',
        sourceAccountId: 'never-created',
      }),
    ).rejects.toThrow('BiblioCommons snapshot is invalid');
    expect(
      (await database.query<{ count: number }>('SELECT count(*) AS count FROM households'))[0]
        ?.count,
    ).toBe(0);
  });
});
