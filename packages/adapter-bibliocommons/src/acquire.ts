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
      | 'login-required'
      | 'session-expired'
      | 'history-disabled'
      | 'selector-contract'
      | 'pagination-incomplete',
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
    await assertBibliocommonsHistoryReady(page, card.cardId, 'login-required');
    await waitForRows(page, card.cardId, options.timeoutMs ?? 30_000);

    let currentRows = await rowMarkup(page);
    const collectedRows = [...currentRows];
    validateRows(currentRows);

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
      const before = rowSignature(currentRows);
      await loadMoreButton(page).click();
      try {
        await page.waitForFunction(
          (previous) =>
            Array.from(document.querySelectorAll('tr'))
              .filter((row) => row.querySelector('td.item-title'))
              .map((row) => row.outerHTML)
              .join('\u001f') !== previous,
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
      const nextRows = await rowMarkup(page);
      validateRows(nextRows);
      collectedRows.push(...newRows(currentRows, nextRows));
      currentRows = nextRows;
      pagesLoaded += 1;
    }

    await assertAuthenticated(page, card.cardId, 'session-expired');
    const html = snapshotHtml(collectedRows, pagesLoaded);
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

/**
 * Verifies the account prerequisites that can be checked without changing a patron's privacy
 * settings. Enabling borrowing history is intentionally left to the account owner.
 */
export async function assertBibliocommonsHistoryReady(
  page: Page,
  cardId: string,
  loginReason: 'login-required' | 'session-expired' = 'login-required',
): Promise<void> {
  await assertAuthenticated(page, cardId, loginReason);
  const bodyText = await page
    .locator('body')
    .innerText()
    .catch(() => '');
  if (borrowingHistoryLooksDisabled(bodyText)) {
    throw new BibliocommonsAcquisitionError(
      cardId,
      'history-disabled',
      'borrowing history is off; a parent must enable it under My Settings → Account Preferences → Borrowing History, then return here',
    );
  }
}

function borrowingHistoryLooksDisabled(bodyText: string): boolean {
  const text = bodyText.replaceAll(/\s+/gu, ' ').toLowerCase();
  return [
    /borrowing history (?:is )?(?:currently )?(?:off|disabled|not enabled)/u,
    /(?:enable|turn on) borrowing history (?:to|if you want to) (?:see|view|start|keep)/u,
    /you (?:have not|haven't) enabled borrowing history/u,
  ].some((pattern) => pattern.test(text));
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

async function rowMarkup(page: Page): Promise<readonly string[]> {
  return page
    .locator('tr')
    .evaluateAll((rows) =>
      rows.filter((row) => row.querySelector('td.item-title')).map((row) => row.outerHTML),
    );
}

function rowSignature(rows: readonly string[]): string {
  return rows.join('\u001f');
}

function newRows(previous: readonly string[], current: readonly string[]): readonly string[] {
  const appended =
    current.length > previous.length && previous.every((row, index) => current[index] === row);
  return appended ? current.slice(previous.length) : current;
}

function validateRows(rows: readonly string[]): void {
  parseBibliocommonsSnapshot(snapshotHtml(rows, 1));
}

function snapshotHtml(rows: readonly string[], pagesLoaded: number): string {
  return `<table data-read-it-again-pages="${pagesLoaded}"><tbody>${rows.join('\n')}</tbody></table>`;
}
