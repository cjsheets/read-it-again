import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';
import { FIXTURE_VIDEO, writeBarcodeVideo, FIXTURE_ISBN } from './tests/browser/support/barcode.js';

/**
 * Chromium's fake camera is configured at launch, so the video has to exist
 * before the browser starts — hence generating it here rather than in a fixture.
 * `--use-fake-ui-for-media-stream` auto-grants the camera prompt; the scanner's
 * refusal path is covered separately by denying the permission outright.
 */
const barcodeVideo = resolve(import.meta.dirname, FIXTURE_VIDEO);
writeBarcodeVideo(FIXTURE_ISBN, barcodeVideo);

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
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: {
          args: [
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            `--use-file-for-fake-video-capture=${barcodeVideo}`,
          ],
        },
      },
    },
  ],
});
