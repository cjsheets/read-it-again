import { expect, test } from '@playwright/test';
import { PRODUCTION_URL } from './support/shelf.js';

/** Manifest fields and assets required for an installable PWA. */
interface Manifest {
  readonly id?: string;
  readonly display_override?: readonly string[];
  readonly icons?: readonly {
    readonly src: string;
    readonly sizes: string;
    readonly type: string;
    readonly purpose?: string;
  }[];
  readonly screenshots?: readonly {
    readonly src: string;
    readonly sizes: string;
    readonly form_factor?: string;
  }[];
  readonly shortcuts?: readonly { readonly name: string; readonly url: string }[];
}

test('the manifest can produce a real install on iOS and Android', async ({ page, request }) => {
  const response = await request.get(new URL('manifest.webmanifest', PRODUCTION_URL).href);
  expect(response.ok()).toBe(true);
  const manifest = (await response.json()) as Manifest;

  expect(manifest.id).toBeTruthy();
  expect(manifest.display_override).toContain('standalone');

  const icons = manifest.icons ?? [];
  const png = (size: string, purpose: string) =>
    icons.find(
      (icon) =>
        icon.sizes === size && icon.type === 'image/png' && (icon.purpose ?? 'any') === purpose,
    );
  expect(png('192x192', 'any'), 'a 192px any icon').toBeDefined();
  expect(png('512x512', 'any'), 'a 512px any icon').toBeDefined();
  expect(png('512x512', 'maskable'), 'a 512px maskable icon').toBeDefined();

  const formFactors = (manifest.screenshots ?? []).map((shot) => shot.form_factor);
  expect(formFactors).toContain('narrow');
  expect(formFactors).toContain('wide');
  expect(manifest.shortcuts ?? []).not.toEqual([]);

  // Every referenced asset must actually be served, or the install card breaks.
  const referenced = [
    ...icons.map((icon) => icon.src),
    ...(manifest.screenshots ?? []).map((shot) => shot.src),
    '/apple-touch-icon.png',
  ];
  for (const src of referenced) {
    const asset = await request.get(new URL(src.replace(/^\//u, ''), PRODUCTION_URL).href);
    expect(asset.ok(), `${src} is served`).toBe(true);
  }

  await page.goto(PRODUCTION_URL);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    'href',
    '/apple-touch-icon.png',
  );
  // A mismatch here brands the installed app differently from the browser tab.
  const metaThemeColor = await page
    .locator('meta[name="theme-color"]')
    .getAttribute('content', { timeout: 5000 });
  const manifestThemeColor = ((await response.json()) as { theme_color?: string }).theme_color;
  expect(metaThemeColor).toBe(manifestThemeColor);
});

test('the Add a book shortcut lands on the form, not just the app', async ({ page }) => {
  await page.goto(new URL('#add', PRODUCTION_URL).href);
  await expect(page.getByTestId('import-status')).not.toHaveText('Opening your private bookshelf…');

  await expect(page.getByLabel('Book title')).toBeFocused();
});

// Keep the older query-string shortcut working.
test('the older ?action=add shortcut still reaches Add', async ({ page }) => {
  await page.goto(new URL('?action=add', PRODUCTION_URL).href);
  await expect(page.getByTestId('import-status')).not.toHaveText('Opening your private bookshelf…');

  await expect(page.getByLabel('Book title')).toBeFocused();
});
