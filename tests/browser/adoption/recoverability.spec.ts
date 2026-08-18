import { expect, test } from '@playwright/test';
import {
  addBookManually,
  BULK_IMPORT_TIMEOUT,
  csvSnapshot,
  importCsv,
  openApp,
  openBook,
  shelfCards,
} from '../support/shelf.js';

test.describe('R3 — correctable and recoverable books', () => {
  test('a title correction updates shelf, search, and detail without a reload', async ({
    page,
  }) => {
    await openApp(page);
    await importCsv(page, csvSnapshot(11, 'Filler'));
    await expect(page.getByTestId('import-status')).toHaveText('Imported 11 new of 11 rows.', {
      timeout: BULK_IMPORT_TIMEOUT,
    });
    await addBookManually(page, { title: 'Clod Boat', author: 'Ada Fox' });
    const detail = await openBook(page);

    const edit = detail.getByRole('button', { name: 'Edit details' });
    await expect(edit).toBeVisible();
    await edit.click();
    await detail.getByLabel('Book title').fill('Cloud Boat');
    await detail.getByRole('button', { name: 'Save details' }).click();
    await expect(detail.getByRole('heading', { name: 'Cloud Boat' })).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(
      shelfCards(page).filter({ has: page.getByRole('button', { name: 'Open Cloud Boat' }) }),
    ).toHaveCount(1);
    await page.getByTestId('shelf-search').fill('Clod Boat');
    await expect(shelfCards(page)).toHaveCount(0);
    await page.getByTestId('shelf-search').fill('Cloud Boat');
    await expect(shelfCards(page)).toHaveCount(1);
  });

  test('the value before a correction remains inspectable', async ({ page }) => {
    await openApp(page);
    await addBookManually(page, { title: 'Clod Boat', author: 'Ada Fox' });
    const detail = await openBook(page);
    const edit = detail.getByRole('button', { name: 'Edit details' });
    await expect(edit).toBeVisible();
    await edit.click();
    await detail.getByLabel('Book title').fill('Cloud Boat');
    await detail.getByRole('button', { name: 'Save details' }).click();

    await detail.getByRole('button', { name: 'Show edit history' }).click();
    await expect(detail.getByTestId('book-edit-history')).toContainText('Clod Boat');
  });

  test('removing a book offers an immediate undo in the live status region', async ({ page }) => {
    await openApp(page);
    await addBookManually(page, { title: 'Cloud Boat' });
    const detail = await openBook(page);

    const remove = detail.getByRole('button', { name: 'Remove from shelf' });
    await expect(remove).toBeVisible();
    await remove.click();
    await expect(page.getByTestId('book-detail')).toHaveCount(0);
    await expect(shelfCards(page)).toHaveCount(0);
    const status = page.getByRole('status').filter({ hasText: 'Cloud Boat' });
    await status.getByRole('button', { name: 'Undo' }).click();
    await expect(
      shelfCards(page).filter({ has: page.getByRole('button', { name: 'Open Cloud Boat' }) }),
    ).toHaveCount(1);
  });
});
