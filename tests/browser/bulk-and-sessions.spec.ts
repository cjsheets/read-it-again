import { expect, test, type Page } from '@playwright/test';
import {
  addBookManually,
  BULK_IMPORT_TIMEOUT,
  csvSnapshot,
  goTo,
  importCsv,
  openApp,
  openBook,
  shelfCards,
} from './support/shelf.js';

async function addReader(page: Page, name: string): Promise<void> {
  await goTo(page, 'settings');
  await expect(page.getByTestId('reader-list').getByRole('listitem').first()).toBeVisible();
  const before = await page.getByTestId('reader-list').getByRole('listitem').count();
  await page.getByTestId('new-reader-name').fill(name);
  await page.getByRole('button', { name: 'Add reader' }).click();
  await expect(page.getByTestId('reader-list').getByRole('listitem')).toHaveCount(before + 1);
}

/** Bulk reader assignment from Tasks and the shelf. */
test.describe('selecting several books at once', () => {
  test('files a whole queue at once after a second reader arrives', async ({ page }) => {
    await openApp(page);
    await importCsv(page, csvSnapshot(4));
    await expect(page.getByTestId('import-status')).toHaveText('Imported 4 new of 4 rows.', {
      timeout: BULK_IMPORT_TIMEOUT,
    });
    await goTo(page, 'shelf');
    await expect(shelfCards(page)).toHaveCount(4);

    // Adding a second reader means the app can no longer tell whose books these
    // are, so they move to Tasks (ADR 0012). That is correct and it empties the
    // shelf, which is exactly why filing them one at a time is not acceptable.
    await addReader(page, 'Ada');
    await goTo(page, 'shelf');
    await expect(page.getByTestId('first-run')).toBeVisible();

    await goTo(page, 'tasks');
    await expect(page.getByTestId('attribution-count')).toHaveText('4 pending');
    await page.getByTestId('bulk-attribution').waitFor();
    const ada = await readerButtonId(page, 'Ada');
    await page.getByTestId(`file-all-${ada}`).click();
    await expect(page.getByTestId('import-status')).toHaveText('4 books filed.');

    // All four are back, and they belong to Ada.
    await goTo(page, 'shelf');
    await expect(shelfCards(page)).toHaveCount(4);
    await page.getByTestId(`reader-filter-${ada}`).click();
    await expect(shelfCards(page)).toHaveCount(4);
  });

  test('files a selection of books already on the shelf', async ({ page }) => {
    await openApp(page);
    await addReader(page, 'Ada');
    await importCsv(page, csvSnapshot(12));
    await expect(page.getByTestId('import-status')).toHaveText('Imported 12 new of 12 rows.');
    await goTo(page, 'tasks');
    const ada = await readerButtonId(page, 'Ada');
    await page.getByTestId(`file-all-${ada}`).click();
    await expect(page.getByTestId('import-status')).toHaveText('12 books filed.');

    await goTo(page, 'shelf');
    await expect(shelfCards(page)).toHaveCount(12);
    await page.getByTestId('shelf-more').click();
    await page.getByRole('button', { name: 'Select books' }).click();
    await shelfCards(page).nth(0).getByRole('checkbox').check();
    await shelfCards(page).nth(1).getByRole('checkbox').check();
    await expect(page.getByTestId('selection-count')).toHaveText('2 books selected');

    const child = await readerButtonId(page, 'Child');
    await page.getByTestId(`bulk-assign-${child}`).click();
    await expect(page.getByTestId('import-status')).toHaveText('2 books filed.');

    await page.getByTestId(`reader-filter-${child}`).click();
    await expect(shelfCards(page)).toHaveCount(2);
    await page.getByTestId(`reader-filter-${ada}`).click();
    await expect(shelfCards(page)).toHaveCount(10);
  });

  test('selecting turns a tap into a second selection rather than opening a book', async ({
    page,
  }) => {
    await openApp(page);
    await importCsv(page, csvSnapshot(12));
    await expect(page.getByTestId('import-status')).toHaveText('Imported 12 new of 12 rows.');
    await goTo(page, 'shelf');

    await page.getByTestId('shelf-more').click();
    await page.getByRole('button', { name: 'Select books' }).click();
    await shelfCards(page).nth(0).getByRole('checkbox').check();
    await shelfCards(page).nth(1).getByRole('button').click();

    await expect(page.getByTestId('selection-count')).toHaveText('2 books selected');
    // A mis-tap while selecting must not lose the selection behind a drawer.
    await expect(page.getByTestId('book-detail')).toHaveCount(0);

    await page.getByTestId('clear-selection').click();
    await expect(page.getByTestId('selection-bar')).toHaveCount(0);
  });
});

/** Quick reading logs remain editable after they are created. */
test.describe('logging a reading', () => {
  test('one tap logs, and the session stays correctable', async ({ page }) => {
    await openApp(page);
    await addBookManually(page, { title: 'The Gruffalo', author: 'Julia Donaldson' });

    const detail = await openBook(page);
    const logTop = await detail
      .getByTestId('log-a-reading')
      .evaluate((element) => element.getBoundingClientRect().top);
    const ratingsTop = await detail
      .getByRole('heading', { name: 'How did it go?' })
      .evaluate((element) => element.getBoundingClientRect().top);
    expect(logTop).toBeLessThan(ratingsTop);
    await detail.getByTestId('log-a-reading').click();
    await expect(page.getByTestId('import-status')).toHaveText('Confirmed session saved.');
    await expect(detail.getByTestId('session-logged')).toBeVisible();

    // Yesterday can be logged, which the hardcoded timestamp made impossible.
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await detail.getByTestId('session-date').fill(yesterday);
    await expect(page.getByTestId('import-status')).toHaveText('Reading updated.');

    await detail.getByTestId('session-context').selectOption('travel');
    await expect(page.getByTestId('import-status')).toHaveText('Reading updated.');

    await page.getByRole('button', { name: 'Close' }).click();
    await goTo(page, 'activity');
    await expect(page.getByTestId('session-list')).toContainText('travel');
    await expect(page.getByTestId('session-list')).toContainText(
      new Date(`${yesterday}T12:00:00`).toLocaleDateString(),
    );
  });

  test('a book read to two children records both', async ({ page }) => {
    await openApp(page);
    await addBookManually(page, { title: 'Owl Babies', author: 'Martin Waddell' });
    await addReader(page, 'Ada');

    const detail = await openBook(page);
    await detail.getByTestId('log-a-reading').click();
    await expect(detail.getByTestId('session-logged')).toBeVisible();

    await detail.getByRole('checkbox', { name: 'Ada' }).check();
    await expect(page.getByTestId('import-status')).toHaveText('Reading updated.');

    await page.getByRole('button', { name: 'Close' }).click();
    await goTo(page, 'activity');
    await expect(page.getByTestId('session-list')).toContainText('Ada');
    await expect(page.getByTestId('session-list')).toContainText('Child');
  });
});

async function readerButtonId(page: Page, displayName: string): Promise<string> {
  const button = page
    .locator('.reader-switcher button')
    .filter({ hasText: new RegExp(`^${displayName}$`, 'u') })
    .first();
  return ((await button.getAttribute('data-testid')) ?? '').replace('reader-filter-', '');
}
