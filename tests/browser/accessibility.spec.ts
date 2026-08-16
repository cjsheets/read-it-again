import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { addBookManually, csvSnapshot, importCsv, openApp, shelfCards } from './support/shelf.js';

/**
 * Audit §11 Tier 3: zero serious axe violations, and `scrollWidth <= clientWidth`
 * at 320 px in every state. Findings F-07 (no focus styles), F-09 (trait chips
 * never expose `aria-pressed`), F-10 (320 px overflow clips the rating control),
 * and F-16 (2.13:1 and 1.47:1 component borders) all live here.
 *
 * Both states are scanned. An empty first-run screen and a populated shelf fail
 * differently, and the populated one is where the household actually spends time.
 */
const SERIOUS = new Set(['serious', 'critical']);

async function populate(page: Page): Promise<void> {
  await importCsv(page, csvSnapshot(3));
  await expect(page.getByTestId('record-count')).toHaveText('3 books');
  await addBookManually(page, { title: 'The Gruffalo', author: 'Julia Donaldson' });
  await expect(shelfCards(page)).toHaveCount(1);
}

async function scan(page: Page, testInfo: TestInfo, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const serious = results.violations.filter((violation) => SERIOUS.has(violation.impact ?? ''));

  await testInfo.attach(`axe-${label}.json`, {
    contentType: 'application/json',
    body: JSON.stringify(
      serious.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        nodes: violation.nodes.map((node) => node.target.join(' ')),
      })),
      null,
      2,
    ),
  });

  expect(
    serious.map((violation) => `${violation.id} (${violation.impact}) — ${violation.help}`),
  ).toEqual([]);
}

test.describe('accessibility', () => {
  test('the first-run screen has no serious axe violations', async ({ page }, testInfo) => {
    await openApp(page);
    await scan(page, testInfo, 'first-run');
  });

  test('a populated shelf has no serious axe violations', async ({ page }, testInfo) => {
    await openApp(page);
    await populate(page);
    await scan(page, testInfo, 'populated');
  });

  // F-07 · fixed by Increment 1.
  test('a focus-visible rule is defined somewhere in the loaded stylesheets', async ({ page }) => {
    test.fail(true, 'F-07: styles.css defines no :focus or :focus-visible rule. Increment 1.');
    await openApp(page);

    const focusRules = await page.evaluate(() =>
      [...document.styleSheets].flatMap((sheet) => {
        try {
          return [...sheet.cssRules]
            .map((rule) => (rule as CSSStyleRule).selectorText ?? '')
            .filter((selector) => selector.includes(':focus'));
        } catch {
          return [];
        }
      }),
    );

    expect(focusRules).not.toEqual([]);
  });

  // F-09 · fixed by Increment 1. axe cannot flag this: it has no way to know a
  // <button> is a toggle, so the omission is invisible to automated scanning and
  // has to be asserted by hand.
  test('trait chips expose their pressed state', async ({ page }) => {
    test.fail(true, 'F-09: trait chips carry state only in className. Increment 1.');
    await openApp(page);
    await populate(page);

    const chip = shelfCards(page).first().getByRole('button', { name: 'Rhyme & meter' });
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
  });

  // F-08 · fixed by Increment 1. The audit measured 50 controls under 44x44 px on a
  // populated shelf; WCAG 2.2 SC 2.5.8 sets 24x24 as the absolute floor.
  test('no interactive control is smaller than the 24x24 px floor', async ({ page }) => {
    test.fail(true, 'F-08: rating buttons are 32x32, chips 29 px tall, checkboxes 13x13.');
    await openApp(page);
    await populate(page);

    const undersized = await page.evaluate(() =>
      [...document.querySelectorAll('button, input, select, textarea, a[href]')]
        .map((element) => ({ element, box: element.getBoundingClientRect() }))
        .filter(({ box }) => box.width > 0 && (box.width < 24 || box.height < 24))
        .map(
          ({ element, box }) =>
            `${element.tagName.toLowerCase()}.${element.className || '-'} ${Math.round(box.width)}x${Math.round(box.height)}`,
        ),
    );

    expect(undersized).toEqual([]);
  });
});

test.describe('reflow', () => {
  // F-10 · fixed by Increment 1 (380 px breakpoint).
  for (const width of [320, 390] as const) {
    test(`the page does not scroll horizontally at ${width} px`, async ({ page }) => {
      test.fail(
        width === 320,
        'F-10: the rating fieldset overflows to 332 px at a 320 px viewport. Increment 1.',
      );
      await page.setViewportSize({ width, height: 800 });
      await openApp(page);

      const empty = await overflow(page);
      expect
        .soft(empty.scrollWidth, `${width} px, first run`)
        .toBeLessThanOrEqual(empty.clientWidth);

      await populate(page);

      const populated = await overflow(page);
      expect
        .soft(populated.scrollWidth, `${width} px, populated shelf`)
        .toBeLessThanOrEqual(populated.clientWidth);
    });
  }
});

function overflow(page: Page): Promise<{ scrollWidth: number; clientWidth: number }> {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}
