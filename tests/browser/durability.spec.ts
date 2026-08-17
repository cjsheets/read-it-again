import { expect, test } from '@playwright/test';
import {
  addBookManually,
  BULK_IMPORT_TIMEOUT,
  csvSnapshot,
  exportArchive,
  goTo,
  importArchive,
  importCsv,
  openApp,
  PRODUCTION_URL,
  shelfCards,
} from './support/shelf.js';

const PASSPHRASE = 'a sufficiently long passphrase';

/**
 * Audit finding F-05. `navigator.storage.persist()` was called nowhere in the
 * source, `persisted()` returned false, and wiping OPFS returned the app to the
 * first-run empty state with no warning, no last-backup date, and no hint that a
 * backup had ever existed. ADR 0011 names this risk; the UI ignored it.
 */
test.describe('storage durability', () => {
  test('persistence is requested after the first add and reported honestly', async ({ page }) => {
    await openApp(page);
    // Nothing has been added yet, so nothing has been requested.
    expect(await page.evaluate(() => navigator.storage.persisted())).toBe(false);

    await addBookManually(page, { title: 'The Gruffalo', author: 'Julia Donaldson' });
    await goTo(page, 'settings');

    // Chromium grants without prompting for a site with engagement; whatever the
    // browser decides, the app must show that state rather than stay silent.
    const granted = await page.evaluate(() => navigator.storage.persisted());
    await expect(page.getByTestId('persistence-state')).toHaveText(
      granted
        ? 'Protected from automatic cleanup.'
        : 'This browser may delete these books to reclaim space.',
    );
  });

  test('last backup reads Never until an archive is exported, then shows a date', async ({
    page,
  }) => {
    await openApp(page);
    await addBookManually(page, { title: 'Cloud Boat', author: 'Ada Fox' });
    await goTo(page, 'settings');
    await expect(page.getByTestId('last-backup')).toHaveText('Never');

    await exportArchive(page, PASSPHRASE);

    await expect(page.getByTestId('last-backup')).not.toHaveText('Never');
    // It is a fact about the data, so it survives a reload rather than living in
    // component state.
    await page.reload();
    await goTo(page, 'settings');
    await expect(page.getByTestId('last-backup')).not.toHaveText('Never');
  });

  test('a shelf worth losing with no backup gets a reminder', async ({ page }) => {
    await openApp(page);
    await goTo(page, 'settings');
    await expect(page.getByTestId('backup-reminder')).toHaveCount(0);

    await importCsv(page, csvSnapshot(6));
    await expect(page.getByTestId('import-status')).toHaveText('Imported 6 new of 6 rows.', {
      timeout: BULK_IMPORT_TIMEOUT,
    });
    await goTo(page, 'settings');

    await expect(page.getByTestId('backup-reminder')).toBeVisible();
    await expect(page.getByTestId('backup-reminder')).toContainText('6 books and no backup');
  });

  test('a wiped device says so and points at the backup, not the first-run screen', async ({
    page,
  }) => {
    await openApp(page);
    await addBookManually(page, { title: 'Bear Counts the Stars', author: 'Rae Finch' });
    await goTo(page, 'shelf');
    await expect(shelfCards(page)).toHaveCount(1);
    await expect(page.getByTestId('wipe-notice')).toHaveCount(0);

    const archive = await exportArchive(page, PASSPHRASE);

    // Exactly the audit's scenario: the database is destroyed while the browser
    // profile survives, which is what storage eviction does.
    //
    // The deletion runs from a same-origin document that never boots the app.
    // SQLite-WASM holds a sync access handle on the database file for as long as
    // it is open, so deleting from the app's own page races that handle and fails
    // with NoModificationAllowedError.
    await page.goto(new URL('manifest.webmanifest', PRODUCTION_URL).href);
    // Navigating away begins the worker's teardown but does not wait for it, and
    // SQLite-WASM holds a sync access handle on the database file until it is
    // fully gone. There is nothing observable to await, so poll until the delete
    // is actually permitted rather than racing it once.
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            try {
              const root = await navigator.storage.getDirectory();
              for await (const name of (
                root as unknown as { keys: () => AsyncIterable<string> }
              ).keys()) {
                await root.removeEntry(name, { recursive: true });
              }
              return 'deleted';
            } catch {
              return 'locked';
            }
          }),
        { timeout: 20_000 },
      )
      .toBe('deleted');
    await openApp(page, PRODUCTION_URL);

    await expect(page.getByTestId('wipe-notice')).toBeVisible();
    await expect(shelfCards(page)).toHaveCount(0);

    // The notice must offer a way out, not just bad news. Its button is the route
    // to recovery, so follow it rather than navigating there independently.
    await page.getByRole('button', { name: 'Restore from a backup' }).click();
    await expect(page.getByRole('heading', { name: 'Backup and restore' })).toBeVisible();

    await importArchive(page, archive, PASSPHRASE);
    await expect(page.getByTestId('import-status')).toHaveText('Encrypted archive restored.');
    await goTo(page, 'shelf');
    await expect(shelfCards(page)).toHaveCount(1);
    await expect(page.getByTestId('wipe-notice')).toHaveCount(0);
  });

  test('a genuine first run is not mistaken for a wipe', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await openApp(page, PRODUCTION_URL);
    // A service worker caches the shell on first load, so "the shell is cached but
    // the database is empty" would misreport a new user. The marker is set by
    // holding books, not by visiting.
    await page.reload();
    await openApp(page, PRODUCTION_URL);

    await expect(page.getByTestId('wipe-notice')).toHaveCount(0);
    await expect(page.getByTestId('import-status')).toHaveText('No books imported yet.');
    await context.close();
  });
});
