import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { KclsCatalogClient } from '@read-it-again/adapter-kcls';
import { prepareResolutionQueue } from '@read-it-again/application';
import { NodeSqliteDatabase } from '@read-it-again/storage-node';
import { migrate } from '@read-it-again/storage-schema';

const filenameArgument = process.argv.slice(2).find((argument) => argument !== '--');
const filename = resolve(
  process.env.INIT_CWD ?? process.cwd(),
  filenameArgument ?? 'data/read-it-again.db',
);
mkdirSync(dirname(filename), { recursive: true });
const database = new NodeSqliteDatabase(filename);

try {
  await migrate(database);
  const catalog = new KclsCatalogClient({ database });
  const result = await prepareResolutionQueue(database, catalog);
  console.log(
    JSON.stringify(
      {
        database: filename,
        casesCreated: result.casesCreated,
        cacheHits: result.cacheHits,
        automaticallyResolved: result.automaticallyResolved,
        deterministicallyAttributed: result.deterministicallyAttributed,
        pending: result.pending,
      },
      null,
      2,
    ),
  );
} finally {
  await database.close();
}
