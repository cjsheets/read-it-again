import { expect, test, type Page } from '@playwright/test';
import { FIXTURE_ISBN } from './support/barcode.js';
import {
  addBookManually,
  enableCoverLookup,
  goTo,
  openApp,
  openBook,
  shelfCards,
} from './support/shelf.js';

/** Scanning is a normal Add action on camera-capable devices. */
async function enableScanning(page: Page): Promise<void> {
  await goTo(page, 'add');
  await expect(page.getByTestId('open-scanner')).toBeVisible();
}

/** ISBN check digits can be validated without a network or catalog. */
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

/** Runs the real EAN-13 decoder against Chromium's generated camera video. */
test.describe('scanning a barcode', () => {
  test('scanning is available without an experiment preference', async ({ page }) => {
    await openApp(page);
    await goTo(page, 'add');
    await expect(page.getByTestId('open-scanner')).toBeVisible();
    await page.reload();
    await openApp(page);
    await goTo(page, 'add');
    await expect(page.getByTestId('open-scanner')).toBeVisible();
  });

  test('a scanned ISBN fills the form for a book the shelf has never seen', async ({ page }) => {
    await page.route('https://covers.openlibrary.org/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          'base64',
        ),
      });
    });
    await openApp(page);
    await enableCoverLookup(page);
    await enableScanning(page);

    await page.getByTestId('open-scanner').click();
    await expect(page.getByTestId('scan-dialog')).toBeVisible();

    // Starting a camera and loading a megabyte of decoder is slower than a click.
    await expect(page.getByLabel('Book ISBN')).toHaveValue(FIXTURE_ISBN, { timeout: 30_000 });
    await expect(page.getByTestId('scan-dialog')).toHaveCount(0);

    const proposal = page.getByTestId('isbn-confirm-card');
    await expect(proposal).toContainText(/The Theory of critical phenomena/iu, {
      timeout: 15_000,
    });
    await proposal.getByRole('button', { name: 'Use these details' }).click();
    await expect(page.getByTestId('import-status')).toHaveText('Book added.');

    // The scanned number is stored on the same work-level path as a typed or
    // imported ISBN, so it can find a cover without scanner-specific wiring.
    const detail = await openBook(page);
    await expect(detail.locator('img.cover-image')).toBeVisible({ timeout: 15_000 });
  });

  test('scanning a book already on the shelf says so instead of duplicating it', async ({
    page,
  }) => {
    await openApp(page);
    // Deliberately the ten-digit spelling of the thirteen-digit barcode. They are
    // the same edition, and a lookup that only matched what it was handed would
    // put a second copy of this book on the shelf.
    await addBookManually(page, {
      title: 'The Theory of critical phenomena',
      author: 'Abelson and Sussman',
      isbn: '0198513933',
    });
    await enableScanning(page);

    await page.getByTestId('open-scanner').click();
    await expect(page.getByTestId('scan-status')).toHaveText(
      'You already have this: The Theory of critical phenomena.',
      { timeout: 30_000 },
    );
    // Nothing was written, and the form was not filled in behind the dialog.
    await expect(page.getByLabel('Book ISBN')).toHaveValue('');

    await page.getByTestId('scan-show-on-shelf').click();
    await expect(page.getByTestId('scan-dialog')).toHaveCount(0);
    await expect(page.getByTestId('nav-shelf')).toHaveAttribute('aria-current', 'page');
    await expect(shelfCards(page)).toHaveCount(1);
    await expect(shelfCards(page).first()).toContainText(/The Theory\s*of\s*critical/iu);
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
            return {
              loader: keys.some((request) => /\/assets\/reader-.*\.js$/u.test(request.url)),
              wasm: keys.some((request) => /zxing_reader.*\.wasm$/u.test(request.url)),
            };
          }),
        { timeout: 30_000 },
      )
      .toEqual({ loader: true, wasm: true });

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
