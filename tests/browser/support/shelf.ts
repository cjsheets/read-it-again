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

/** The five destinations plus settings, as of the Increment 4 shell. */
export type Route = 'shelf' | 'add' | 'activity' | 'discover' | 'tasks' | 'settings';

/** Generates a CSV whose rows the generic adapter can infer without a mapping. */
export function csvSnapshot(rowCount: number, prefix = 'Book'): Buffer {
  const rows = ['Title,Author,ISBN,Date,Format'];
  for (let index = 0; index < rowCount; index += 1) {
    const isbn = (9_780_000_000_000 + index).toString();
    rows.push(`${prefix} ${index + 1},Author ${index + 1},${isbn},2026-08-01,Book`);
  }
  return Buffer.from(`${rows.join('\n')}\n`);
}

/** Opens the app and waits for the worker's first response to land. */
export async function openApp(page: Page, url = PRODUCTION_URL): Promise<void> {
  await page.goto(url);
  await expect(page.getByTestId('import-status')).not.toHaveText('Opening your private bookshelf…');
}

/** Navigates via the shell, the way a person would, rather than by URL. The book
 *  detail drawer is modal, so its scrim genuinely blocks the nav — closing it
 *  first is what a person has to do too. */
export async function goTo(page: Page, route: Route): Promise<void> {
  await closeDetail(page);
  await page.getByTestId(`nav-${route}`).click();
}

export async function closeDetail(page: Page): Promise<void> {
  const detail = page.getByTestId('book-detail');
  if ((await detail.count()) === 0) return;
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);
}

/**
 * Every book the household can actually rate, read, or be recommended against.
 * This is the object the product is about, and the thing every input path is
 * supposed to produce.
 */
export function shelfCards(page: Page): Locator {
  return page.getByTestId('shelf-card');
}

/** Imports live under Add since Increment 4, so the helper goes there first. */
export async function importCsv(page: Page, contents: Buffer, name = 'books.csv'): Promise<void> {
  await goTo(page, 'add');
  await page
    .getByTestId('csv-file')
    .setInputFiles({ name, mimeType: 'text/csv', buffer: contents });
}

export async function importLibby(
  page: Page,
  file: string | { name: string; mimeType: string; buffer: Buffer },
): Promise<void> {
  await goTo(page, 'add');
  await page.getByTestId('libby-file').setInputFiles(file);
}

export async function addBookManually(
  page: Page,
  book: { readonly title: string; readonly author?: string; readonly isbn?: string },
  options: { readonly timeout?: number } = {},
): Promise<void> {
  await goTo(page, 'add');
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

/** Backup and restore live under Settings since Increment 4. */
export async function exportArchive(page: Page, passphrase: string): Promise<Buffer> {
  await goTo(page, 'settings');
  await page.getByLabel('Archive passphrase').fill(passphrase);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export encrypted backup' }).click();
  const path = await (await downloadPromise).path();
  const { readFile } = await import('node:fs/promises');
  return readFile(path);
}

export async function importArchive(
  page: Page,
  archive: Buffer,
  passphrase: string,
): Promise<void> {
  await goTo(page, 'settings');
  await page.getByLabel('Archive passphrase').fill(passphrase);
  await page.getByTestId('archive-file').setInputFiles({
    name: 'backup.ria-archive',
    mimeType: 'application/json',
    buffer: archive,
  });
}

/** Counts the decisions the review queues are currently demanding of the user. */
export async function pendingDecisions(page: Page): Promise<number> {
  const badge = page.getByTestId('tasks-badge');
  if ((await badge.count()) === 0) return 0;
  return Number.parseInt((await badge.innerText()).trim(), 10) || 0;
}

/** Opens a book's detail drawer, which is where assessment, provenance and
 *  attribution live since Increment 5. */
export async function openBook(page: Page, index = 0): Promise<Locator> {
  await goTo(page, 'shelf');
  await shelfCards(page).nth(index).getByRole('button').click();
  const detail = page.getByTestId('book-detail');
  await expect(detail).toBeVisible();
  return detail;
}
