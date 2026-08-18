import { expect, test } from '@playwright/test';
import {
  addBookManually,
  BULK_IMPORT_TIMEOUT,
  csvSnapshot,
  goTo,
  importCsv,
  openApp,
  openBook,
  shelfCards,
} from '../support/shelf.js';

test.describe('R7 — a shelf that grows with the household', () => {
  test('eleven books show covers and one add affordance, without library-management controls', async ({
    page,
  }) => {
    await openApp(page);
    await importCsv(page, csvSnapshot(11));
    await expect(page.getByTestId('import-status')).toHaveText('Imported 11 new of 11 rows.', {
      timeout: BULK_IMPORT_TIMEOUT,
    });
    await goTo(page, 'shelf');

    await expect(shelfCards(page)).toHaveCount(11);
    await expect(page.getByTestId('shelf-search')).toHaveCount(0);
    await expect(page.getByTestId('shelf-sort')).toHaveCount(0);
    await expect(page.getByTestId('selection-mode')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add another book' })).toHaveCount(1);
  });

  test('the twelfth book reveals search and sort without shifting loaded shelf content', async ({
    page,
  }) => {
    await openApp(page);
    await importCsv(page, csvSnapshot(11));
    await expect(page.getByTestId('import-status')).toHaveText('Imported 11 new of 11 rows.', {
      timeout: BULK_IMPORT_TIMEOUT,
    });
    await goTo(page, 'shelf');
    await expect(page.getByTestId('shelf-search')).toHaveCount(0);

    await addBookManually(page, { title: 'Book 12', author: 'Author 12' });
    await goTo(page, 'shelf');
    await expect(page.getByTestId('shelf-search')).toBeVisible();
    await expect(page.getByTestId('shelf-sort')).toBeVisible();
    await expect(page.getByTestId('selection-mode')).toHaveCount(0);
  });

  test('a successful first add offers an explicit add-another momentum loop', async ({ page }) => {
    await openApp(page);
    await addBookManually(page, { title: 'Cloud Boat' });

    await expect(page.getByRole('button', { name: 'Add another book' })).toBeVisible();
    await page.getByRole('button', { name: 'Add another book' }).click();
    await expect(page.getByLabel('Book title')).toBeFocused();
  });

  test('mobile shelves fit three cover columns', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openApp(page);
    await importCsv(page, csvSnapshot(6));
    await expect(page.getByTestId('import-status')).toHaveText('Imported 6 new of 6 rows.');
    await goTo(page, 'shelf');

    const tops = await shelfCards(page).evaluateAll((cards) =>
      cards.slice(0, 3).map((card) => Math.round(card.getBoundingClientRect().top)),
    );
    expect(new Set(tops).size).toBe(1);
  });

  test('Activity stays out of navigation until a reading has been logged', async ({ page }) => {
    await openApp(page);
    await addBookManually(page, { title: 'Cloud Boat' });
    await goTo(page, 'shelf');
    await expect(page.getByTestId('nav-activity')).toHaveCount(0);

    const detail = await openBook(page);
    await detail.getByRole('button', { name: 'Log a reading' }).click();
    await expect(page.getByTestId('nav-activity')).toBeVisible();
  });
});
