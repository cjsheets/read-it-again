import { expect, test } from '@playwright/test';
import {
  addBookManually,
  csvSnapshot,
  goTo,
  importCsv,
  importLibby,
  openApp,
  openBook,
} from './support/shelf.js';

/** Contextual errors, honest unrated state, and accurate provenance labels. */
test.describe('errors name the artefact they are about', () => {
  // A backup failure must not be reported as a Libby validation error.
  test('a bad passphrase does not blame the Libby file', async ({ page }) => {
    await openApp(page);
    await goTo(page, 'settings');
    await page.getByLabel('Backup password').fill('short');
    await page.getByRole('button', { name: 'Export encrypted backup' }).click();

    await expect(page.getByTestId('error-title')).toHaveText('That backup could not be created');
    await expect(page.getByRole('alert')).toContainText('at least 12 characters');
  });

  test('a malformed CSV names the CSV and says what a valid one looks like', async ({ page }) => {
    await openApp(page);
    await importCsv(page, Buffer.from('foo,bar\n1,2\n'), 'not-books.csv');

    await expect(page.getByTestId('error-title')).toHaveText('That CSV file could not be read');
    await expect(page.getByRole('alert')).toContainText('Could not find a title column');
    await expect(page.getByRole('alert')).toContainText('one of them must be a title');
  });

  test('an archive dropped in the Libby slot is identified as a backup', async ({ page }) => {
    await openApp(page);
    await importLibby(page, {
      name: 'backup.ria-archive',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ format: 'read-it-again-encrypted-v1' })),
    });

    await expect(page.getByTestId('error-title')).toHaveText('That is a backup, not a Libby file');
  });

  test('every error headline is distinct', async ({ page }) => {
    await openApp(page);
    const title = page.getByTestId('error-title');

    // Each headline is awaited by name rather than read as soon as the action
    // returns. Reading immediately can capture the *previous* error, which made
    // this pass locally and go flaky on slower CI hardware.
    await goTo(page, 'settings');
    await page.getByLabel('Backup password').fill('short');
    await page.getByRole('button', { name: 'Export encrypted backup' }).click();
    await expect(title).toHaveText('That backup could not be created');

    await importCsv(page, Buffer.from('foo,bar\n1,2\n'), 'not-books.csv');
    await expect(title).toHaveText('That CSV file could not be read');

    await importLibby(page, {
      name: 'broken.json',
      mimeType: 'application/json',
      buffer: Buffer.from('[{"title":{}}]'),
    });
    await expect(title).toHaveText('That Libby file could not be read');
  });
});

test.describe('ratings distinguish unrated from middling', () => {
  // New books must not start with fabricated ratings.
  test('a new book is unrated, with nothing selected and saving unavailable', async ({ page }) => {
    await openApp(page);
    await addBookManually(page, { title: 'The Gruffalo', author: 'Julia Donaldson' });

    // Assessments live in the detail view, not on every card.
    const detail = await openBook(page);
    await expect(detail.getByTestId('rating-unset')).toBeVisible();
    // Scoped to the rating dials: the reader buttons legitimately use aria-pressed
    // to show which reader a book is filed under.
    await expect(detail.locator('.rating-buttons button[aria-pressed="true"]')).toHaveCount(0);
    await expect(detail.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  });

  test('saving becomes available once a rating is chosen, and persists', async ({ page }) => {
    await openApp(page);
    await addBookManually(page, { title: 'The Gruffalo', author: 'Julia Donaldson' });

    const detail = await openBook(page);
    await detail.getByRole('button', { name: 'Kid liked it: 3 of 3 — loved it' }).click();
    const save = detail.getByRole('button', { name: 'Save', exact: true });
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByTestId('import-status')).toHaveText('Saved.');

    await page.reload();
    const reloaded = await openBook(page);
    await expect(reloaded.getByTestId('rating-unset')).toHaveCount(0);
    await expect(
      reloaded.getByRole('button', { name: 'Kid liked it: 3 of 3 — loved it' }),
    ).toHaveAttribute('aria-pressed', 'true');
    // Grown-up enjoyment was never touched, so it must still read as unset.
    await expect(
      reloaded.getByRole('button', { name: 'I liked it: 2 of 3 — a lot' }),
    ).toHaveAttribute('aria-pressed', 'false');
  });
});

test.describe('provenance is named honestly', () => {
  // ADR 0009 keeps manual additions separate from library checkouts.
  test('a typed-in book is labelled as added by you, not as a checkout', async ({ page }) => {
    await openApp(page);
    await addBookManually(page, { title: 'The Gruffalo', author: 'Julia Donaldson' });

    const detail = await openBook(page);
    await expect(detail.getByTestId('detail-provenance')).toContainText('Added by you');
    await page.getByRole('button', { name: 'Close' }).click();

    // Library facts live under Activity, and a typed-in book is not one.
    await goTo(page, 'activity');
    await page.getByText('Library borrowing history').click();
    await expect(page.getByText('Nothing borrowed from a library yet.')).toBeVisible();
    await expect(page.getByText('No borrowing history yet.')).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'The Gruffalo' })).toHaveCount(0);
  });

  test('a CSV import is labelled as a file import', async ({ page }) => {
    await openApp(page);
    await importCsv(page, csvSnapshot(1));
    await expect(page.getByTestId('import-status')).toHaveText('Imported 1 new of 1 rows.');

    const detail = await openBook(page);
    await expect(detail.getByTestId('detail-provenance')).toContainText('Imported from a CSV file');
  });
});
