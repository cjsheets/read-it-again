import { expect, test } from '@playwright/test';

test('SQLite-WASM/OPFS satisfies the shared repository contract and persists data', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4173/');

  const result = page.locator('#result');
  await expect(result).toHaveAttribute('data-status', 'passed', { timeout: 30_000 });
  await expect(result).toContainText('"persistent":true');
  await expect(result).toContainText('"migrationCount":3');
  await expect(result).toContainText('"householdCount":2');
});
