import type { Browser, BrowserContextOptions, Page } from 'playwright';
import { parseBibliocommonsSnapshot, type BibliocommonsParseResult } from './parse.js';

export const RECENTLY_RETURNED_URL = 'https://kcls.bibliocommons.com/v2/print/recentlyreturned';

export interface BibliocommonsCardSession {
  readonly cardId: string;
  readonly contextOptions?: BrowserContextOptions;
  readonly authenticate?: (page: Page) => Promise<void>;
}

export interface AcquiredBibliocommonsSnapshot {
  readonly cardId: string;
  readonly html: string;
  readonly parsed: BibliocommonsParseResult;
  readonly pagesLoaded: number;
}

export class BibliocommonsAcquisitionError extends Error {
  constructor(
    readonly cardId: string,
    readonly reason:
      'login-required' | 'session-expired' | 'selector-contract' | 'pagination-incomplete',
    message: string,
    options?: ErrorOptions,
  ) {
    super(`BiblioCommons acquisition failed for card ${cardId}: ${message}`, options);
    this.name = 'BibliocommonsAcquisitionError';
  }
}

export async function acquireBibliocommonsCards(
  browser: Browser,
  cards: readonly BibliocommonsCardSession[],
  options: {
    readonly maxPages?: number;
    readonly timeoutMs?: number;
    readonly recentlyReturnedUrl?: string;
  } = {},
): Promise<readonly AcquiredBibliocommonsSnapshot[]> {
  const output: AcquiredBibliocommonsSnapshot[] = [];
  for (const card of cards) output.push(await acquireCard(browser, card, options));
  return output;
}

async function acquireCard(
  browser: Browser,
  card: BibliocommonsCardSession,
  options: {
    readonly maxPages?: number;
    readonly timeoutMs?: number;
    readonly recentlyReturnedUrl?: string;
  },
): Promise<AcquiredBibliocommonsSnapshot> {
  const context = await browser.newContext(card.contextOptions);
  try {
    const page = await context.newPage();
    if (card.authenticate) await card.authenticate(page);
    await page.goto(options.recentlyReturnedUrl ?? RECENTLY_RETURNED_URL, {
      waitUntil: 'domcontentloaded',
      timeout: options.timeoutMs ?? 30_000,
    });
    await assertAuthenticated(page, card.cardId, 'login-required');
    await waitForRows(page, card.cardId, options.timeoutMs ?? 30_000);

    let pagesLoaded = 1;
    const maxPages = options.maxPages ?? 100;
    while (await hasLoadMore(page)) {
      if (pagesLoaded >= maxPages) {
        throw new BibliocommonsAcquisitionError(
          card.cardId,
          'pagination-incomplete',
          `the Load next 50 control remained after ${maxPages} pages`,
        );
      }
      const before = await rowCount(page);
      await loadMoreButton(page).click();
      try {
        await page.waitForFunction(
          (previous) => document.querySelectorAll('td.item-title p.main-title').length > previous,
          before,
          { timeout: options.timeoutMs ?? 30_000 },
        );
      } catch (error) {
        await assertAuthenticated(page, card.cardId, 'session-expired');
        throw new BibliocommonsAcquisitionError(
          card.cardId,
          'pagination-incomplete',
          'Load next 50 did not append any rows',
          { cause: error },
        );
      }
      pagesLoaded += 1;
    }

    await assertAuthenticated(page, card.cardId, 'session-expired');
    const html = await page.content();
    try {
      return { cardId: card.cardId, html, parsed: parseBibliocommonsSnapshot(html), pagesLoaded };
    } catch (error) {
      throw new BibliocommonsAcquisitionError(
        card.cardId,
        'selector-contract',
        error instanceof Error ? error.message : String(error),
        { cause: error },
      );
    }
  } finally {
    await context.close();
  }
}

async function assertAuthenticated(
  page: Page,
  cardId: string,
  reason: 'login-required' | 'session-expired',
): Promise<void> {
  const url = page.url().toLowerCase();
  const signInVisible = await page
    .locator('form[action*="login"], input[type="password"], [data-test-id*="login"]')
    .first()
    .isVisible()
    .catch(() => false);
  if (url.includes('/user/login') || url.includes('/login') || signInVisible) {
    throw new BibliocommonsAcquisitionError(cardId, reason, 'the card session is not signed in');
  }
}

async function waitForRows(page: Page, cardId: string, timeout: number): Promise<void> {
  try {
    await page.locator('td.item-title p.main-title').first().waitFor({ state: 'visible', timeout });
  } catch (error) {
    throw new BibliocommonsAcquisitionError(
      cardId,
      'selector-contract',
      'the recently-returned row selectors were not present',
      { cause: error },
    );
  }
}

function loadMoreButton(page: Page) {
  return page
    .getByRole('button', { name: /load next 50/i })
    .or(page.getByRole('link', { name: /load next 50/i }))
    .first();
}

async function hasLoadMore(page: Page): Promise<boolean> {
  const button = loadMoreButton(page);
  return (await button.count()) > 0 && (await button.isVisible()) && (await button.isEnabled());
}

async function rowCount(page: Page): Promise<number> {
  return page.locator('td.item-title p.main-title').count();
}
