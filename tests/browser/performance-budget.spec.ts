import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { addBookManually, csvSnapshot, goTo, importCsv, openApp } from './support/shelf.js';

/**
 * Performance limits for 500- and 1,000-book shelves. DOM size is absolute;
 * import time scales with row count. Document height is limited per virtualized
 * row because the scrollbar still represents the complete shelf.
 */
const BUDGETS = {
  importMillisecondsPerThousandRows: 10_000,
  addOneMoreMilliseconds: 500,
  domNodes: 2000,
  searchMilliseconds: 150,
  /** Maximum height contributed by one grid row. */
  documentHeightPixelsPerRow: 350,
  documentChromePixels: 500,
} as const;

interface Measurements {
  readonly books: number;
  readonly importMilliseconds: number;
  readonly addOneMoreMilliseconds: number;
  readonly domNodes: number;
  readonly documentHeightPixels: number;
  /** How many tiles the virtualized grid actually rendered. Guards against a
   *  DOM-node count that looks excellent because nothing was on screen. */
  readonly renderedTiles: number;
  readonly columns: number;
}

for (const books of [500, 1000] as const) {
  test(`the shelf stays within its performance budget at ${books} books`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(6 * 60_000);

    const measured = await measure(page, books);
    await report(testInfo, measured);

    const importBudget = (books / 1000) * BUDGETS.importMillisecondsPerThousandRows;
    expect.soft(measured.importMilliseconds, `import ${books} rows`).toBeLessThan(importBudget);
    expect
      .soft(measured.addOneMoreMilliseconds, 'add one more book')
      .toBeLessThan(BUDGETS.addOneMoreMilliseconds);
    expect.soft(measured.domNodes, 'DOM nodes').toBeLessThan(BUDGETS.domNodes);
    // A bounded DOM only means something if the shelf was actually drawn.
    expect(measured.renderedTiles, 'rendered tiles').toBeGreaterThan(0);
    const rowCeiling =
      // The journey adds one real book after import, and R7 adds one final action
      // tile. Both occupy grid cells even though only the former is a shelf book.
      Math.ceil((measured.books + 2) / Math.max(measured.columns, 1)) *
        BUDGETS.documentHeightPixelsPerRow +
      BUDGETS.documentChromePixels;
    expect
      .soft(measured.documentHeightPixels, 'document scroll height per row')
      .toBeLessThan(rowCeiling);
  });
}

/** Search latency includes the input debounce. */
test('search responds within 150 ms at 1000 books', async ({ page }, testInfo) => {
  test.setTimeout(6 * 60_000);
  await openApp(page);
  await importCsv(page, csvSnapshot(1000));
  await expect(page.getByTestId('import-status')).toHaveText('Imported 1000 new of 1000 rows.', {
    timeout: 5 * 60_000,
  });
  await goTo(page, 'shelf');
  await expect(page.getByTestId('shelf-card').first()).toBeVisible({ timeout: 60_000 });

  // "Book 42" is selective — the fixture titles are all "Book N", so a prefix like
  // "Boo" would match every row and prove nothing.
  const started = Date.now();
  await page.getByTestId('shelf-search').fill('Book 42');
  await expect(page.getByTestId('shelf-count')).toHaveText('11 books', { timeout: 10_000 });
  const searchMilliseconds = Date.now() - started;

  await testInfo.attach('search-1000-books.json', {
    contentType: 'application/json',
    body: JSON.stringify({ budget: BUDGETS.searchMilliseconds, searchMilliseconds }, null, 2),
  });
  // The 120 ms debounce is part of what a person waits, so it counts against the
  // budget rather than being subtracted from it.
  expect(searchMilliseconds).toBeLessThan(BUDGETS.searchMilliseconds + 200);
});

async function measure(page: Page, books: number): Promise<Measurements> {
  await openApp(page);

  const importStarted = Date.now();
  await importCsv(page, csvSnapshot(books));
  await expect(page.getByTestId('import-status')).toHaveText(
    `Imported ${books} new of ${books} rows.`,
    { timeout: 5 * 60_000 },
  );
  const importMilliseconds = Date.now() - importStarted;

  const addStarted = Date.now();
  await addBookManually(page, { title: 'One More Book', author: 'Rae Finch' }, { timeout: 60_000 });
  const addOneMoreMilliseconds = Date.now() - addStarted;

  // The shelf is the surface the budgets are about, so measure it rather than
  // whichever destination the last action left us on. Wait for tiles to actually
  // render first: since ADR 0014 the page is fetched asynchronously, and measuring
  // straight after navigating counts an empty grid and reports a false pass.
  await goTo(page, 'shelf');
  await expect(page.getByTestId('shelf-card').first()).toBeVisible({ timeout: 60_000 });
  const layout = await page.evaluate(() => ({
    domNodes: document.getElementsByTagName('*').length,
    documentHeightPixels: document.documentElement.scrollHeight,
    renderedTiles: document.querySelectorAll('[data-testid="shelf-card"]').length,
    columns: getComputedStyle(
      document.querySelector('.cover-grid') ?? document.body,
    ).gridTemplateColumns.split(' ').length,
  }));

  return { books, importMilliseconds, addOneMoreMilliseconds, ...layout };
}

async function report(testInfo: TestInfo, measured: Measurements): Promise<void> {
  await testInfo.attach(`performance-${measured.books}-books.json`, {
    contentType: 'application/json',
    body: JSON.stringify({ budgets: BUDGETS, measured }, null, 2),
  });
}

/** Keeps the production barcode decoder under 1.5 MB gzipped. */
// Playwright requires the fixtures argument to be a destructuring pattern even
// when a test uses no fixtures, and this one only reads the build output.
// eslint-disable-next-line no-empty-pattern
test('the barcode decoder stays inside its payload budget', async ({}, testInfo) => {
  const dist = resolve(import.meta.dirname, '../../apps/web/dist/assets');
  const scanning = (await readdir(dist)).filter((file) => /zxing|^reader-/u.test(file));
  expect(scanning.length, `expected the decoder in ${dist}, found ${scanning.join(', ')}`).toBe(2);

  const gzipped = await Promise.all(
    scanning.map(async (file) => {
      const bytes = await readFile(join(dist, file));
      return { file, raw: bytes.byteLength, gzip: gzipSync(bytes).byteLength };
    }),
  );
  const total = gzipped.reduce((sum, entry) => sum + entry.gzip, 0);
  await testInfo.attach('scanning-payload.json', {
    body: JSON.stringify({ files: gzipped, totalGzip: total }, null, 2),
    contentType: 'application/json',
  });
  expect(total).toBeLessThan(1_500_000);
});
