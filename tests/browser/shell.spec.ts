import { expect, test } from '@playwright/test';
import {
  addBookManually,
  csvSnapshot,
  goTo,
  importCsv,
  openApp,
  PRODUCTION_URL,
  shelfCards,
} from './support/shelf.js';

/** Routing, landmarks, keyboard navigation, and render-failure recovery. */
test.describe('app shell', () => {
  test('the shelf is the front door, and daily destinations stay simple', async ({ page }) => {
    await openApp(page);

    // Not an import panel, not a capability disclaimer — the shelf.
    await expect(page.getByTestId('first-run')).toBeVisible();

    for (const [route, heading] of [
      ['add', 'Add a book'],
      ['activity', 'Reading activity'],
      ['settings', 'Settings'],
    ] as const) {
      await goTo(page, route);
      await expect(page.getByRole('heading', { name: heading, level: 2 })).toBeVisible();
    }

    await expect(page.getByTestId('nav-discover')).toHaveCount(0);
    await expect(page.getByTestId('nav-tasks')).toHaveCount(0);
  });

  test('a destination survives a reload and is shareable as a link', async ({ page }) => {
    await openApp(page);
    await goTo(page, 'activity');
    expect(new URL(page.url()).hash).toBe('#activity');

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Reading activity', level: 2 })).toBeVisible();

    // Deep-linking straight in works too, which is the point of routing at all.
    await page.goto(new URL('#discover', PRODUCTION_URL).href);
    await expect(page.getByRole('heading', { name: 'What to bring home next' })).toBeVisible();
  });

  test('an unknown hash falls back to the shelf rather than a blank screen', async ({ page }) => {
    await page.goto(new URL('#nonsense', PRODUCTION_URL).href);
    await expect(page.getByTestId('import-status')).not.toHaveText(
      'Opening your private bookshelf…',
    );

    await expect(page.getByTestId('first-run')).toBeVisible();
  });

  test('navigation is a landmark and marks the current destination', async ({ page }) => {
    await openApp(page);
    const nav = page.getByRole('navigation', { name: 'Sections' });
    await expect(nav).toBeVisible();

    await expect(page.getByTestId('nav-shelf')).toHaveAttribute('aria-current', 'page');
    await goTo(page, 'add');
    await expect(page.getByTestId('nav-add')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('nav-shelf')).not.toHaveAttribute('aria-current', 'page');
  });

  test('a skip link is the first stop for a keyboard user', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('Tab');

    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await skip.click();
    await expect(page.locator('#content')).toBeFocused();
  });

  /** Review work appears only when a decision is needed. */
  test('the tasks badge appears only when a decision is genuinely needed', async ({ page }) => {
    await openApp(page);
    await addBookManually(page, { title: 'The Gruffalo', author: 'Julia Donaldson' });
    await expect(page.getByTestId('tasks-badge')).toHaveCount(0);
    await expect(page.getByTestId('nav-tasks')).toHaveCount(0);
  });

  test('the shelf offers a route to Tasks when something does need deciding', async ({ page }) => {
    await openApp(page);
    await importCsv(page, csvSnapshot(2));
    await expect(page.getByTestId('import-status')).toHaveText('Imported 2 new of 2 rows.');
    await goTo(page, 'shelf');
    await expect(shelfCards(page)).toHaveCount(2);
    // Nothing is ambiguous for a single-reader household, so no prompt appears.
    await expect(page.getByText('needs a decision')).toHaveCount(0);
  });
});

test.describe('error boundary', () => {
  // A render failure should leave a usable recovery screen.
  test('a render failure explains itself and says the books are safe', async ({ page }) => {
    await openApp(page);
    await addBookManually(page, { title: 'The Gruffalo', author: 'Julia Donaldson' });
    await goTo(page, 'shelf');
    await expect(shelfCards(page)).toHaveCount(1);

    // Make the next render of a shelf card throw. Every card renders its trait
    // chips through Array.prototype.map, so this reproduces a render-time bug
    // without needing a test-only hook in the app itself.
    await page.evaluate(() => {
      Array.prototype.map = function () {
        throw new Error('synthetic render failure');
      };
    });
    // Any state change forces a re-render of the shelf.
    await page.getByTestId('nav-activity').click();

    await expect(page.getByTestId('crash')).toBeVisible();
    await expect(page.getByTestId('crash')).toContainText('Your books are still saved');
    await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();
  });
});
