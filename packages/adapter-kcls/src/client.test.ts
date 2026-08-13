import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeSqliteDatabase } from '@read-it-again/storage-node';
import { migrate } from '@read-it-again/storage-schema';
import { KclsCatalogClient } from './client.js';

const fixture = fileURLToPath(new URL('../../test-fixtures/kcls/opensearch.xml', import.meta.url));

describe('KclsCatalogClient', () => {
  let database: NodeSqliteDatabase | undefined;
  afterEach(async () => database?.close());

  it('serializes calls and pays network cost once per request', async () => {
    database = new NodeSqliteDatabase();
    await migrate(database);
    const xml = await readFile(fixture, 'utf8');
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(xml, {
        status: 200,
        headers: { 'content-type': 'application/atom+xml' },
      }),
    );
    const sleep = vi.fn<(milliseconds: number) => Promise<void>>().mockResolvedValue(undefined);
    const client = new KclsCatalogClient({ database, fetch: fetchMock, sleep, courtesyDelayMs: 1 });

    const first = await client.searchByIsbn('9780000000101');
    const second = await client.searchByIsbn('9780000000101');
    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('backs off and retries transient responses', async () => {
    database = new NodeSqliteDatabase();
    await migrate(database);
    const xml = await readFile(fixture, 'utf8');
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(xml, { status: 200 }));
    const sleep = vi.fn<(milliseconds: number) => Promise<void>>().mockResolvedValue(undefined);
    const client = new KclsCatalogClient({ database, fetch: fetchMock, sleep, courtesyDelayMs: 5 });

    await expect(client.search('moonlit kite')).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 5);
  });
});
