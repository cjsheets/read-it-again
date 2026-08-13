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
});
