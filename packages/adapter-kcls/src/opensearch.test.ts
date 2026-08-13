import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseOpenSearch } from './opensearch.js';

const fixture = fileURLToPath(new URL('../../test-fixtures/kcls/opensearch.xml', import.meta.url));

describe('parseOpenSearch', () => {
  it('extracts stable KCLS identity and ISBNs', async () => {
    const candidates = parseOpenSearch(await readFile(fixture, 'utf8'));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      catalogKey: '101',
      title: 'The Moonlit Kite',
      isbns: ['9780000000101'],
      authorDisplays: ['North, Riley'],
      juvenile: true,
    });
  });
});
