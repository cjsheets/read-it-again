import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';
import { acquireAndImportBibliocommonsCards } from '@read-it-again/application-local';
import { NodeSqliteDatabase } from '@read-it-again/storage-node';
import { migrate } from '@read-it-again/storage-schema';

const arguments_ = process.argv.slice(2).filter((argument) => argument !== '--');
const [storageStateArgument, databaseArgument = 'data/read-it-again.db'] = arguments_;
if (!storageStateArgument) {
  throw new Error(
    'Usage: import:bibliocommons -- <playwright-storage-state.json> [database] (set CHILD_* environment variables to customize IDs and labels)',
  );
}

const projectDirectory = process.env.INIT_CWD ?? process.cwd();
const storageState = resolve(projectDirectory, storageStateArgument);
const filename = resolve(projectDirectory, databaseArgument);
mkdirSync(dirname(filename), { recursive: true });
const database = new NodeSqliteDatabase(filename);
const browser = await chromium.launch({ headless: true });

try {
  await migrate(database);
  const results = await acquireAndImportBibliocommonsCards(database, browser, [
    {
      householdId: process.env.CHILD_HOUSEHOLD_ID ?? 'household-default',
      personId: process.env.CHILD_PERSON_ID ?? 'reader-child',
      personName: process.env.CHILD_PERSON_NAME ?? 'Child',
      cardId: process.env.CHILD_CARD_ID ?? 'card-child-kcls',
      cardLabel: process.env.CHILD_CARD_LABEL ?? 'Child KCLS card',
      sourceAccountId: process.env.CHILD_SOURCE_ACCOUNT_ID ?? 'source-child-bibliocommons',
      contextOptions: { storageState },
    },
  ]);
  console.log(JSON.stringify({ database: filename, results }, null, 2));
} finally {
  await browser.close();
  await database.close();
}
