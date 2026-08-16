import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  // The HTML report carries the attached performance and axe JSON, so the budget
  // trend stays readable even while those tests are annotated expected-to-fail.
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'pnpm --filter @read-it-again/storage-browser dev --host 127.0.0.1',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'pnpm --filter @read-it-again/web dev --host 127.0.0.1',
      url: 'http://127.0.0.1:4174',
      reuseExistingServer: !process.env.CI,
    },
    {
      command:
        'pnpm --filter @read-it-again/web build && pnpm --filter @read-it-again/web exec vite preview --port 4175 --host 127.0.0.1',
      url: 'http://127.0.0.1:4175',
      reuseExistingServer: !process.env.CI,
    },
  ],
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
