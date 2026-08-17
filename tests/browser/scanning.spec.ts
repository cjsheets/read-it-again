import { expect, test, type Page } from '@playwright/test';
import { FIXTURE_ISBN } from './support/barcode.js';
import { addBookManually, goTo, openApp, shelfCards } from './support/shelf.js';

/** Turning the experiment on is a deliberate act, so every scanning test starts
 *  by performing it rather than by reaching into storage. */
async function enableScanning(page: Page): Promise<void> {
  await goTo(page, 'settings');
  await page.getByTestId('scanning-toggle').check();
  await goTo(page, 'add');
  await expect(page.getByTestId('open-scanner')).toBeVisible();
}

/**
 * Audit §8.4. Feasible with no network and no catalog: the check digit is
 * arithmetic, so a mistyped ISBN can be caught the moment it is typed.
 */
test.describe('typing an ISBN', () => {
  test('a mistyped ISBN is refused before it becomes a book', async ({ page }) => {
    await openApp(page);
    await goTo(page, 'add');
    await page.getByLabel('Book title').fill('Bear Counts the Stars');
    await page.getByLabel('Book ISBN').fill('9780306406158');

    await expect(page.getByTestId('isbn-problem')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add to bookshelf' })).toBeDisabled();

    // Correcting the last digit clears it: the message is about this number, not
    // a mode the form is stuck in.
    await page.getByLabel('Book ISBN').fill('9780306406157');
    await expect(page.getByTestId('isbn-problem')).toHaveCount(0);
    await page.getByRole('button', { name: 'Add to bookshelf' }).click();
    await expect(page.getByTestId('import-status')).toHaveText('Book added.');
  });

  test('leaving the ISBN blank is normal and stays allowed', async ({ page }) => {
    await openApp(page);
    await addBookManually(page, { title: 'Owl Babies', author: 'Martin Waddell' });
    await goTo(page, 'shelf');
    await expect(shelfCards(page)).toHaveCount(1);
  });
});

/**
 * Audit §8.5's v0 scope: camera, decode EAN-13, check the ISBN against the local
 * database, then either open what is already there or start a new book from it.
 * Chromium plays a generated barcode through its fake camera, so this decodes for
 * real rather than stubbing the part most likely to break.
 */
test.describe('scanning a barcode', () => {
  test('scanning is off until it is switched on', async ({ page }) => {
    await openApp(page);
    await goTo(page, 'add');
    await expect(page.getByTestId('open-scanner')).toHaveCount(0);

    await goTo(page, 'settings');
    await expect(page.getByTestId('scanning-toggle')).not.toBeChecked();
    await page.getByTestId('scanning-toggle').check();

    await goTo(page, 'add');
    await expect(page.getByTestId('open-scanner')).toBeVisible();

    // Device-local and remembered, like the reader filter.
    await page.reload();
    await openApp(page);
    await goTo(page, 'add');
    await expect(page.getByTestId('open-scanner')).toBeVisible();
  });

  test('a scanned ISBN fills the form for a book the shelf has never seen', async ({ page }) => {
    await openApp(page);
    await enableScanning(page);

    await page.getByTestId('open-scanner').click();
    await expect(page.getByTestId('scan-dialog')).toBeVisible();

    // Starting a camera and loading a megabyte of decoder is slower than a click.
    await expect(page.getByLabel('Book ISBN')).toHaveValue(FIXTURE_ISBN, { timeout: 30_000 });
    await expect(page.getByTestId('scan-dialog')).toHaveCount(0);

    // There is no catalog to name it (ADR 0002), so the title is still the
    // person's to supply — and the book must not appear until they have.
    await expect(page.getByLabel('Book title')).toHaveValue('');
    await page.getByLabel('Book title').fill('Structure and Interpretation');
    await page.getByRole('button', { name: 'Add to bookshelf' }).click();
    await expect(page.getByTestId('import-status')).toHaveText('Book added.');
  });

  test('scanning a book already on the shelf says so instead of duplicating it', async ({
    page,
  }) => {
    await openApp(page);
    // Deliberately the ten-digit spelling of the thirteen-digit barcode. They are
    // the same edition, and a lookup that only matched what it was handed would
    // put a second copy of this book on the shelf (audit §8.2).
    await addBookManually(page, {
      title: 'Structure and Interpretation',
      author: 'Abelson and Sussman',
      isbn: '0306406152',
    });
    await enableScanning(page);

    await page.getByTestId('open-scanner').click();
    await expect(page.getByTestId('scan-status')).toHaveText(
      'You already have this: Structure and Interpretation.',
      { timeout: 30_000 },
    );
    // Nothing was written, and the form was not filled in behind the dialog.
    await expect(page.getByLabel('Book ISBN')).toHaveValue('');

    await page.getByTestId('scan-show-on-shelf').click();
    await expect(page.getByTestId('scan-dialog')).toHaveCount(0);
    await expect(page.getByTestId('nav-shelf')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('shelf-search')).toHaveValue('Structure and Interpretation');
    await expect(shelfCards(page)).toHaveCount(1);
  });

  /**
   * The reason the decoder is self-hosted rather than loaded from a CDN. A CDN
   * fetch is blocked by `connect-src 'self'` outright, and even permitted it would
   * fail on the trip to the library where scanning is most useful. Precaching the
   * wasm alone is not enough either: its loader is a separate code-split chunk,
   * and an earlier version of the service worker's crawler matched only absolute
   * URLs and silently left that chunk behind.
   */
  test('scanning works with the network switched off', async ({ page }) => {
    await openApp(page);
    await enableScanning(page);
    await page.evaluate(async () => navigator.serviceWorker.ready);
    // The crawler precaches during install; give it the round trip before cutting
    // the network out from under it.
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const cache = await caches.open('read-it-again-shell-v1');
            const keys = await cache.keys();
            return keys.filter((request) => /zxing_reader.*\.wasm$/u.test(request.url)).length;
          }),
        { timeout: 30_000 },
      )
      .toBe(1);

    // One reload while still online, so the newly installed worker is actually
    // controlling the page. Without it the offline reload has nothing serving it.
    await page.reload();
    await expect(page.getByTestId('import-status')).not.toHaveText(
      'Opening your private bookshelf…',
    );

    await page.context().setOffline(true);
    await page.reload();
    await expect(page.getByTestId('import-status')).not.toHaveText(
      'Opening your private bookshelf…',
    );
    await goTo(page, 'add');
    await page.getByTestId('open-scanner').click();
    await expect(page.getByLabel('Book ISBN')).toHaveValue(FIXTURE_ISBN, { timeout: 30_000 });
    await page.context().setOffline(false);
  });

  test('a refused camera says what to do instead of failing silently', async ({ browser }) => {
    // A context that denies the camera, overriding the fake-UI auto-grant.
    const context = await browser.newContext({ permissions: [] });
    await context.clearPermissions();
    await context.grantPermissions([]);
    const page = await context.newPage();
    await page.addInitScript(() => {
      // Chromium's fake UI grants unconditionally, so the refusal has to be
      // simulated at the API. What is under test is the app's response to a
      // rejection, which is the same object either way.
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }));
    });
    await openApp(page);
    await enableScanning(page);

    await page.getByTestId('open-scanner').click();
    await expect(page.getByTestId('scan-status')).toContainText('not allowing camera access');
    await expect(page.getByTestId('scan-status')).toContainText('type the ISBN in instead');

    // The fallback it names has to actually be there.
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByLabel('Book ISBN')).toBeVisible();
    await context.close();
  });
});
