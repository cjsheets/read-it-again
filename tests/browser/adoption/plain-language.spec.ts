import { expect, test } from '@playwright/test';
import {
  addBookManually,
  goTo,
  openApp,
  openBook,
  PRODUCTION_URL,
  shelfCards,
} from '../support/shelf.js';

test.describe('R2 — first-run clarity and reach', () => {
  test('Add contains only single-book paths and points quietly to bulk imports', async ({
    page,
  }) => {
    await openApp(page);
    await goTo(page, 'add');

    await expect(page.getByTestId('csv-file')).toHaveCount(0);
    await expect(page.getByTestId('libby-file')).toHaveCount(0);
    await expect(page.getByText('Bring in books from elsewhere')).toBeVisible();
  });

  test('Log a reading is the detail drawer’s only filled primary control', async ({ page }) => {
    await openApp(page);
    await addBookManually(page, { title: 'Cloud Boat', author: 'Ada Fox' });
    const detail = await openBook(page);

    const logBackground = await detail
      .getByRole('button', { name: 'Log a reading' })
      .evaluate((button) => getComputedStyle(button).backgroundColor);
    const coverBackground = await detail
      .getByText('Choose a cover', { exact: true })
      .evaluate((control) => getComputedStyle(control.closest('label') ?? control).backgroundColor);
    expect(logBackground).not.toBe('rgba(0, 0, 0, 0)');
    expect(coverBackground).toBe('rgba(0, 0, 0, 0)');
  });

  test('How this works opens the existing privacy explanation in place and restores focus', async ({
    page,
  }) => {
    await openApp(page);
    const trigger = page.getByRole('button', { name: 'How this works' });
    await trigger.click();

    const explanation = page.getByText('Your library stays in this browser', { exact: true });
    await expect(explanation).toBeInViewport();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(trigger).toBeFocused();
    expect(new URL(page.url()).hash).toBe('');
  });

  test('action status is cleared when the person navigates to another destination', async ({
    page,
  }) => {
    await openApp(page);
    await addBookManually(page, { title: 'Cloud Boat' });
    await expect(page.getByTestId('import-status')).toHaveText('Book added.');

    await goTo(page, 'activity');
    await expect(page.getByTestId('import-status')).not.toContainText('Book added.');
  });

  test('a returning shelf never renders the first-run state during animation frames', async ({
    page,
  }) => {
    await openApp(page);
    await addBookManually(page, { title: 'Cloud Boat' });
    await goTo(page, 'shelf');
    await expect(shelfCards(page)).toHaveCount(1);

    await page.addInitScript(() => {
      Object.assign(window, { __sawFirstRunOnFrame: false });
      const sample = () => {
        if (document.querySelector('[data-testid="first-run"]')) {
          Object.assign(window, { __sawFirstRunOnFrame: true });
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.reload();
    await expect(page.getByTestId('import-status')).not.toHaveText(
      'Opening your private bookshelf…',
    );
    await expect(shelfCards(page)).toHaveCount(1);

    expect(await page.evaluate(() => Boolean(Reflect.get(window, '__sawFirstRunOnFrame')))).toBe(
      false,
    );
  });

  test('every standalone first-book control is at least 44 by 44 pixels at 320px', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 812 });
    await openApp(page);
    await page.keyboard.press('Tab');

    const controls = page
      .locator('.skip-link, [data-testid="first-run"] button, [data-testid="nav-add"]')
      .filter({ visible: true });
    const undersized = await controls.evaluateAll((elements) =>
      elements
        .map((element) => {
          const box = element.getBoundingClientRect();
          return { label: element.textContent?.trim(), width: box.width, height: box.height };
        })
        .filter(({ width, height }) => width < 44 || height < 44),
    );

    expect(undersized).toEqual([]);
  });

  test('rendered destinations use the parent-facing vocabulary', async ({ page }) => {
    await openApp(page);
    await addBookManually(page, { title: 'Cloud Boat', author: 'Ada Fox' });
    const detail = await openBook(page);
    await expect(detail.getByText('How did it go?')).toBeVisible();
    await expect(detail.getByText("Who's this for?")).toHaveCount(0);
    await page.keyboard.press('Escape');

    const rendered: string[] = [];
    for (const route of ['shelf', 'add', 'activity', 'discover', 'tasks', 'settings'] as const) {
      await page.goto(new URL(`#${route}`, PRODUCTION_URL).href);
      await expect(page.getByTestId('import-status')).not.toHaveText(
        'Opening your private bookshelf…',
      );
      rendered.push(await page.locator('main').innerText());
    }

    expect(rendered.join('\n')).not.toMatch(
      /\b(?:archive|assessment|provenance|observation|deterministic|catalog record)\b/iu,
    );
  });

  test('a generated-cover tile does not print its title twice', async ({ page }) => {
    await openApp(page);
    await addBookManually(page, { title: 'Cloud Boat', author: 'Ada Fox' });
    await goTo(page, 'shelf');

    const text = await shelfCards(page).first().innerText();
    expect(occurrences(text, 'Cloud Boat')).toBe(1);
    await expect(shelfCards(page).first()).toContainText('Ada Fox');
  });
});

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}
