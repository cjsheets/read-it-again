import { expect, test } from '@playwright/test';

test('supports CSV and manual offline inputs and ships an installable shell', async ({ page }) => {
  await page.goto('http://127.0.0.1:4175/');
  await expect(page.getByText('Client-only and private by construction.')).toBeVisible();
  await expect(page.getByTestId('import-status')).not.toHaveText('Opening your private bookshelf…');

  await page.getByTestId('csv-file').setInputFiles({
    name: 'books.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'Title,Author,ISBN,Date,Format\nCloud Boat,Ada Fox,9780000000001,2026-08-01,Book',
    ),
  });
  await expect(page.getByTestId('import-status')).toHaveText(
    /(?:Imported 1 new of 1 rows|Already up to date — 1 rows checked, 0 new)\./u,
  );
  await expect(
    page.getByLabel('Import inbox').getByRole('heading', { name: 'Cloud Boat' }),
  ).toBeVisible();

  await page.getByLabel('Book title').fill('The Paper Moon');
  await page.getByLabel('Book author').fill('Rae Finch');
  await page.getByLabel('Book ISBN').fill('9780000000002');
  await page.getByRole('button', { name: 'Add to bookshelf' }).click();
  await expect(page.getByTestId('import-status')).toHaveText('Book added.');
  await expect(page.getByRole('heading', { name: 'The Paper Moon' }).first()).toBeVisible();

  await page.getByLabel('Archive passphrase').fill('a sufficiently long passphrase');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export encrypted backup' }).click();
  const download = await downloadPromise;
  const archivePath = await download.path();
  expect(archivePath).not.toBeNull();
  await page.getByTestId('libby-file').setInputFiles(archivePath);
  await expect(page.getByTestId('import-status')).toHaveText(
    'Use Import archive under Add or transfer books.',
  );
  await expect(page.getByText('This file is an encrypted bookshelf archive')).toBeVisible();
  await page.getByTestId('archive-file').setInputFiles(archivePath);
  await expect(page.getByTestId('import-status')).toHaveText('Encrypted archive restored.');
  await expect(page.getByRole('heading', { name: 'The Paper Moon' }).first()).toBeVisible();

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
  await expect(page.getByText('Client-only and private by construction.')).toBeVisible();
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByText('Client-only and private by construction.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'The Paper Moon' }).first()).toBeVisible();
});
