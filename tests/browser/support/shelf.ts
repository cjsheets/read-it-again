import { expect, type Locator, type Page } from '@playwright/test';

/**
 * The production build served by `vite preview` with the real COOP/COEP headers.
 * Journey, budget, and accessibility assertions run here rather than against the
 * dev server, because these are claims about the artifact that ships.
 */
export const PRODUCTION_URL = 'http://127.0.0.1:4175/';

/**
 * Waiting room for a bulk import. Since ADR 0012 every imported row is resolved,
 * attributed, and folded into the reading model, so import duration scales with
 * row count — a 50-row file exceeds Playwright's 5s default on CI hardware.
 * These assertions are waiting for completion, not asserting a time bound; the
 * actual timing bar lives in `performance-budget.spec.ts` (F-04).
 */
export const BULK_IMPORT_TIMEOUT = 60_000;

/** Generates a CSV whose rows the generic adapter can infer without a mapping. */
export function csvSnapshot(rowCount: number, prefix = 'Book'): Buffer {
  const rows = ['Title,Author,ISBN,Date,Format'];
  for (let index = 0; index < rowCount; index += 1) {
    const isbn = (9_780_000_000_000 + index).toString();
    rows.push(`${prefix} ${index + 1},Author ${index + 1},${isbn},2026-08-01,Book`);
  }
  return Buffer.from(`${rows.join('\n')}\n`);
}

/** Opens the app and waits for the worker's first inbox response to land. */
export async function openApp(page: Page, url = PRODUCTION_URL): Promise<void> {
  await page.goto(url);
  await expect(page.getByTestId('import-status')).not.toHaveText('Opening your private bookshelf…');
}

/**
 * Every book the household can actually rate, read, or be recommended against.
 * This is the object the product is about, and the thing every input path is
 * supposed to produce.
 */
export function shelfCards(page: Page): Locator {
  return page.getByTestId('shelf-card');
}

export async function importCsv(page: Page, contents: Buffer, name = 'books.csv'): Promise<void> {
  await page
    .getByTestId('csv-file')
    .setInputFiles({ name, mimeType: 'text/csv', buffer: contents });
}

export async function addBookManually(
  page: Page,
  book: { readonly title: string; readonly author?: string; readonly isbn?: string },
  options: { readonly timeout?: number } = {},
): Promise<void> {
  await page.getByLabel('Book title').fill(book.title);
  if (book.author) await page.getByLabel('Book author').fill(book.author);
  if (book.isbn) await page.getByLabel('Book ISBN').fill(book.isbn);
  const submit = page.getByRole('button', { name: 'Add to bookshelf' });
  await submit.click();
  // The form clears and re-enables only once the worker round-trip resolves.
  // Without waiting, a following fill() is wiped by the previous add's reset.
  await expect(page.getByLabel('Book title')).toHaveValue('', options);
  await expect(submit).toBeEnabled(options);
}

/** Counts the decisions the review queues are currently demanding of the user. */
export async function pendingDecisions(page: Page): Promise<number> {
  const counts = await Promise.all(
    (['resolution-count', 'attribution-count'] as const).map(async (testId) => {
      const label = page.getByTestId(testId);
      if ((await label.count()) === 0) return 0;
      return Number.parseInt((await label.innerText()).trim(), 10) || 0;
    }),
  );
  return counts.reduce((total, count) => total + count, 0);
}
