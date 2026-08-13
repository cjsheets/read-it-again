import { resolve } from 'node:path';
import { NodeSqliteDatabase } from '@read-it-again/storage-node';
import { listReaderShelf, migrate } from '@read-it-again/storage-schema';

const arguments_ = process.argv.slice(2).filter((argument) => argument !== '--');
const [databaseArgument = 'data/read-it-again.db', personId = 'reader-child'] = arguments_;
const filename = resolve(process.env.INIT_CWD ?? process.cwd(), databaseArgument);
const database = new NodeSqliteDatabase(filename);

try {
  await migrate(database);
  console.log(
    JSON.stringify({ personId, shelf: await listReaderShelf(database, personId) }, null, 2),
  );
} finally {
  await database.close();
}
