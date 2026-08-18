import { expect, test } from '@playwright/test';
import { openApp, PRODUCTION_URL } from '../support/shelf.js';

const COVER_URL = 'https://covers.openlibrary.org/b/isbn/9780140328721-S.jpg';

test.describe('R1 — one enforceable content security policy', () => {
  test('the production artifact delivers its CSP as a response header', async ({ page }) => {
    const response = await page.goto(PRODUCTION_URL);

    expect(response?.headers()['content-security-policy']).toContain(
      "connect-src 'self' https://covers.openlibrary.org https://openlibrary.org",
    );
  });

  test('meta and header policies cannot disagree on connect-src', async ({ page }) => {
    await openApp(page);
    const metaPolicy = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .evaluateAll((elements) => elements[0]?.getAttribute('content') ?? null);
    const headerPolicy = await page.evaluate(async () =>
      fetch('/_headers').then((body) => body.text()),
    );
    const connectSources = [metaPolicy, headerPolicy]
      .filter((policy): policy is string => policy !== null)
      .map((policy) => /connect-src\s+([^;]+)/u.exec(policy)?.[1]?.trim())
      .filter((value): value is string => value !== undefined);

    expect(new Set(connectSources).size).toBeLessThanOrEqual(1);
  });

  test('a real cover-host request is permitted by CSP without interception', async ({ page }) => {
    await openApp(page);

    const result = await page.evaluate(async (url) => {
      try {
        const response = await fetch(url);
        return { ok: response.ok, status: response.status };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }, COVER_URL);

    expect(result).toMatchObject({ ok: true, status: 200 });
  });

  test('the development server renders with the application stylesheet', async ({ page }) => {
    await page.goto('http://127.0.0.1:4174/');
    await expect(page.getByTestId('import-status')).not.toHaveText(
      'Opening your private bookshelf…',
    );

    const styles = await page.evaluate(() => ({
      background: getComputedStyle(document.documentElement).backgroundColor,
      minimumWidth: getComputedStyle(document.body).minWidth,
    }));
    expect(styles).toEqual({ background: 'rgb(246, 241, 232)', minimumWidth: '320px' });
  });
});
