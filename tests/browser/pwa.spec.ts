import { expect, test } from '@playwright/test';
import {
  addBookManually,
  csvSnapshot,
  exportArchive,
  goTo,
  importArchive,
  importCsv,
  importLibby,
  openApp,
  shelfCards,
} from './support/shelf.js';

const PASSPHRASE = 'a sufficiently long passphrase';

test('supports CSV and manual offline inputs and ships an installable shell', async ({ page }) => {
  await openApp(page);
  await expect(page.getByTestId('import-status')).not.toHaveText('Opening your private bookshelf…');

  await importCsv(page, csvSnapshot(1, 'Cloud Boat'));
  await expect(page.getByTestId('import-status')).toHaveText('Imported 1 new of 1 rows.');

  await addBookManually(page, {
    title: 'The Paper Moon',
    author: 'Rae Finch',
    isbn: '9780000000002',
  });
  await expect(page.getByTestId('import-status')).toHaveText('Book added.');
  await goTo(page, 'shelf');
  await expect(shelfCards(page)).toHaveCount(2);

  const archive = await exportArchive(page, PASSPHRASE);

  // An archive dropped into the Libby slot is identified rather than misreported.
  await importLibby(page, {
    name: 'backup.ria-archive',
    mimeType: 'application/json',
    buffer: archive,
  });
  await expect(page.getByTestId('error-title')).toHaveText('That is a backup, not a Libby file');

  await importArchive(page, archive, PASSPHRASE);
  await expect(page.getByTestId('import-status')).toHaveText('Encrypted archive restored.');
  await goTo(page, 'shelf');
  await expect(shelfCards(page).filter({ hasText: 'The Paper Moon' })).toHaveCount(1);

  const manifest = await page.request.get('http://127.0.0.1:4175/manifest.webmanifest');
  expect(manifest.ok()).toBe(true);
  expect(await manifest.json()).toMatchObject({ name: 'Read It Again', display: 'standalone' });
  await expect
    .poll(() =>
      page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length),
    )
    .toBeGreaterThan(0);
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.reload();
  await expect(shelfCards(page)).toHaveCount(2);
  await page.context().setOffline(true);
  await page.reload();
  await expect(shelfCards(page)).toHaveCount(2);
  await expect(shelfCards(page).filter({ hasText: 'The Paper Moon' })).toHaveCount(1);
});
