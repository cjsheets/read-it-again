import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  addBookManually,
  csvSnapshot,
  importCsv,
  openApp,
  pendingDecisions,
  PRODUCTION_URL,
  shelfCards,
} from './support/shelf.js';

const libbyFixture = path.resolve('packages/test-fixtures/libby/timeline.json');
const PASSPHRASE = 'a sufficiently long passphrase';

/**
 * Audit finding F-01. Every documented input path is supposed to end with a book
 * the household can rate, read, and be recommended against. Today only manual
 * entry does: `worker.ts` calls `correctAttribution` in the `importManual` branch
 * and nowhere else, so CSV and Libby rows stop at the review queues.
 *
 * The tests below describe the finished behaviour. The ones that cannot pass yet
 * carry `test.fail()` with the increment that is meant to fix them — see
 * `tests/browser/README.md` for why that annotation is used instead of a
 * permanently red build.
 */
test.describe('every input path reaches the bookshelf', () => {
  test('manual entry lands a book on the bookshelf with no decisions', async ({ page }) => {
    await openApp(page);

    await addBookManually(page, {
      title: 'The Paper Moon',
      author: 'Rae Finch',
      isbn: '9780000000002',
    });

    await expect(shelfCards(page)).toHaveCount(1);
    await expect(shelfCards(page).getByRole('heading', { name: 'The Paper Moon' })).toBeVisible();
    expect(await pendingDecisions(page)).toBe(0);
  });

  test('a CSV import ingests every row', async ({ page }) => {
    await openApp(page);

    await importCsv(page, csvSnapshot(50));

    await expect(page.getByTestId('import-status')).toHaveText('Imported 50 new of 50 rows.');
    await expect(page.getByTestId('record-count')).toHaveText('50 books');
  });

  // F-01 · fixed by Increment 2 (close the import loop).
  test('a CSV import lands every row on the bookshelf with no decisions', async ({ page }) => {
    test.fail(true, 'F-01: CSV rows stop at the resolution queue. Fixed by Increment 2.');
    await openApp(page);

    await importCsv(page, csvSnapshot(50));
    await expect(page.getByTestId('record-count')).toHaveText('50 books');

    await expect(shelfCards(page)).toHaveCount(50);
    expect(await pendingDecisions(page)).toBe(0);
  });

  // F-01 · fixed by Increment 2 (close the import loop).
  test('a Libby snapshot lands every title on the bookshelf with no decisions', async ({
    page,
  }) => {
    test.fail(true, 'F-01: Libby rows stop at the resolution queue. Fixed by Increment 2.');
    await openApp(page);

    await page.getByTestId('libby-file').setInputFiles(libbyFixture);
    await expect(page.getByTestId('record-count')).toHaveText('2 books');

    await expect(shelfCards(page)).toHaveCount(2);
    expect(await pendingDecisions(page)).toBe(0);
  });

  /**
   * Regression: the PWA sent both `importRecordId` and `workId` on every
   * attribution correction, but `attribution_overrides` has a CHECK constraint
   * permitting exactly one target per scope. Every correction failed, so the
   * review queue could never be cleared and no imported book could reach the
   * shelf even with the two decisions F-01 describes.
   */
  test('an attribution correction actually saves and lands the book', async ({ page }) => {
    await openApp(page);
    await importCsv(page, csvSnapshot(1));
    await expect(page.getByTestId('record-count')).toHaveText('1 books');

    await page.getByRole('button', { name: 'Use source details' }).click();
    await expect(page.getByTestId('attribution-count')).toHaveText('1 pending');
    await page.getByRole('button', { name: 'For Child', exact: true }).click();

    await expect(page.getByTestId('import-status')).toHaveText('Attribution correction saved.');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByTestId('attribution-count')).toHaveCount(0);
    await expect(shelfCards(page)).toHaveCount(1);
  });

  test('an encrypted archive carries the bookshelf to a fresh device', async ({
    page,
    browser,
  }) => {
    await openApp(page);
    for (const title of ['Cloud Boat', 'The Paper Moon', 'Bear Counts the Stars']) {
      await addBookManually(page, { title, author: 'Ada Fox' });
    }
    await expect(shelfCards(page)).toHaveCount(3);

    await page.getByLabel('Archive passphrase').fill(PASSPHRASE);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export encrypted backup' }).click();
    const archivePath = await (await downloadPromise).path();
    expect(archivePath).not.toBeNull();
    const archive = await readFile(archivePath);

    // A separate context is a separate OPFS origin store: a genuinely empty device.
    const restored = await browser.newContext();
    const restoredPage = await restored.newPage();
    await openApp(restoredPage, PRODUCTION_URL);
    await expect(shelfCards(restoredPage)).toHaveCount(0);

    await restoredPage.getByLabel('Archive passphrase').fill(PASSPHRASE);
    await restoredPage.getByTestId('archive-file').setInputFiles({
      name: 'backup.ria-archive',
      mimeType: 'application/json',
      buffer: archive,
    });

    await expect(restoredPage.getByTestId('import-status')).toHaveText(
      'Encrypted archive restored.',
    );
    await expect(shelfCards(restoredPage)).toHaveCount(3);
    await expect(
      shelfCards(restoredPage).getByRole('heading', { name: 'Cloud Boat' }),
    ).toBeVisible();
    await restored.close();
  });
});
