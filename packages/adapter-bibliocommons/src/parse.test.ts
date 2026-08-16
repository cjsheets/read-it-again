import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BibliocommonsSnapshotError, parseBibliocommonsSnapshot } from './parse.js';

const fixture = fileURLToPath(
  new URL('../../test-fixtures/bibliocommons/recently-returned.html', import.meta.url),
);

describe('BiblioCommons saved HTML parser', () => {
  it('honors the selector contract and normalizes family-first authors', async () => {
    const result = parseBibliocommonsSnapshot(await readFile(fixture, 'utf8'));
    expect(result).toEqual({
      rowsSeen: 1,
      records: [
        {
          title: 'The Moonlit Kite',
          subtitle: 'a bedtime adventure',
          authors: [
            { family: 'North', given: 'Riley', display: 'Riley North', raw: 'North, Riley' },
          ],
          sourceFormat: 'Book',
          publishedYear: 2025,
          callNumber: 'E NORTH',
          occurredAt: '2026-08-01T00:00:00.000Z',
          rawPayload: {
            title: 'The Moonlit Kite',
            subtitle: 'a bedtime adventure',
            author: 'North, Riley',
            format: 'Book',
            publishedYear: 2025,
            callNumber: 'E NORTH',
            checkedOutDate: '08/01/2026',
          },
        },
      ],
    });
  });

  it('fails the whole snapshot when a required selector is missing', () => {
    expect(() =>
      parseBibliocommonsSnapshot(`
        <table><tr>
          <td class="item-title"><p class="main-title">Book</p></td>
          <td class="item-author">Writer, Ada</td>
        </tr></table>`),
    ).toThrow(BibliocommonsSnapshotError);
  });

  it('accepts the current KCLS comma-prefixed year and named return date', () => {
    const result = parseBibliocommonsSnapshot(`<table><tr>
      <td class="item-title"><p class="main-title">Current markup</p></td>
      <td class="item-author">Writer, Ada</td>
      <td class="item-format">Book <span class="publication-date">, 2020</span></td>
      <td class="item-callnumber"><p class="callnumber-details">E WRITER</p></td>
      <td class="item-checkedoutdate">Aug 14, 2026</td>
    </tr></table>`);
    expect(result.records[0]).toMatchObject({
      publishedYear: 2020,
      occurredAt: '2026-08-14T00:00:00.000Z',
    });
  });

  it('still rejects impossible named dates', () => {
    expect(() =>
      parseBibliocommonsSnapshot(`<table><tr>
        <td class="item-title"><p class="main-title">Bad date</p></td>
        <td class="item-author">Writer, Ada</td>
        <td class="item-format">Book <span class="publication-date">, 2020</span></td>
        <td class="item-callnumber"><p class="callnumber-details">E WRITER</p></td>
        <td class="item-checkedoutdate">Feb 30, 2026</td>
      </tr></table>`),
    ).toThrow('invalid checkout date');
  });

  it('preserves a valid catalog row that has no credited author', () => {
    const result = parseBibliocommonsSnapshot(`<table><tr>
      <td class="item-title"><p class="main-title">Authorless work</p></td>
      <td class="item-author"></td>
      <td class="item-format">DVD <span class="publication-date">, 2020</span></td>
      <td class="item-callnumber"><p class="callnumber-details">J DVD AUTHORLESS</p></td>
      <td class="item-checkedoutdate">Aug 14, 2026</td>
    </tr></table>`);
    expect(result.records[0]).toMatchObject({ authors: [], rawPayload: { author: '' } });
  });
});
