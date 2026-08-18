import { expect, test } from '@playwright/test';
import { FIXTURE_ISBN } from '../support/barcode.js';
import { addBookManually, goTo, openApp, shelfCards } from '../support/shelf.js';

const METADATA_ENDPOINT = 'https://openlibrary.org/api/books';

test.describe('R5 — ISBN metadata remains consensual and confirmable', () => {
  test('permission off produces zero metadata requests at the network layer', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => {
      if (request.url().startsWith(METADATA_ENDPOINT)) requests.push(request.url());
    });
    await openApp(page);
    await goTo(page, 'settings');
    await expect(page.getByText('Look things up on openlibrary.org')).toBeVisible();
    await goTo(page, 'add');
    await page.getByLabel('Book ISBN').fill(FIXTURE_ISBN);
    await page.waitForTimeout(250);

    expect(requests).toEqual([]);
  });

  test('permission on presents metadata as a confirm card with accept and edit paths', async ({
    page,
  }) => {
    await openApp(page);
    await goTo(page, 'settings');
    const permission = page.getByLabel('Look things up on openlibrary.org');
    await expect(permission).toBeVisible();
    await permission.check();
    await goTo(page, 'add');
    await page.getByLabel('Book ISBN').fill(FIXTURE_ISBN);
    await page.getByRole('button', { name: 'Look up this ISBN' }).click();

    const card = page.getByTestId('isbn-confirm-card');
    await expect(card).toContainText(/The Theory of critical phenomena/iu, { timeout: 15_000 });
    await expect(card.getByRole('button', { name: 'Use these details' })).toBeVisible();
    await card.getByRole('button', { name: 'Edit them first' }).click();
    await expect(page.getByLabel('Book title')).toHaveValue(/Theory of Critical Phenomena/iu);
  });

  test('offline lookup degrades to the typed path', async ({ page }) => {
    await openApp(page);
    await goTo(page, 'settings');
    const permission = page.getByLabel('Look things up on openlibrary.org');
    await expect(permission).toBeVisible();
    await permission.check();
    await goTo(page, 'add');
    await page.context().setOffline(true);
    await page.getByLabel('Book ISBN').fill(FIXTURE_ISBN);
    await page.getByRole('button', { name: 'Look up this ISBN' }).click();
    await expect(page.getByText(/type the title|add without a title/iu)).toBeVisible();
    await page.getByLabel('Book title').fill('My Offline Book');
    await page.getByRole('button', { name: 'Add to bookshelf' }).click();
    await expect(page.getByTestId('add-confirmation')).toContainText('My Offline Book');
  });

  test('a valid ISBN with no title can still become an identifiable shelf book', async ({
    page,
  }) => {
    await openApp(page);
    await goTo(page, 'add');
    await page.getByLabel('Book ISBN').fill(FIXTURE_ISBN);
    const addWithoutTitle = page.getByRole('button', { name: 'Add without a title' });
    await expect(addWithoutTitle).toBeVisible();
    await addWithoutTitle.click();
    await goTo(page, 'shelf');

    await expect(shelfCards(page)).toHaveCount(1);
    await expect(shelfCards(page).first()).toContainText(FIXTURE_ISBN);
  });
});

test.describe('R6 — camera-first adding', () => {
  test('a cold-open scan adds a correctly titled book in at most three taps and no keystrokes', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      addEventListener('click', () => {
        const current = Number(Reflect.get(window, '__adoptionTaps') ?? 0);
        Reflect.set(window, '__adoptionTaps', current + 1);
      });
      addEventListener('keydown', () => {
        const current = Number(Reflect.get(window, '__adoptionKeys') ?? 0);
        Reflect.set(window, '__adoptionKeys', current + 1);
      });
    });
    await openApp(page);
    await page.getByTestId('nav-add').click();
    const scanner = page.getByTestId('open-scanner');
    await expect(scanner).toBeVisible();
    await scanner.click();
    await page.getByRole('button', { name: 'Use these details' }).click({ timeout: 30_000 });
    await goTo(page, 'shelf');
    await expect(shelfCards(page).first()).toContainText(/The Theory of critical phenomena/iu);
    const { taps, keystrokes } = await page.evaluate(() => ({
      taps: Number(Reflect.get(window, '__adoptionTaps') ?? 0),
      keystrokes: Number(Reflect.get(window, '__adoptionKeys') ?? 0),
    }));

    expect(taps).toBeLessThanOrEqual(3);
    expect(keystrokes).toBe(0);
  });

  test('camera refusal leaves the named typed fallback reachable', async ({ page }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }));
    });
    await openApp(page);
    await goTo(page, 'add');
    const scanner = page.getByTestId('open-scanner');
    await expect(scanner).toBeVisible();
    await scanner.click();
    await expect(page.getByTestId('scan-status')).toContainText('type the ISBN in instead');
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByLabel('Book ISBN')).toBeVisible();
  });

  test('an absent camera leaves the named typed fallback reachable', async ({ page }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(Object.assign(new Error('No camera'), { name: 'NotFoundError' }));
    });
    await openApp(page);
    await goTo(page, 'add');
    const scanner = page.getByTestId('open-scanner');
    await expect(scanner).toBeVisible();
    await scanner.click();
    await expect(page.getByTestId('scan-status')).toContainText('No camera was found');
    await expect(page.getByTestId('scan-status')).toContainText('Type the ISBN in instead');
  });

  test('an already-shelved scan offers the existing book without duplicating it', async ({
    page,
  }) => {
    await openApp(page);
    await addBookManually(page, { title: 'Known Book', isbn: FIXTURE_ISBN });
    await goTo(page, 'add');
    const scanner = page.getByTestId('open-scanner');
    await expect(scanner).toBeVisible();
    await scanner.click();
    await expect(page.getByTestId('scan-status')).toContainText(
      'You already have this: Known Book',
      {
        timeout: 30_000,
      },
    );
    await page.getByTestId('scan-show-on-shelf').click();
    await expect(shelfCards(page)).toHaveCount(1);
  });
});
