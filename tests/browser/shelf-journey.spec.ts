import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  addBookManually,
  BULK_IMPORT_TIMEOUT,
  csvSnapshot,
  exportArchive,
  goTo,
  importArchive,
  importCsv,
  importLibby,
  openApp,
  pendingDecisions,
  PRODUCTION_URL,
  shelfCards,
} from './support/shelf.js';

const libbyFixture = path.resolve('packages/test-fixtures/libby/timeline.json');
const PASSPHRASE = 'a sufficiently long passphrase';

/**
 * Audit finding F-01. Every documented input path must end with a book the
 * household can rate, read, and be recommended against. ADR 0012 closed this: the
 * browser has no catalog, so it takes source records at their word rather than
 * parking them in a queue no one can clear.
 */
test.describe('every input path reaches the bookshelf', () => {
  test('manual entry lands a book on the bookshelf with no decisions', async ({ page }) => {
    await openApp(page);

    await addBookManually(page, {
      title: 'The Paper Moon',
      author: 'Rae Finch',
      isbn: '9780000000002',
    });

    await goTo(page, 'shelf');
    await expect(shelfCards(page)).toHaveCount(1);
    await expect(shelfCards(page).filter({ hasText: 'The Paper Moon' })).toHaveCount(1);
    expect(await pendingDecisions(page)).toBe(0);
  });

  test('a CSV import ingests every row', async ({ page }) => {
    await openApp(page);

    await importCsv(page, csvSnapshot(50));

    await expect(page.getByTestId('import-status')).toHaveText('Imported 50 new of 50 rows.', {
      timeout: BULK_IMPORT_TIMEOUT,
    });
  });

  test('a CSV import lands every row on the bookshelf with no decisions', async ({ page }) => {
    await openApp(page);

    await importCsv(page, csvSnapshot(50));
    await expect(page.getByTestId('import-status')).toHaveText('Imported 50 new of 50 rows.', {
      timeout: BULK_IMPORT_TIMEOUT,
    });

    await goTo(page, 'shelf');
    await expect(shelfCards(page)).toHaveCount(50, { timeout: BULK_IMPORT_TIMEOUT });
    expect(await pendingDecisions(page)).toBe(0);
  });

  test('a Libby snapshot lands every title on the bookshelf with no decisions', async ({
    page,
  }) => {
    await openApp(page);

    await importLibby(page, libbyFixture);
    await expect(page.getByTestId('import-status')).toHaveText('Imported 2 new of 2 rows.');

    await goTo(page, 'shelf');
    await expect(shelfCards(page)).toHaveCount(2);
    expect(await pendingDecisions(page)).toBe(0);
  });

  /**
   * A one-reader household has no question to answer, so it must never be shown a
   * queue (audit §2.3-B). This also guards the class of defect that hid behind the
   * old shared error headline: a worker request violating a database constraint
   * used to surface as a generic alert and leave the queue stuck.
   */
  test('a single-reader household is never asked to review anything', async ({ page }) => {
    await openApp(page);

    await importCsv(page, csvSnapshot(5));
    await expect(page.getByTestId('import-status')).toHaveText('Imported 5 new of 5 rows.', {
      timeout: BULK_IMPORT_TIMEOUT,
    });
    await importLibby(page, libbyFixture);
    await expect(page.getByTestId('import-status')).toHaveText('Imported 2 new of 2 rows.', {
      timeout: BULK_IMPORT_TIMEOUT,
    });

    await goTo(page, 'shelf');
    await expect(shelfCards(page)).toHaveCount(7);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByTestId('tasks-badge')).toHaveCount(0);

    await goTo(page, 'tasks');
    await expect(page.getByTestId('tasks-empty')).toBeVisible();
  });

  test('an encrypted archive carries the bookshelf to a fresh device', async ({
    page,
    browser,
  }) => {
    await openApp(page);
    for (const title of ['Cloud Boat', 'The Paper Moon', 'Bear Counts the Stars']) {
      await addBookManually(page, { title, author: 'Ada Fox' });
    }
    await goTo(page, 'shelf');
    await expect(shelfCards(page)).toHaveCount(3);

    const archive = await exportArchive(page, PASSPHRASE);

    // A separate context is a separate OPFS origin store: a genuinely empty device.
    const restored = await browser.newContext();
    const restoredPage = await restored.newPage();
    await openApp(restoredPage, PRODUCTION_URL);
    await expect(shelfCards(restoredPage)).toHaveCount(0);

    await importArchive(restoredPage, archive, PASSPHRASE);
    await expect(restoredPage.getByTestId('import-status')).toHaveText(
      'Encrypted archive restored.',
    );

    await goTo(restoredPage, 'shelf');
    await expect(shelfCards(restoredPage)).toHaveCount(3);
    await expect(shelfCards(restoredPage).filter({ hasText: 'Cloud Boat' })).toHaveCount(1);
    await restored.close();
  });
});
