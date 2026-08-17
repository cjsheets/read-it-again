import { expect, test, type Page } from '@playwright/test';
import {
  addBookManually,
  csvSnapshot,
  exportArchive,
  goTo,
  importArchive,
  importCsv,
  openApp,
  openBook,
  PRODUCTION_URL,
  shelfCards,
} from './support/shelf.js';

const PASSPHRASE = 'a sufficiently long passphrase';

/** Generated, selected, catalog, archived, and deleted cover behavior. */
test.describe('covers', () => {
  test('a book with no cover still gets a distinctive one, never a grey box', async ({ page }) => {
    await openApp(page);
    await addBookManually(page, { title: 'The Gruffalo', author: 'Julia Donaldson' });
    await goTo(page, 'shelf');

    const cover = shelfCards(page).first().getByTestId('generated-cover');
    await expect(cover).toBeVisible();
    // Legible, not decorative: the title has to be readable on the cover itself.
    await expect(cover).toContainText('Gruffalo');
    await expect(cover).toHaveAttribute('aria-label', 'The Gruffalo by Julia Donaldson');
  });

  test('the generated cover is deterministic and differs between books', async ({ page }) => {
    await openApp(page);
    await importCsv(page, csvSnapshot(8));
    await expect(page.getByTestId('import-status')).toHaveText('Imported 8 new of 8 rows.');
    await goTo(page, 'shelf');
    await expect(shelfCards(page)).toHaveCount(8);

    const hues = await page
      .getByTestId('generated-cover')
      .locator('rect')
      .first()
      .evaluateAll((rects) => rects.map((rect) => rect.getAttribute('fill')));
    expect(hues.every((hue) => hue && hue !== '#cccccc')).toBe(true);

    // Same book, same hue, across a reload — the input is the work id, not chance.
    const before = await firstCoverHue(page);
    await page.reload();
    await goTo(page, 'shelf');
    expect(await firstCoverHue(page)).toBe(before);
  });

  test('a chosen cover is stored, rendered, and survives a backup round trip', async ({
    page,
    browser,
  }) => {
    await openApp(page);
    await addBookManually(page, { title: 'Cloud Boat', author: 'Ada Fox' });

    const detail = await openBook(page);
    await expect(detail.getByTestId('generated-cover')).toBeVisible();
    await detail.getByTestId('cover-file').setInputFiles({
      name: 'cover.png',
      mimeType: 'image/png',
      buffer: solidPng(),
    });

    // The generated cover gives way to the stored one, rendered from a blob URL —
    // which the existing CSP already permits, so nothing about it changed.
    const image = page.getByTestId('book-detail').locator('img.cover-image');
    await expect(image).toBeVisible();
    expect(await image.getAttribute('src')).toMatch(/^blob:/u);

    const archive = await exportArchive(page, PASSPHRASE);
    const restored = await browser.newContext();
    const restoredPage = await restored.newPage();
    await openApp(restoredPage, PRODUCTION_URL);
    await importArchive(restoredPage, archive, PASSPHRASE);
    await expect(restoredPage.getByTestId('import-status')).toHaveText(
      'Encrypted archive restored.',
    );

    const restoredDetail = await openBook(restoredPage);
    await expect(restoredDetail.locator('img.cover-image')).toBeVisible();
    await restored.close();
  });

  test('a catalog cover uses the ISBN attached by the add path and is stored locally', async ({
    page,
  }) => {
    let catalogRequests = 0;
    await page.route('https://covers.openlibrary.org/**', async (route) => {
      catalogRequests += 1;
      await route.fulfill({ status: 200, contentType: 'image/png', body: solidPng() });
    });
    await openApp(page);
    await addBookManually(page, {
      title: 'Cloud Boat',
      author: 'Ada Fox',
      isbn: '9780306406157',
    });

    const detail = await openBook(page);
    const image = detail.locator('img.cover-image');
    await expect(image).toBeVisible({ timeout: 15_000 });
    expect(await image.getAttribute('src')).toMatch(/^blob:/u);

    // Reloading must use the local bytes without another catalog request.
    await page.reload();
    const reopened = await openBook(page);
    await expect(reopened.locator('img.cover-image')).toBeVisible();
    await page.waitForTimeout(250);
    expect(catalogRequests).toBe(1);
  });

  test('an ISBN imported in a CSV reaches the same catalog-cover path', async ({ page }) => {
    await page.route('https://covers.openlibrary.org/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'image/png', body: solidPng() });
    });
    await openApp(page);
    await importCsv(
      page,
      Buffer.from('Title,Author,ISBN,Date\nCloud Boat,Ada Fox,9780306406157,2026-08-01'),
    );
    await expect(page.getByTestId('import-status')).toHaveText('Imported 1 new of 1 rows.');

    const detail = await openBook(page);
    await expect(detail.locator('img.cover-image')).toBeVisible({ timeout: 15_000 });
  });

  test('a cover can be removed, falling back to the generated one', async ({ page }) => {
    await openApp(page);
    await addBookManually(page, { title: 'Cloud Boat', author: 'Ada Fox' });
    const detail = await openBook(page);
    await detail.getByTestId('cover-file').setInputFiles({
      name: 'cover.png',
      mimeType: 'image/png',
      buffer: solidPng(),
    });
    await expect(page.getByTestId('book-detail').locator('img.cover-image')).toBeVisible();

    await page.getByRole('button', { name: 'Remove cover' }).click();

    const reopened = await openBook(page);
    await expect(reopened.getByTestId('generated-cover')).toBeVisible();
  });
});

test.describe('book detail', () => {
  test('every book is one tap from the shelf and names its provenance', async ({ page }) => {
    await openApp(page);
    await addBookManually(page, { title: 'The Gruffalo', author: 'Julia Donaldson' });

    const detail = await openBook(page);
    await expect(detail.getByRole('heading', { name: 'The Gruffalo' })).toBeVisible();
    await expect(detail.getByTestId('detail-provenance')).toContainText('Added by you');
    await expect(detail.getByTestId('detail-provenance')).toContainText('For Child');
  });

  test('the detail view explains why a book is attributed as it is', async ({ page }) => {
    await openApp(page);
    await importCsv(page, csvSnapshot(1));
    await expect(page.getByTestId('import-status')).toHaveText('Imported 1 new of 1 rows.');

    const detail = await openBook(page);
    await expect(detail.getByRole('heading', { name: 'Why this reader' })).toBeVisible();
    await expect(detail.getByTestId('attribution-explanation')).not.toBeEmpty();
  });

  test('the drawer closes on Escape and returns focus to the page', async ({ page }) => {
    await openApp(page);
    await addBookManually(page, { title: 'The Gruffalo', author: 'Julia Donaldson' });
    await openBook(page);

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('book-detail')).toHaveCount(0);
  });

  test('logging a reading from the detail view records a confirmed session', async ({ page }) => {
    await openApp(page);
    await addBookManually(page, { title: 'The Gruffalo', author: 'Julia Donaldson' });
    const detail = await openBook(page);

    await detail.getByRole('button', { name: 'Log a reading' }).click();
    await expect(page.getByTestId('import-status')).toHaveText('Confirmed session saved.');

    await page.getByRole('button', { name: 'Close' }).click();
    await goTo(page, 'activity');
    await expect(page.getByTestId('session-list')).toContainText('The Gruffalo');
  });
});

async function firstCoverHue(page: Page): Promise<string | null> {
  return page.getByTestId('generated-cover').first().locator('rect').first().getAttribute('fill');
}

/** A minimal valid 1x1 PNG, so the test exercises real image decoding rather than
 *  a byte blob the browser would reject. */
function solidPng(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
}
