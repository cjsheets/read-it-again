/// <reference lib="webworker" />

import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { runRepositoryConformance } from '@read-it-again/storage-schema';
import { BrowserSqliteDatabase } from './database.js';

type WorkerResponse =
  | { readonly status: 'passed'; readonly persistent: true; readonly result: unknown }
  | { readonly status: 'failed'; readonly message: string };

const worker = self as unknown as DedicatedWorkerGlobalScope;

async function run(): Promise<WorkerResponse> {
  const sqlite3 = await sqlite3InitModule({
    print: () => undefined,
    printErr: (message: unknown) => console.error(message),
  });

  if (!('opfs' in sqlite3)) {
    throw new Error('SQLite OPFS support is unavailable; transient storage is not acceptable');
  }

  const namespace = `browser-${crypto.randomUUID()}`;
  const filename = `/read-it-again-${namespace}.sqlite3`;
  const first = new BrowserSqliteDatabase(new sqlite3.oo1.OpfsDb(filename));
  const result = await runRepositoryConformance(first, namespace);
  await first.close();

  const reopened = new BrowserSqliteDatabase(new sqlite3.oo1.OpfsDb(filename));
  const persisted = await reopened.query<{ count: number }>(
    'SELECT count(*) AS count FROM households WHERE id LIKE ?',
    [`${namespace}-%`],
  );
  await reopened.close();

  if (persisted[0]?.count !== result.householdCount) {
    throw new Error('OPFS database did not persist repository data after close and reopen');
  }

  return { status: 'passed', persistent: true, result };
}

run()
  .then((response) => worker.postMessage(response))
  .catch((error: unknown) => {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    worker.postMessage({ status: 'failed', message } satisfies WorkerResponse);
  });
