import { expect, test, type Page } from '@playwright/test';
import {
  addBookManually,
  csvSnapshot,
  goTo,
  importCsv,
  openApp,
  openBook,
  shelfCards,
} from './support/shelf.js';

/**
 * F-03. There was exactly one reader, hardcoded as "Child", and no UI to create,
 * rename or select another. The schema has supported multiple readers since
 * migration 1 — the audit calls this the largest gap between built and exposed
 * capability in the product.
 */
/** Reader rows show the name in an editable input, so `hasText` cannot find them;
 *  the labelled field is the reliable handle. */
function readerRow(page: Page, name: string) {
  return page
    .getByTestId('reader-list')
    .getByRole('listitem')
    .filter({ has: page.getByLabel(`Name for ${name}`) });
}

async function addReader(page: Page, name: string): Promise<void> {
  await goTo(page, 'settings');
  // The list is fetched per destination, so it must be on screen before it can be
  // counted — reading too early gives zero and waits for the wrong total.
  await expect(page.getByTestId('reader-list').getByRole('listitem').first()).toBeVisible();
  const before = await page.getByTestId('reader-list').getByRole('listitem').count();
  await page.getByTestId('new-reader-name').fill(name);
  await page.getByRole('button', { name: 'Add reader' }).click();
  await expect(page.getByTestId('import-status')).toHaveText('Reader added.');
  // The list re-reads asynchronously after the mutation, so wait for it to settle
  // before acting on a row — otherwise a click can land on a half-updated list.
  await expect(page.getByTestId('reader-list').getByRole('listitem')).toHaveCount(before + 1);
  await expect(readerRow(page, name)).toHaveCount(1);
}

test.describe('reader management', () => {
  test('a household can add, rename and archive readers without the CLI', async ({ page }) => {
    await openApp(page);
    await goTo(page, 'settings');
    // One reader to begin with, and the app says what a second one changes.
    await expect(page.getByTestId('single-reader-note')).toBeVisible();

    await addReader(page, 'Ada');
    await expect(page.getByTestId('reader-list').getByRole('listitem')).toHaveCount(2);
    await expect(page.getByTestId('single-reader-note')).toHaveCount(0);

    await page.getByLabel('Name for Ada').fill('Ada B');
    await page.getByLabel('Name for Ada').blur();
    await expect(page.getByTestId('import-status')).toHaveText('Reader renamed.');

    await readerRow(page, 'Ada B').getByRole('button', { name: 'Archive' }).click();
    await expect(page.getByTestId('import-status')).toHaveText(
      'Reader archived. Their history is kept.',
    );
    await expect(page.getByTestId('reader-list').getByRole('listitem')).toHaveCount(1);
    // Archived, not deleted: the history that names them is still there.
    await expect(page.getByTestId('archived-readers')).toContainText('Ada B');
  });

  test('the last reader cannot be archived', async ({ page }) => {
    await openApp(page);
    await goTo(page, 'settings');

    const archive = page
      .getByTestId('reader-list')
      .getByRole('listitem')
      .first()
      .getByRole('button', { name: 'Archive' });
    await expect(archive).toBeDisabled();
  });

  test('an archived reader can be restored', async ({ page }) => {
    await openApp(page);
    await addReader(page, 'Kai');
    const archive = readerRow(page, 'Kai').getByRole('button', { name: 'Archive' });
    await expect(archive).toBeEnabled();
    await archive.click();
    await expect(page.getByTestId('archived-readers')).toContainText('Kai');

    await page.getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByTestId('import-status')).toHaveText('Reader restored.');
    // Back in the active list. Located by its labelled field, since the name is an
    // input value rather than text.
    await expect(readerRow(page, 'Kai')).toHaveCount(1);
  });
});

test.describe('the reader switcher', () => {
  test('appears only once there is a choice to make', async ({ page }) => {
    await openApp(page);
    // With one reader a switcher is a control with a single option (§2.3-B).
    await expect(page.getByTestId('reader-everyone')).toHaveCount(0);

    await addReader(page, 'Ada');
    await expect(page.getByTestId('reader-everyone')).toBeVisible();
  });

  test('filters the shelf to one reader and persists across a reload', async ({ page }) => {
    await openApp(page);
    await addReader(page, 'Ada');
    const ada = await readerId(page, 'Ada');

    // A book added while Ada is selected belongs to Ada, not to a hardcoded
    // default reader.
    await page.getByTestId(`reader-filter-${ada}`).click();
    await addBookManually(page, { title: 'Owl Babies', author: 'Martin Waddell' });
    await goTo(page, 'shelf');
    await expect(shelfCards(page)).toHaveCount(1);

    await page.getByTestId('reader-everyone').click();
    await expect(shelfCards(page)).toHaveCount(1);

    // The original reader has none of it.
    const child = await readerId(page, 'Child');
    await page.getByTestId(`reader-filter-${child}`).click();
    // Not the first-run screen: the household has books, this reader has none.
    await expect(page.getByTestId('reader-empty')).toBeVisible();
    await expect(page.getByTestId('first-run')).toHaveCount(0);

    // The choice is a view preference and survives a reload.
    await page.reload();
    await expect(page.getByTestId(`reader-filter-${child}`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('a book read by two readers is one card with two chips', async ({ page }) => {
    await openApp(page);
    await addBookManually(page, { title: 'The Gruffalo', author: 'Julia Donaldson' });
    await addReader(page, 'Ada');
    // The switcher appearing is the signal that the app knows about both readers,
    // which is what makes "For everyone" available in the drawer.
    await expect(page.getByTestId('reader-everyone')).toBeVisible();

    // Attribute the same work to both readers.
    const detail = await openBook(page);
    await expect(detail.getByRole('button', { name: 'For everyone' })).toBeVisible();
    await detail.getByRole('button', { name: 'For everyone' }).click();
    await expect(page.getByTestId('import-status')).toHaveText('Attribution correction saved.');

    // The drawer is modal, so it has to be closed before the switcher is reachable.
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByTestId('book-detail')).toHaveCount(0);
    await page.getByTestId('reader-everyone').click();
    await goTo(page, 'shelf');
    // One book with two chips, not the same book listed once per reader — the
    // card anatomy in audit §7.5.
    await expect(shelfCards(page)).toHaveCount(1);
    await expect(shelfCards(page).first().locator('.reader-chip')).toHaveCount(2);

    // And it is on both readers' shelves.
    const ada = await readerId(page, 'Ada');
    await page.getByTestId(`reader-filter-${ada}`).click();
    await expect(shelfCards(page)).toHaveCount(1);
    const child = await readerId(page, 'Child');
    await page.getByTestId(`reader-filter-${child}`).click();
    await expect(shelfCards(page)).toHaveCount(1);
  });
});

test.describe('attribution with more than one reader', () => {
  /**
   * ADR 0012's single-reader default stops applying the moment a second reader
   * exists, because the question finally has more than one possible answer. That
   * is correct, and it is a visible change in behaviour, so the app says so.
   */
  test('a second reader turns automatic filing into a real question', async ({ page }) => {
    await openApp(page);
    await addReader(page, 'Ada');

    await importCsv(page, csvSnapshot(3));
    await expect(page.getByTestId('import-status')).toHaveText('Imported 3 new of 3 rows.');

    // No longer decidable on its own, so it becomes reviewable work rather than a
    // silent guess.
    await expect(page.getByTestId('tasks-badge')).toBeVisible();
    await goTo(page, 'tasks');
    await expect(page.getByRole('heading', { name: 'Who was this for?' })).toBeVisible();

    // And the review offers a genuine choice between the two readers.
    await expect(page.getByRole('button', { name: 'For Ada', exact: true }).first()).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'For Child', exact: true }).first(),
    ).toBeVisible();
  });

  test('an archived reader is no longer offered a book', async ({ page }) => {
    await openApp(page);
    await addReader(page, 'Ada');
    await importCsv(page, csvSnapshot(1));
    await expect(page.getByTestId('import-status')).toHaveText('Imported 1 new of 1 rows.');
    await goTo(page, 'tasks');
    await expect(page.getByRole('button', { name: 'For Ada', exact: true }).first()).toBeVisible();

    await goTo(page, 'settings');
    await readerRow(page, 'Ada').getByRole('button', { name: 'Archive' }).click();
    await expect(page.getByTestId('import-status')).toHaveText(
      'Reader archived. Their history is kept.',
    );

    // One reader again, so there is nothing left to ask and no empty daily tab.
    await expect(page.getByTestId('nav-tasks')).toHaveCount(0);
  });
});

async function readerId(page: Page, displayName: string): Promise<string> {
  const button = page
    .locator('.reader-switcher button')
    .filter({ hasText: new RegExp(`^${displayName}$`, 'u') })
    .first();
  const testId = await button.getAttribute('data-testid');
  return (testId ?? '').replace('reader-filter-', '');
}
