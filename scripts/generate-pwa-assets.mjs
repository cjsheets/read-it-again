// Regenerates the raster PWA assets from apps/web/public/icon.svg and from the
// real running app. Run it after changing the icon or the first-run screen:
//
//   node scripts/generate-pwa-assets.mjs
//
// iOS ignores SVG icons for home-screen install and Chromium needs raster icons
// plus screenshots for a rich install card (F-17), so these files have to exist
// as bitmaps. Generating them keeps them honest instead of hand-drawn.
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const publicDir = resolve(root, 'apps/web/public');
const PREVIEW_PORT = 4176;
const BRAND = '#24473b';

const icon = await readFile(resolve(publicDir, 'icon.svg'), 'utf8');
const browser = await chromium.launch();

try {
  await renderIcons();
  await renderScreenshots();
} finally {
  await browser.close();
}

async function renderIcons() {
  // "any" icons keep the artwork edge to edge; the maskable variant insets it to
  // the 80% safe zone so Android's circle/squircle crop never clips the book.
  const targets = [
    // "any" icons stay transparent outside the rounded rect so each platform can
    // apply its own mask. The maskable and Apple variants are deliberately opaque:
    // Android crops them to a circle/squircle and iOS rounds them itself.
    { file: 'icon-192.png', size: 192, inset: 1, opaque: false },
    { file: 'icon-512.png', size: 512, inset: 1, opaque: false },
    { file: 'icon-maskable-512.png', size: 512, inset: 0.8, opaque: true },
    { file: 'apple-touch-icon.png', size: 180, inset: 1, opaque: true },
  ];
  const page = await browser.newPage();
  for (const { file, size, inset, opaque } of targets) {
    const inner = Math.round(size * inset);
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<body style="margin:0;width:${size}px;height:${size}px;background:${opaque ? BRAND : 'transparent'};display:grid;place-items:center">
         <div style="width:${inner}px;height:${inner}px;display:grid">${icon}</div>
       </body>`,
    );
    await page.locator('svg').first().waitFor();
    await writeFile(
      resolve(publicDir, file),
      await page.screenshot({ type: 'png', omitBackground: !opaque }),
    );
    console.log(`wrote ${file} (${size}x${size})`);
  }
  await page.close();
}

async function renderScreenshots() {
  const preview = spawn(
    'pnpm',
    [
      '--filter',
      '@read-it-again/web',
      'exec',
      'vite',
      'preview',
      '--port',
      String(PREVIEW_PORT),
      '--host',
      '127.0.0.1',
    ],
    { cwd: root, stdio: 'ignore' },
  );
  try {
    const url = `http://127.0.0.1:${PREVIEW_PORT}/`;
    await waitForServer(url);
    const shots = [
      { file: 'screenshot-narrow.png', width: 390, height: 844 },
      { file: 'screenshot-wide.png', width: 1280, height: 800 },
    ];
    for (const { file, width, height } of shots) {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.goto(url);
      await page.getByTestId('import-status').waitFor();
      await page
        .getByTestId('import-status')
        .filter({ hasNotText: 'Opening your private bookshelf…' })
        .waitFor();
      await writeFile(resolve(publicDir, file), await page.screenshot({ type: 'png' }));
      console.log(`wrote ${file} (${width}x${height})`);
      await page.close();
    }
  } finally {
    preview.kill('SIGTERM');
  }
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`preview server never became reachable at ${url}`);
}
