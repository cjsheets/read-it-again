import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from 'playwright';
import { KclsCatalogClient } from '@read-it-again/adapter-kcls';
import {
  enrichResolvedCatalogRecords,
  exportEncryptedArchive,
  generateRecommendations,
  prepareResolutionQueue,
} from '@read-it-again/application';
import { acquireAndImportBibliocommonsCards } from '@read-it-again/application-local';
import { NodeSqliteDatabase } from '@read-it-again/storage-node';
import { listReaderShelf, migrate } from '@read-it-again/storage-schema';
import type { ResolvedBookshelfConfig } from './bookshelf-config.js';

export interface BookshelfStatus {
  readonly readerName: string;
  readonly importedRecords: number;
  readonly lastImportAt?: string;
  readonly pendingResolutions: number;
  readonly attributionReviews: number;
  readonly shelfItems: number;
  readonly recommendationItems: number;
  readonly lastRecommendationAt?: string;
}

export async function initializeBookshelf(config: ResolvedBookshelfConfig): Promise<void> {
  mkdirSync(dirname(config.databaseFilename), { recursive: true });
  const database = new NodeSqliteDatabase(config.databaseFilename);
  try {
    await migrate(database);
  } finally {
    await database.close();
  }
}

export async function loginBookshelf(config: ResolvedBookshelfConfig): Promise<void> {
  mkdirSync(dirname(config.sessionFilename), { recursive: true });
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext(
    existsSync(config.sessionFilename) ? { storageState: config.sessionFilename } : {},
  );
  try {
    const page = await context.newPage();
    await page.goto('https://kcls.bibliocommons.com/v2/print/recentlyreturned', {
      waitUntil: 'domcontentloaded',
    });
    await waitForEnter(
      '\nSign in to the library account in the browser. When Recently Returned is visible, return here and press Enter. ',
    );
    await page.goto('https://kcls.bibliocommons.com/v2/print/recentlyreturned', {
      waitUntil: 'domcontentloaded',
    });
    const loginVisible = await page
      .locator('form[action*="login"], input[type="password"], [data-test-id*="login"]')
      .first()
      .isVisible()
      .catch(() => false);
    if (page.url().toLowerCase().includes('/login') || loginVisible) {
      throw new Error('The library session is still signed out; no session was saved');
    }
    await context.storageState({ path: config.sessionFilename });
    chmodSync(config.sessionFilename, 0o600);
  } finally {
    await context.close();
    await browser.close();
  }
}

export async function syncBookshelf(
  config: ResolvedBookshelfConfig,
  report: (message: string) => void = console.log,
): Promise<BookshelfStatus> {
  const database = new NodeSqliteDatabase(config.databaseFilename);
  const browser = await chromium.launch({ headless: true });
  try {
    await migrate(database);
    const catalog = new KclsCatalogClient({ database });
    report('Importing BiblioCommons history…');
    const imports = await acquireAndImportBibliocommonsCards(database, browser, [
      {
        householdId: config.household.id,
        personId: config.reader.id,
        personName: config.reader.name,
        cardId: config.card.id,
        cardLabel: config.card.label,
        sourceAccountId: config.sourceAccount.id,
        contextOptions: { storageState: config.sessionFilename },
      },
    ]);
    const imported = imports[0];
    report(`✓ Imported ${imported?.rowsSeen ?? 0} returned items (${imported?.rowsNew ?? 0} new)`);

    report('Resolving catalog records…');
    const resolution = await prepareResolutionQueue(database, catalog);
    report(
      `✓ Resolved ${resolution.automaticallyResolved} automatically; ${resolution.pending} need review`,
    );

    report('Enriching catalog metadata and rebuilding the reading model…');
    const enrichment = await enrichResolvedCatalogRecords(database, catalog);
    report(
      `✓ Enriched ${enrichment.editionsEnriched} editions; ${enrichment.triage.length} attribution reviews remain`,
    );

    report('Generating recommendations…');
    const recommendations = await generateRecommendations(database, catalog, {
      householdId: config.household.id,
      personId: config.reader.id,
      maxReadMinutes: config.maxReadMinutes,
    });
    report(
      `✓ Generated ${recommendations.discovery.length} recommendations and ${recommendations.readAgain.length} read-again choices`,
    );
    return await readBookshelfStatus(database, config);
  } finally {
    await browser.close();
    await database.close();
  }
}

export async function recommendBookshelf(
  config: ResolvedBookshelfConfig,
): Promise<{ readonly discovery: number; readonly readAgain: number }> {
  const database = new NodeSqliteDatabase(config.databaseFilename);
  try {
    await migrate(database);
    const result = await generateRecommendations(database, new KclsCatalogClient({ database }), {
      householdId: config.household.id,
      personId: config.reader.id,
      maxReadMinutes: config.maxReadMinutes,
    });
    return { discovery: result.discovery.length, readAgain: result.readAgain.length };
  } finally {
    await database.close();
  }
}

export async function getBookshelfStatus(
  config: ResolvedBookshelfConfig,
): Promise<BookshelfStatus> {
  const database = new NodeSqliteDatabase(config.databaseFilename);
  try {
    await migrate(database);
    return await readBookshelfStatus(database, config);
  } finally {
    await database.close();
  }
}

export async function backupBookshelf(
  config: ResolvedBookshelfConfig,
  passphrase: string,
  outputFilename: string,
): Promise<void> {
  const database = new NodeSqliteDatabase(config.databaseFilename);
  try {
    await migrate(database);
    const archive = await exportEncryptedArchive(database, passphrase);
    mkdirSync(dirname(outputFilename), { recursive: true });
    writeFileSync(outputFilename, `${archive}\n`, { mode: 0o600, flag: 'wx' });
  } finally {
    await database.close();
  }
}

async function readBookshelfStatus(
  database: NodeSqliteDatabase,
  config: ResolvedBookshelfConfig,
): Promise<BookshelfStatus> {
  const imported = (
    await database.query<{ count: number }>(
      'SELECT count(*) AS count FROM import_records WHERE source_account_id = ?',
      [config.sourceAccount.id],
    )
  )[0]?.count;
  const lastImport = (
    await database.query<{ finished_at: string }>(
      'SELECT finished_at FROM import_runs WHERE source_account_id = ? ORDER BY finished_at DESC LIMIT 1',
      [config.sourceAccount.id],
    )
  )[0];
  const pending = (
    await database.query<{ count: number }>(
      `SELECT count(*) AS count FROM resolution_cases c
       JOIN import_records i ON i.id = c.import_record_id
       WHERE i.source_account_id = ? AND c.status IN ('pending', 'deferred')`,
      [config.sourceAccount.id],
    )
  )[0]?.count;
  const reviews = (
    await database.query<{ count: number }>(
      `SELECT count(*) AS count FROM attribution_results a
       JOIN import_records i ON i.id = a.import_record_id
       WHERE i.source_account_id = ? AND a.current = 1 AND a.state = 'review'`,
      [config.sourceAccount.id],
    )
  )[0]?.count;
  const latestRecommendation = (
    await database.query<{ id: string; generated_at: string }>(
      'SELECT id, generated_at FROM recommendation_runs WHERE person_id = ? ORDER BY generated_at DESC, id DESC LIMIT 1',
      [config.reader.id],
    )
  )[0];
  const recommendationItems = latestRecommendation
    ? (
        await database.query<{ count: number }>(
          'SELECT count(*) AS count FROM recommendation_items WHERE recommendation_run_id = ?',
          [latestRecommendation.id],
        )
      )[0]?.count
    : 0;
  return {
    readerName: config.reader.name,
    importedRecords: imported ?? 0,
    lastImportAt: lastImport?.finished_at,
    pendingResolutions: pending ?? 0,
    attributionReviews: reviews ?? 0,
    shelfItems: (await listReaderShelf(database, config.reader.id)).length,
    recommendationItems: recommendationItems ?? 0,
    lastRecommendationAt: latestRecommendation?.generated_at,
  };
}

async function waitForEnter(message: string): Promise<void> {
  if (!process.stdin.isTTY) throw new Error('Login requires an interactive terminal');
  const { createInterface } = await import('node:readline/promises');
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await prompt.question(message);
  } finally {
    prompt.close();
  }
}
