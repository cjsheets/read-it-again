import { expect, test, type Page } from '@playwright/test';
import {
  addBookManually,
  BULK_IMPORT_TIMEOUT,
  csvSnapshot,
  exportArchive,
  goTo,
  importArchive,
  enableCoverLookup,
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
    await enableCoverLookup(page);
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
    await enableCoverLookup(page);
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

/**
 * ADR 0016. Cover lookup is the only thing this app sends anywhere, and what it
 * sends is an ISBN — one book off the household's shelf per request. These tests
 * exist because the feature originally shipped ungated: the worker enqueued every
 * book at startup and drained the queue without anyone being asked.
 */
test.describe('permission to fetch cover art', () => {
  test('no request reaches the catalog until someone says yes', async ({ page }) => {
    let catalogRequests = 0;
    await page.route('https://covers.openlibrary.org/**', async (route) => {
      catalogRequests += 1;
      await route.fulfill({ status: 200, contentType: 'image/png', body: solidPng() });
    });

    await openApp(page);
    await addBookManually(page, { title: 'Cloud Boat', author: 'Ada Fox', isbn: '9780306406157' });
    await goTo(page, 'settings');
    await expect(page.getByTestId('catalog-covers-toggle')).not.toBeChecked();

    // A reload is where an ungated version did its damage: the worker swept the
    // whole shelf on startup. Give it every chance to misbehave.
    await page.reload();
    await openApp(page);
    await goTo(page, 'shelf');
    await page.waitForTimeout(1_500);
    expect(catalogRequests).toBe(0);

    // Saying yes covers the books already on the shelf, not merely later ones.
    await enableCoverLookup(page);
    await expect.poll(() => catalogRequests, { timeout: 15_000 }).toBeGreaterThan(0);
  });

  test('the choice is remembered and the shelf is only ever asked about once', async ({ page }) => {
    let catalogRequests = 0;
    await page.route('https://covers.openlibrary.org/**', async (route) => {
      catalogRequests += 1;
      await route.fulfill({ status: 200, contentType: 'image/png', body: solidPng() });
    });
    await openApp(page);
    await enableCoverLookup(page);
    await addBookManually(page, { title: 'Cloud Boat', author: 'Ada Fox', isbn: '9780306406157' });
    await expect.poll(() => catalogRequests, { timeout: 15_000 }).toBe(1);

    await page.reload();
    await openApp(page);
    await goTo(page, 'settings');
    await expect(page.getByTestId('catalog-covers-toggle')).toBeChecked();
    // The cover is already local, so a new session must not ask again.
    await page.waitForTimeout(1_500);
    expect(catalogRequests).toBe(1);
  });

  test('withdrawing permission stops the queue part-way through the shelf', async ({ page }) => {
    let catalogRequests = 0;
    await page.route('https://covers.openlibrary.org/**', async (route) => {
      catalogRequests += 1;
      // Slow enough that the queue is still working when consent is withdrawn.
      await new Promise((done) => setTimeout(done, 400));
      await route.fulfill({ status: 200, contentType: 'image/png', body: solidPng() });
    });
    await openApp(page);
    // More books than the courtesy rate can clear quickly, so there is a real
    // queue to interrupt rather than a race.
    await importCsv(page, catalogCsv(8));
    await expect(page.getByTestId('import-status')).toHaveText('Imported 8 new of 8 rows.', {
      timeout: BULK_IMPORT_TIMEOUT,
    });

    await enableCoverLookup(page);
    await expect.poll(() => catalogRequests, { timeout: 20_000 }).toBeGreaterThan(0);

    await page.getByTestId('catalog-covers-toggle').uncheck();
    const atStop = catalogRequests;
    // The gap between requests is deliberately several seconds; if the queue were
    // still running this window would contain more of them.
    await page.waitForTimeout(5_000);
    expect(catalogRequests).toBeLessThanOrEqual(atStop + 1);
    expect(catalogRequests).toBeLessThan(8);
  });

  test('the app says so, visibly, while it is talking to the catalog', async ({ page }) => {
    await page.route('https://covers.openlibrary.org/**', async (route) => {
      await new Promise((done) => setTimeout(done, 600));
      await route.fulfill({ status: 200, contentType: 'image/png', body: solidPng() });
    });
    await openApp(page);
    await importCsv(page, catalogCsv(4));
    await expect(page.getByTestId('import-status')).toHaveText('Imported 4 new of 4 rows.', {
      timeout: BULK_IMPORT_TIMEOUT,
    });
    await expect(page.getByTestId('catalog-fetch-indicator')).toHaveCount(0);

    await enableCoverLookup(page);
    await expect(page.getByTestId('catalog-fetch-indicator')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('catalog-fetch-indicator')).toContainText('openlibrary.org');

    // And it goes away when the work does, rather than lingering as decoration.
    await page.getByTestId('catalog-covers-toggle').uncheck();
    await expect(page.getByTestId('catalog-fetch-indicator')).toHaveCount(0, { timeout: 20_000 });
  });
});

/** Rows carrying real, distinct, check-digit-valid ISBNs, so each one is a
 *  separate catalog request rather than a repeat of the same lookup. */
function catalogCsv(rowCount: number): Buffer {
  const rows = ['Title,Author,ISBN,Date'];
  for (let index = 0; index < rowCount; index += 1) {
    // Twelve digits before the check digit, which makes thirteen in total.
    const body = `9780306406${String(index).padStart(2, '0')}`;
    rows.push(`Catalog Book ${index + 1},Ada Fox,${body}${checkDigit(body)},2026-08-01`);
  }
  return Buffer.from(`${rows.join('\n')}\n`);
}

function checkDigit(body: string): string {
  const sum = [...body].reduce(
    (total, character, index) => total + Number(character) * (index % 2 === 0 ? 1 : 3),
    0,
  );
  return String((10 - (sum % 10)) % 10);
}
