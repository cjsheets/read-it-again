import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { acquireBibliocommonsCards, BibliocommonsAcquisitionError } from './acquire.js';

const row = (title: string) => `<tr>
  <td class="item-title"><p class="main-title">${title}</p></td>
  <td class="item-author">Writer, Ada</td>
  <td class="item-format">Book <span class="publication-date">2024</span></td>
  <td class="item-callnumber"><p class="callnumber-details">E WRITER</p></td>
  <td class="item-checkedoutdate">08/01/2026</td>
</tr>`;

describe('local BiblioCommons Playwright acquisition', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => browser.close());

  it('walks Load next 50 to exhaustion in an isolated context per card', async () => {
    const html = `<table><tbody id="rows">${row('First')}</tbody></table>
      <button id="more">Load next 50</button>
      <script>
        document.querySelector('#more').addEventListener('click', () => {
          document.querySelector('#rows').insertAdjacentHTML('beforeend', ${JSON.stringify(row('Second'))});
          document.querySelector('#more').remove();
        });
      </script>`;
    const result = await acquireBibliocommonsCards(
      browser,
      [{ cardId: 'one' }, { cardId: 'two' }],
      { recentlyReturnedUrl: `data:text/html,${encodeURIComponent(html)}`, timeoutMs: 5_000 },
    );
    expect(
      result.map(({ cardId, pagesLoaded, parsed }) => [cardId, pagesLoaded, parsed.rowsSeen]),
    ).toEqual([
      ['one', 2, 2],
      ['two', 2, 2],
    ]);
  });

  it('collects every page when Load next 50 replaces the current rows', async () => {
    const html = `<table><tbody id="rows">${row('First')}</tbody></table>
      <button id="more">Load next 50</button>
      <script>
        document.querySelector('#more').addEventListener('click', () => {
          document.querySelector('#rows').innerHTML = ${JSON.stringify(row('Second'))};
          document.querySelector('#more').remove();
        });
      </script>`;
    const [result] = await acquireBibliocommonsCards(browser, [{ cardId: 'replacement' }], {
      recentlyReturnedUrl: `data:text/html,${encodeURIComponent(html)}`,
      timeoutMs: 5_000,
    });
    expect(result).toMatchObject({ pagesLoaded: 2, parsed: { rowsSeen: 2 } });
    expect(result?.parsed.records.map(({ title }) => title)).toEqual(['First', 'Second']);
  });

  it('classifies a login page as a failed acquisition', async () => {
    await expect(
      acquireBibliocommonsCards(browser, [{ cardId: 'expired' }], {
        recentlyReturnedUrl: `data:text/html,${encodeURIComponent('<form action="/login"><input type="password"></form>')}`,
      }),
    ).rejects.toMatchObject({
      cardId: 'expired',
      reason: 'login-required',
    });
  });

  it('explains when the account has not opted in to borrowing history', async () => {
    const html = `<main>
      <h1>Borrowing History</h1>
      <p>Borrowing History is currently disabled.</p>
      <a href="/settings">Enable borrowing history to start keeping returned titles.</a>
    </main>`;
    let caught: unknown;
    try {
      await acquireBibliocommonsCards(browser, [{ cardId: 'child-card' }], {
        recentlyReturnedUrl: `data:text/html,${encodeURIComponent(html)}`,
        timeoutMs: 1_000,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BibliocommonsAcquisitionError);
    if (!(caught instanceof BibliocommonsAcquisitionError)) return;
    expect(caught).toMatchObject({
      cardId: 'child-card',
      reason: 'history-disabled',
    });
    expect(caught.message).toContain('a parent must enable it');
  });
});
