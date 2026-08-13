import { resolve } from 'node:path';
import { KclsCatalogClient } from '@read-it-again/adapter-kcls';
import { generateRecommendations } from '@read-it-again/application';
import { NodeSqliteDatabase } from '@read-it-again/storage-node';
import { migrate } from '@read-it-again/storage-schema';

const arguments_ = process.argv.slice(2).filter((argument) => argument !== '--');
const [databaseArgument = 'data/read-it-again.db', personId = 'reader-child'] = arguments_;
const filename = resolve(process.env.INIT_CWD ?? process.cwd(), databaseArgument);
const database = new NodeSqliteDatabase(filename);

try {
  await migrate(database);
  const person = (
    await database.query<{ household_id: string }>('SELECT household_id FROM people WHERE id = ?', [
      personId,
    ])
  )[0];
  if (!person) throw new Error(`Reader ${personId} does not exist`);
  const maxReadMinutes = process.env.MAX_READ_MINUTES
    ? Number(process.env.MAX_READ_MINUTES)
    : undefined;
  const recommendations = await generateRecommendations(
    database,
    new KclsCatalogClient({ database }),
    { householdId: person.household_id, personId, maxReadMinutes },
  );
  console.log(JSON.stringify({ database: filename, personId, recommendations }, null, 2));
} finally {
  await database.close();
}
