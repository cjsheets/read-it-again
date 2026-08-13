import { describe, expect, it } from 'vitest';
import { CsvImportError, parseCsvSnapshot } from './parse.js';

describe('generic CSV parser', () => {
  it('recognizes common columns and quoted commas', () => {
    const parsed = parseCsvSnapshot(
      'Title,Author,ISBN,Date Read,Format\n"Bear, Again",Ada Fox,978-1,2026-08-01,Book',
    );
    expect(parsed.records[0]).toMatchObject({
      title: 'Bear, Again',
      isbn: '9781',
      sourceFormat: 'Book',
      occurredAt: '2026-08-01T00:00:00.000Z',
    });
  });
  it('rejects the full file when a required row is invalid', () => {
    expect(() => parseCsvSnapshot('Title,Author\n,Somebody')).toThrow(CsvImportError);
  });
});
