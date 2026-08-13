import path from 'node:path';
import { expect, test } from '@playwright/test';

const fixture = path.resolve('packages/test-fixtures/libby/timeline.json');

test('imports a Libby snapshot idempotently and reports invalid files without writes', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4174/');
  await expect(page.getByTestId('import-status')).toHaveText('No books imported yet.');

  const input = page.getByTestId('libby-file');
  await input.setInputFiles(fixture);
  await expect(page.getByTestId('import-status')).toHaveText('Imported 2 new of 2 rows.');
  await expect(page.getByTestId('record-count')).toHaveText('2 books');
  await expect(page.getByTestId('resolution-count')).toHaveText('2 pending');
  const importInbox = page.getByLabel('Import inbox');
  await expect(importInbox.getByRole('heading', { name: 'The Moonlit Kite' })).toBeVisible();
  await expect(importInbox.getByRole('heading', { name: 'Bear Counts the Stars' })).toBeVisible();

  await input.setInputFiles(fixture);
  await expect(page.getByTestId('import-status')).toHaveText(
    'Already up to date — 2 rows checked, 0 new.',
  );
  await expect(page.getByTestId('record-count')).toHaveText('2 books');

  await page.getByRole('button', { name: 'Use source details' }).first().click();
  await expect(page.getByTestId('resolution-count')).toHaveText('1 pending');
  await page.getByRole('button', { name: 'Not a book' }).click();
  await expect(page.getByTestId('resolution-count')).toHaveCount(0);

  await input.setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('[{"title":{}}]'),
  });
  await expect(page.getByRole('alert')).toContainText('0.title.text');
  await expect(page.getByTestId('import-status')).toHaveText(
    'Nothing was imported. Fix the file and try again.',
  );
  await expect(page.getByTestId('record-count')).toHaveText('2 books');
});
