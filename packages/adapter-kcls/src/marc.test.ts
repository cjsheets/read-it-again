import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMarcMetadata } from './marc.js';

const fixture = fileURLToPath(new URL('../../test-fixtures/kcls/marc.xml', import.meta.url));

describe('KCLS MARC parser', () => {
  it('extracts attribution and recommendation metadata', async () => {
    expect(parseMarcMetadata(await readFile(fixture, 'utf8'))).toEqual({
      audience: 'b',
      juvenileHeading: true,
      subjects: ['Kites -- Juvenile fiction'],
      genres: ['Picture books'],
      contributors: [{ name: 'River, Sam', role: 'illustrator' }],
      pageCount: 32,
      callNumber: 'E NORTH',
      summary: 'A child follows a glowing kite through a quiet nighttime town',
      series: [{ name: 'Moonlit adventures', volume: '1' }],
    });
  });
});
