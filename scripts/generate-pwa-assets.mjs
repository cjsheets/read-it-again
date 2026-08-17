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
import { chromium, expect } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const publicDir = resolve(root, 'apps/web/public');
const PREVIEW_PORT = 4176;
const BRAND = '#24473b';

/** Titles chosen to show the generated covers doing their job: varied lengths and
 *  a spread of the eight hues. Nothing here is real user data. */
const SAMPLE_BOOKS = [
  ['The Gruffalo', 'Julia Donaldson'],
  ['Where the Wild Things Are', 'Maurice Sendak'],
  ['Owl Babies', 'Martin Waddell'],
  ['Goodnight Moon', 'Margaret Wise Brown'],
  ['The Very Hungry Caterpillar', 'Eric Carle'],
  ['Each Peach Pear Plum', 'Janet Ahlberg'],
  ['We Are Going on a Bear Hunt', 'Michael Rosen'],
  ['Peace at Last', 'Jill Murphy'],
];

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
      await page
        .getByTestId('import-status')
        .filter({ hasNotText: 'Opening your private bookshelf…' })
        .waitFor();
      // An install card showing "your shelf is empty" advertises nothing. Seed a
      // few books so the screenshot shows the product: a shelf of covers.
      await seedShelf(page);
      await writeFile(resolve(publicDir, file), await page.screenshot({ type: 'png' }));
      console.log(`wrote ${file} (${width}x${height})`);
      await page.close();
    }
  } finally {
    preview.kill('SIGTERM');
  }
}

async function seedShelf(page) {
  for (const [title, author] of SAMPLE_BOOKS) {
    await page.getByTestId('nav-add').click();
    await page.getByLabel('Book title').fill(title);
    await page.getByLabel('Book author').fill(author);
    await page.getByRole('button', { name: 'Add to bookshelf' }).click();
    // The form clears when the worker round-trip resolves. React sets the value as
    // a property, so a [value=""] selector would never match.
    await expect(page.getByLabel('Book title')).toHaveValue('', { timeout: 30_000 });
  }
  await page.getByTestId('nav-shelf').click();
  await page.getByTestId('shelf-card').first().waitFor();
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
