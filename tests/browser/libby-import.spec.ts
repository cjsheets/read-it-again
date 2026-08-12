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
  await expect(page.getByRole('heading', { name: 'The Moonlit Kite' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Bear Counts the Stars' })).toBeVisible();

  await input.setInputFiles(fixture);
  await expect(page.getByTestId('import-status')).toHaveText(
    'Already up to date — 2 rows checked, 0 new.',
  );
  await expect(page.getByTestId('record-count')).toHaveText('2 books');

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
