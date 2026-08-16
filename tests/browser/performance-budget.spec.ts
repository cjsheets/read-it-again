import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { addBookManually, csvSnapshot, goTo, importCsv, openApp } from './support/shelf.js';

/**
 * Audit §11 Tier 3 — synthetic budgets that catch F-04-class regressions without
 * needing users. Today the shelf renders every row: 1200 books produced 19 274 DOM
 * nodes and a 279 685 px document, and adding one more book took 5.7 s because every
 * mutation re-fetches and re-renders the whole dataset.
 *
 * Budgets are absolute, not proportional: "DOM nodes at any library size" means the
 * 1000-book number and the 500-book number are held to the same ceiling. Import time
 * is the one budget the audit states per-scale, so it scales with the row count.
 */
const BUDGETS = {
  importMillisecondsPerThousandRows: 10_000,
  addOneMoreMilliseconds: 500,
  domNodes: 2000,
  documentHeightPixels: 20_000,
} as const;

interface Measurements {
  readonly books: number;
  readonly importMilliseconds: number;
  readonly addOneMoreMilliseconds: number;
  readonly domNodes: number;
  readonly documentHeightPixels: number;
}

for (const books of [500, 1000] as const) {
  // F-04 · fixed by Increment 6 (virtualization, search, pagination).
  test(`the shelf stays within its performance budget at ${books} books`, async ({
    page,
  }, testInfo) => {
    test.fail(true, 'F-04: the UI renders every row. Fixed by Increment 6.');
    test.setTimeout(6 * 60_000);

    const measured = await measure(page, books);
    await report(testInfo, measured);

    const importBudget = (books / 1000) * BUDGETS.importMillisecondsPerThousandRows;
    expect.soft(measured.importMilliseconds, `import ${books} rows`).toBeLessThan(importBudget);
    expect
      .soft(measured.addOneMoreMilliseconds, 'add one more book')
      .toBeLessThan(BUDGETS.addOneMoreMilliseconds);
    expect.soft(measured.domNodes, 'DOM nodes').toBeLessThan(BUDGETS.domNodes);
    expect
      .soft(measured.documentHeightPixels, 'document scroll height')
      .toBeLessThan(BUDGETS.documentHeightPixels);
  });
}

// Search does not exist yet (F-04, audit J14), so its 150 ms budget has nothing to
// measure. Increment 6 introduces the query surface; this becomes a real test then.
test.skip('search responds within 150 ms at 1000 books', () => {
  // Intentionally empty: enable with the paged/filtered query surface in Increment 6.
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
  // whichever destination the last action left us on.
  await goTo(page, 'shelf');
  const layout = await page.evaluate(() => ({
    domNodes: document.getElementsByTagName('*').length,
    documentHeightPixels: document.documentElement.scrollHeight,
  }));

  return { books, importMilliseconds, addOneMoreMilliseconds, ...layout };
}

async function report(testInfo: TestInfo, measured: Measurements): Promise<void> {
  await testInfo.attach(`performance-${measured.books}-books.json`, {
    contentType: 'application/json',
    body: JSON.stringify({ budgets: BUDGETS, measured }, null, 2),
  });
}
