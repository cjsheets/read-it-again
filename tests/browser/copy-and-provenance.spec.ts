import { expect, test } from '@playwright/test';
import { addBookManually, csvSnapshot, importCsv, openApp, shelfCards } from './support/shelf.js';

/**
 * Increment 1's copy and labelling work: contextual errors (F-06, N10), an honest
 * unrated state (F-12, N11), and provenance that does not describe a typed-in book
 * as a library checkout (F-13, N12).
 */
test.describe('errors name the artefact they are about', () => {
  // F-06: all five of these once shared the headline "Libby file could not be
  // validated", which sent users to debug the wrong file.
  test('a bad passphrase does not blame the Libby file', async ({ page }) => {
    await openApp(page);
    await page.getByLabel('Archive passphrase').fill('short');
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
    await page.getByTestId('libby-file').setInputFiles({
      name: 'backup.ria-archive',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ format: 'read-it-again-encrypted-v1' })),
    });

    await expect(page.getByTestId('error-title')).toHaveText('That is a backup, not a Libby file');
  });

  test('every error headline is distinct', async ({ page }) => {
    await openApp(page);
    const seen = new Set<string>();

    await page.getByLabel('Archive passphrase').fill('short');
    await page.getByRole('button', { name: 'Export encrypted backup' }).click();
    seen.add(await page.getByTestId('error-title').innerText());

    await importCsv(page, Buffer.from('foo,bar\n1,2\n'), 'not-books.csv');
    seen.add(await page.getByTestId('error-title').innerText());

    await page.getByTestId('libby-file').setInputFiles({
      name: 'broken.json',
      mimeType: 'application/json',
      buffer: Buffer.from('[{"title":{}}]'),
    });
    seen.add(await page.getByTestId('error-title').innerText());

    expect(seen.size).toBe(3);
  });
});

test.describe('ratings distinguish unrated from middling', () => {
  // F-12: the dials defaulted to 2 and rendered aria-pressed="true", so an
  // untouched shelf looked fully assessed and a stray save wrote a fabricated 2/2.
  test('a new book is unrated, with nothing selected and saving unavailable', async ({ page }) => {
    await openApp(page);
    await addBookManually(page, { title: 'The Gruffalo', author: 'Julia Donaldson' });

    const card = shelfCards(page).first();
    await expect(card.getByTestId('rating-unset')).toBeVisible();
    await expect(card.getByRole('button', { pressed: true })).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Save assessment' })).toBeDisabled();
  });

  test('saving becomes available once a rating is chosen, and persists', async ({ page }) => {
    await openApp(page);
    await addBookManually(page, { title: 'The Gruffalo', author: 'Julia Donaldson' });

    const card = shelfCards(page).first();
    await card.getByRole('button', { name: 'Child engagement: 3 of 3 — loved it' }).click();
    const save = card.getByRole('button', { name: 'Save assessment' });
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByTestId('import-status')).toHaveText('Assessment saved.');

    await page.reload();
    const reloaded = shelfCards(page).first();
    await expect(reloaded.getByTestId('rating-unset')).toHaveCount(0);
    await expect(
      reloaded.getByRole('button', { name: 'Child engagement: 3 of 3 — loved it' }),
    ).toHaveAttribute('aria-pressed', 'true');
    // Adult tolerance was never touched, so it must still read as unset.
    await expect(
      reloaded.getByRole('button', { name: 'Adult tolerance: 2 of 3 — a lot' }),
    ).toHaveAttribute('aria-pressed', 'false');
  });
});

test.describe('provenance is named honestly', () => {
  // F-13: ADR 0009 turns on checkout != acquisition != reading. The UI had
  // collapsed all three, captioning typed-in books as "imported library facts".
  test('a typed-in book is labelled as added by you, not as a checkout', async ({ page }) => {
    await openApp(page);
    await addBookManually(page, { title: 'The Gruffalo', author: 'Julia Donaldson' });

    await expect(shelfCards(page).first()).toContainText('Added by you');

    const shelf = page.getByTestId('shelf');
    await expect(shelf).toContainText('Nothing borrowed from a library yet.');
    await expect(shelf).toContainText('No borrowing history yet.');
    // The book must not appear under either library-facts heading.
    await expect(shelf.getByRole('listitem').filter({ hasText: 'The Gruffalo' })).toHaveCount(0);
  });

  test('a CSV import is labelled as a file import', async ({ page }) => {
    await openApp(page);
    await importCsv(page, csvSnapshot(1));
    await expect(page.getByTestId('record-count')).toHaveText('1 books');

    // Resolve and attribute so the book reaches the shelf; until Increment 2 this
    // is still manual, which is exactly what shelf-journey.spec.ts asserts.
    await page.getByRole('button', { name: 'Use source details' }).click();
    await page.getByRole('button', { name: 'For Child', exact: true }).click();

    await expect(shelfCards(page).first()).toContainText('Imported from a CSV file');
  });
});
