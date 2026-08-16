import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LibbySnapshotError, parseLibbySnapshot } from './parse.js';

const fixture = fileURLToPath(new URL('../../test-fixtures/libby/timeline.json', import.meta.url));

describe('parseLibbySnapshot', () => {
  it('normalizes a sanitized timeline and preserves missing ISBNs', async () => {
    const result = parseLibbySnapshot(await readFile(fixture, 'utf8'));

    expect(result).toMatchObject({ rowsSeen: 2, rowsIgnored: 0 });
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toMatchObject({
      title: 'The Moonlit Kite',
      isbn: '9780000000101',
      editionIdentifierNamespace: 'overdrive-title',
      editionIdentifierValue: 'edition-101',
      sourceFormat: 'ebook',
    });
    expect(result.records[1]?.isbn).toBeUndefined();
    expect(JSON.parse(result.records[0]?.authorsJson ?? '[]')).toEqual([
      { family: 'North', given: 'Riley', display: 'Riley North', raw: 'Riley North' },
    ]);
  });

  it('describes schema errors in plain language without leaking schema paths', () => {
    expect(() => parseLibbySnapshot('[{"title":{}}]')).toThrow(LibbySnapshotError);
    try {
      parseLibbySnapshot('[{"title":{}}]');
    } catch (error) {
      const { issues } = error as LibbySnapshotError;
      expect(issues).toContain('Entry 1: the title is missing or invalid.');
      // F-06: a parent must never be shown a raw Zod path such as `0.title.text`.
      expect(issues.some((issue) => /\d\.[a-z]+\./iu.test(issue))).toBe(false);
    }
  });

  it('explains a file that is not a timeline at all', () => {
    try {
      parseLibbySnapshot('{"activity":"borrowed"}');
      throw new Error('expected a LibbySnapshotError');
    } catch (error) {
      expect((error as LibbySnapshotError).issues).toContain(
        'This file is not a Libby timeline export. It should be a list of timeline entries.',
      );
    }
  });

  it('rejects malformed JSON before normalization', () => {
    expect(() => parseLibbySnapshot('{not json')).toThrow('JSON could not be parsed');
  });

  it('counts valid non-borrow activity without importing it', async () => {
    const raw = JSON.parse(await readFile(fixture, 'utf8')) as Record<string, unknown>[];
    raw[0] = { ...raw[0], activity: 'Returned' };

    const result = parseLibbySnapshot(JSON.stringify(raw));
    expect(result).toMatchObject({ rowsSeen: 2, rowsIgnored: 1 });
    expect(result.records).toHaveLength(1);
  });
});
