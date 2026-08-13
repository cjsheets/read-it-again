import { resolve } from 'node:path';
import { KclsCatalogClient } from '@read-it-again/adapter-kcls';
import { enrichResolvedCatalogRecords } from '@read-it-again/application';
import { NodeSqliteDatabase } from '@read-it-again/storage-node';
import { migrate } from '@read-it-again/storage-schema';

const filenameArgument = process.argv.slice(2).find((argument) => argument !== '--');
const filename = resolve(
  process.env.INIT_CWD ?? process.cwd(),
  filenameArgument ?? 'data/read-it-again.db',
);
const database = new NodeSqliteDatabase(filename);

try {
  await migrate(database);
  const result = await enrichResolvedCatalogRecords(database, new KclsCatalogClient({ database }));
  console.log(
    JSON.stringify(
      {
        database: filename,
        editionsEnriched: result.editionsEnriched,
        attributionResultsChanged: result.attributionResultsChanged,
        needsReview: result.triage.length,
      },
      null,
      2,
    ),
  );
} finally {
  await database.close();
}
