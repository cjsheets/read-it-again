import { expect, test } from '@playwright/test';
import {
  BULK_IMPORT_TIMEOUT,
  csvSnapshot,
  goTo,
  importCsv,
  openApp,
  shelfCards,
} from './support/shelf.js';

/**
 * F-04 and ADR 0014. The shelf reads a page at a time and renders only what is
 * near the viewport. These assert the behaviour that makes that safe rather than
 * merely fast — the budgets in `performance-budget.spec.ts` cover the speed.
 */
test.describe('a virtualized shelf', () => {
  test('renders a window, not the library, and still reports the true total', async ({ page }) => {
    await openApp(page);
    await importCsv(page, csvSnapshot(300));
    await expect(page.getByTestId('import-status')).toHaveText('Imported 300 new of 300 rows.', {
      timeout: BULK_IMPORT_TIMEOUT,
    });
    await goTo(page, 'shelf');
    await expect(shelfCards(page).first()).toBeVisible();

    await expect(page.getByTestId('shelf-count')).toHaveText('300 books');
    const rendered = await shelfCards(page).count();
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(300);
  });

  /**
   * The risk the audit names explicitly: a windowed grid tells assistive technology
   * "1 of 24" when the shelf holds hundreds. axe cannot catch this, because it has
   * no way to know the list is windowed, so it is asserted directly.
   */
  test('tells assistive technology the real size and position of every tile', async ({ page }) => {
    await openApp(page);
    await importCsv(page, csvSnapshot(300));
    await expect(page.getByTestId('import-status')).toHaveText('Imported 300 new of 300 rows.', {
      timeout: BULK_IMPORT_TIMEOUT,
    });
    await goTo(page, 'shelf');
    await expect(shelfCards(page).first()).toBeVisible();

    await expect(shelfCards(page).first()).toHaveAttribute('aria-setsize', '300');
    await expect(shelfCards(page).first()).toHaveAttribute('aria-posinset', '1');
    await expect(shelfCards(page).nth(5)).toHaveAttribute('aria-posinset', '6');
  });

  test('scrolling reveals later books without growing the DOM', async ({ page }) => {
    await openApp(page);
    await importCsv(page, csvSnapshot(300));
    await expect(page.getByTestId('import-status')).toHaveText('Imported 300 new of 300 rows.', {
      timeout: BULK_IMPORT_TIMEOUT,
    });
    await goTo(page, 'shelf');
    await expect(shelfCards(page).first()).toBeVisible();
    const before = await page.evaluate(() => document.getElementsByTagName('*').length);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await expect
      .poll(async () => (await shelfCards(page).first().getAttribute('aria-posinset')) ?? '1')
      .not.toBe('1');

    const after = await page.evaluate(() => document.getElementsByTagName('*').length);
    // A window, not an accumulation: scrolling replaces tiles rather than adding.
    expect(after).toBeLessThan(before * 2);
  });
});

test.describe('searching the shelf', () => {
  test('finds a book by title and by author', async ({ page }) => {
    await openApp(page);
    await importCsv(page, csvSnapshot(20));
    await expect(page.getByTestId('import-status')).toHaveText('Imported 20 new of 20 rows.', {
      timeout: BULK_IMPORT_TIMEOUT,
    });
    await goTo(page, 'shelf');

    await page.getByTestId('shelf-search').fill('Book 7');
    await expect(page.getByTestId('shelf-count')).toHaveText('1 book');
    await expect(shelfCards(page)).toHaveCount(1);

    await page.getByTestId('shelf-search').fill('Author 3');
    await expect(page.getByTestId('shelf-count')).toHaveText('1 book');
  });

  /** Search normalises differently from identity matching: it keeps leading
   *  articles, because someone typing "the gru" expects "The Gruffalo". */
  test('ignores punctuation, case and leading-article differences', async ({ page }) => {
    await openApp(page);
    await importCsv(
      page,
      Buffer.from('Title,Author\nThe Gruffalo!,Julia Donaldson\nL’École,Anon\n'),
    );
    await expect(page.getByTestId('import-status')).toHaveText('Imported 2 new of 2 rows.');
    await goTo(page, 'shelf');

    await page.getByTestId('shelf-search').fill('the gru');
    await expect(page.getByTestId('shelf-count')).toHaveText('1 book');

    await page.getByTestId('shelf-search').fill('ecole');
    await expect(page.getByTestId('shelf-count')).toHaveText('1 book');
  });

  test('says so plainly when nothing matches', async ({ page }) => {
    await openApp(page);
    await importCsv(page, csvSnapshot(5));
    await expect(page.getByTestId('import-status')).toHaveText('Imported 5 new of 5 rows.');
    await goTo(page, 'shelf');

    await page.getByTestId('shelf-search').fill('nothing here matches this');
    await expect(page.getByTestId('no-matches')).toBeVisible();
    // An empty search result is not an empty shelf, and must not look like one.
    await expect(page.getByTestId('first-run')).toHaveCount(0);
  });

  test('sorting reorders the shelf', async ({ page }) => {
    await openApp(page);
    await importCsv(page, csvSnapshot(12));
    await expect(page.getByTestId('import-status')).toHaveText('Imported 12 new of 12 rows.', {
      timeout: BULK_IMPORT_TIMEOUT,
    });
    await goTo(page, 'shelf');

    await page.getByTestId('shelf-sort').selectOption('title');

    // Lexicographic, so "Book 10" sorts before "Book 2". Asserting the sequence
    // rather than "the order changed": every work in one import shares a
    // created_at, so recency ties and falls back to title anyway.
    await expect
      .poll(async () =>
        (await shelfCards(page).allInnerTexts())
          .slice(0, 3)
          .map((text) => text.split('\n')[0])
          .join(','),
      )
      .toBe('Book 1,Book 10,Book 11');
  });
});
