import path from 'node:path';
import { expect, test } from '@playwright/test';
import { goTo, importLibby, shelfCards } from './support/shelf.js';

const fixture = path.resolve('packages/test-fixtures/libby/timeline.json');

test('imports a Libby snapshot idempotently and reports invalid files without writes', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4174/');
  await expect(page.getByTestId('import-status')).toHaveText('No books imported yet.');

  await importLibby(page, fixture);
  await expect(page.getByTestId('import-status')).toHaveText('Imported 2 new of 2 rows.');
  // ADR 0012: no catalog means no candidates, so the browser takes the source
  // record at its word rather than parking it in a queue.
  await goTo(page, 'shelf');
  await expect(shelfCards(page)).toHaveCount(2);
  await expect(shelfCards(page).filter({ hasText: 'The Moonlit Kite' })).toHaveCount(1);
  await expect(shelfCards(page).filter({ hasText: 'Bear Counts the Stars' })).toHaveCount(1);
  await expect(page.getByTestId('tasks-badge')).toHaveCount(0);

  await importLibby(page, fixture);
  await expect(page.getByTestId('import-status')).toHaveText(
    'Already up to date — 2 rows checked, 0 new.',
  );
  await goTo(page, 'shelf');
  await expect(shelfCards(page)).toHaveCount(2);

  await importLibby(page, {
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('[{"title":{}}]'),
  });
  await expect(page.getByTestId('error-title')).toHaveText('That Libby file could not be read');
  await expect(page.getByRole('alert')).toContainText('Entry 1: the title is missing or invalid.');
  await expect(page.getByTestId('import-status')).toHaveText(
    'Nothing was imported. Fix the file and try again.',
  );
  // The failed import wrote nothing.
  await goTo(page, 'shelf');
  await expect(shelfCards(page)).toHaveCount(2);
});
