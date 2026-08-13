import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { importLibbySnapshot } from '@read-it-again/application';
import { NodeSqliteDatabase } from '@read-it-again/storage-node';
import { migrate } from '@read-it-again/storage-schema';

const argumentsWithoutSeparator = process.argv.slice(2).filter((argument) => argument !== '--');
const snapshotArgument = argumentsWithoutSeparator[0];
if (!snapshotArgument) {
  throw new Error(
    'Usage: pnpm --filter @read-it-again/local-api import:libby -- <timeline.json> [database.db]',
  );
}
const invocationDirectory = process.env.INIT_CWD ?? process.cwd();
const snapshot = resolve(invocationDirectory, snapshotArgument);
const filename = resolve(
  invocationDirectory,
  argumentsWithoutSeparator[1] ?? 'data/read-it-again.db',
);
mkdirSync(dirname(filename), { recursive: true });
const database = new NodeSqliteDatabase(filename);

try {
  await migrate(database);
  const result = await importLibbySnapshot(database, {
    rawText: await readFile(snapshot, 'utf8'),
    fileName: snapshot.split('/').at(-1),
    householdId: 'default-household',
    sourceAccountId: 'default-libby-source',
  });
  console.log(JSON.stringify({ database: filename, ...result }, null, 2));
} finally {
  await database.close();
}
