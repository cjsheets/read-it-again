import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { addBookManually, goTo, openApp, shelfCards, PRODUCTION_URL } from './support/shelf.js';

const BASELINE = {
  coldEmptyMilliseconds: 437,
  coldFirstBookMilliseconds: 2_099,
  typedTaps: 3,
  typedKeystrokes: 12,
  consecutiveAddMilliseconds: [366, 199, 199, 200, 201],
  logReadingTaps: 2,
} as const;

/** A small allowance absorbs scheduler noise while still failing a material
 * regression from the measured AGENTS.md production baseline. GitHub's shared
 * Linux runner measured 1.6–1.86× the Apple-host baseline consistently across
 * retries, so CI retains a hardware-portable 2× absolute ceiling. */
const TIMING_TOLERANCE = process.env.CI ? 2 : 1.2;

test.describe('first-run production budget', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('cold typed adoption stays within the measured baseline budget', async ({
    page,
  }, testInfo) => {
    const session = await throttleCpu(page);
    await instrumentFirstRun(page);
    await page.goto(PRODUCTION_URL);
    await expect(page.getByTestId('first-run')).toBeVisible();
    const coldEmptyMilliseconds = await readMetric(page, 'empty');

    await page.getByRole('button', { name: 'Add your first book' }).click();
    await expect(page.getByLabel('Book title')).toBeFocused();
    await page.getByLabel('Book title').pressSequentially('Cloud Boat');
    await page.getByRole('button', { name: 'Add to bookshelf' }).click();
    await expect(page.getByTestId('add-confirmation')).toBeVisible();

    const coldFirstBookMilliseconds = await readMetric(page, 'confirmed');
    const counters = await page.evaluate(() => ({
      taps: Number(Reflect.get(window, '__budgetTaps') ?? 0),
      keystrokes: Number(Reflect.get(window, '__budgetKeys') ?? 0),
    }));
    const measured = { coldEmptyMilliseconds, coldFirstBookMilliseconds, ...counters };
    await attach(testInfo, 'cold-first-run.json', measured);

    expect(coldEmptyMilliseconds).toBeLessThanOrEqual(
      BASELINE.coldEmptyMilliseconds * TIMING_TOLERANCE,
    );
    expect(coldFirstBookMilliseconds).toBeLessThanOrEqual(
      BASELINE.coldFirstBookMilliseconds * TIMING_TOLERANCE,
    );
    expect(counters.taps).toBeLessThanOrEqual(BASELINE.typedTaps);
    expect(counters.keystrokes).toBeLessThanOrEqual(BASELINE.typedKeystrokes);
    await session.detach();
  });

  test('five consecutive adds retain title focus and the rapid-entry budget', async ({
    page,
  }, testInfo) => {
    await openApp(page);
    await goTo(page, 'add');
    const title = page.getByLabel('Book title');
    const measurements: number[] = [];

    for (let index = 0; index < 5; index += 1) {
      await expect(title).toBeFocused();
      await title.fill(`Book ${String(index + 1)}`);
      const started = await page.evaluate(() => performance.now());
      await page.getByRole('button', { name: 'Add to bookshelf' }).click();
      await expect(title).toHaveValue('');
      await expect(title).toBeFocused();
      measurements.push((await page.evaluate(() => performance.now())) - started);
    }

    await attach(testInfo, 'five-consecutive-adds.json', {
      baselineMilliseconds: BASELINE.consecutiveAddMilliseconds,
      measuredMilliseconds: measurements,
    });
    for (const [index, measured] of measurements.entries()) {
      const baseline = BASELINE.consecutiveAddMilliseconds[index] ?? 201;
      expect(measured, `add ${String(index + 1)}`).toBeLessThanOrEqual(baseline * TIMING_TOLERANCE);
    }
  });

  test('logging a reading remains two taps', async ({ page }) => {
    await openApp(page);
    await addBookManually(page, { title: 'Cloud Boat' });
    await goTo(page, 'shelf');
    let taps = 0;
    await shelfCards(page).first().getByRole('button').click();
    taps += 1;
    const detail = page.getByTestId('book-detail');
    await detail.getByRole('button', { name: 'Log a reading' }).click();
    taps += 1;
    await expect(detail.getByTestId('session-logged')).toBeVisible();
    expect(taps).toBe(BASELINE.logReadingTaps);
  });

  test('a returning shelf never flashes first-run', async ({ page }) => {
    await openApp(page);
    await addBookManually(page, { title: 'Cloud Boat' });
    await goTo(page, 'shelf');
    await page.addInitScript(() => {
      Reflect.set(window, '__sawFirstRunOnFrame', false);
      const sample = () => {
        if (document.querySelector('[data-testid="first-run"]'))
          Reflect.set(window, '__sawFirstRunOnFrame', true);
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.reload();
    await expect(shelfCards(page)).toHaveCount(1);
    expect(await page.evaluate(() => Boolean(Reflect.get(window, '__sawFirstRunOnFrame')))).toBe(
      false,
    );
  });

  test('first-run targets fit at 320px without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 812 });
    await openApp(page);
    await page.keyboard.press('Tab');
    const undersized = await page
      .locator('.skip-link, [data-testid="first-run"] button, [data-testid="nav-add"]')
      .filter({ visible: true })
      .evaluateAll((elements) =>
        elements
          .map((element) => {
            const box = element.getBoundingClientRect();
            return { label: element.textContent?.trim(), width: box.width, height: box.height };
          })
          .filter(({ width, height }) => width < 44 || height < 44),
      );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(undersized).toEqual([]);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

async function throttleCpu(page: Page) {
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  return session;
}

async function instrumentFirstRun(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Reflect.set(window, '__budgetTaps', 0);
    Reflect.set(window, '__budgetKeys', 0);
    Reflect.set(window, '__budgetStart', performance.now());
    addEventListener('click', () => {
      Reflect.set(window, '__budgetTaps', Number(Reflect.get(window, '__budgetTaps') ?? 0) + 1);
    });
    addEventListener('keydown', () => {
      Reflect.set(window, '__budgetKeys', Number(Reflect.get(window, '__budgetKeys') ?? 0) + 1);
    });
    const observe = () => {
      const start = Number(Reflect.get(window, '__budgetStart') ?? 0);
      if (
        Reflect.get(window, '__budgetEmpty') === undefined &&
        document.querySelector('[data-testid="first-run"]')
      )
        Reflect.set(window, '__budgetEmpty', performance.now() - start);
      if (
        Reflect.get(window, '__budgetConfirmed') === undefined &&
        document.querySelector('[data-testid="add-confirmation"]')
      )
        Reflect.set(window, '__budgetConfirmed', performance.now() - start);
    };
    new MutationObserver(observe).observe(document, { childList: true, subtree: true });
  });
}

async function readMetric(page: Page, name: 'empty' | 'confirmed'): Promise<number> {
  return page.evaluate((metric) => {
    const values = window as unknown as Record<string, unknown>;
    const value = values[metric === 'empty' ? '__budgetEmpty' : '__budgetConfirmed'];
    if (typeof value !== 'number') throw new Error(`Missing ${metric} performance mark.`);
    return value;
  }, name);
}

async function attach(testInfo: TestInfo, name: string, measured: unknown): Promise<void> {
  await testInfo.attach(name, {
    contentType: 'application/json',
    body: JSON.stringify({ baseline: BASELINE, measured }, null, 2),
  });
}
