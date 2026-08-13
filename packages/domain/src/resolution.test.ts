import { describe, expect, it } from 'vitest';
import { rankCandidates } from './resolution.js';

describe('candidate ranking', () => {
  const input = {
    title: 'The Moonlit Kite',
    authorDisplays: ['Riley North'],
    isbn: '9780000000101',
    format: 'ebook',
  };

  it('auto-accepts an exact ISBN with a clear margin', () => {
    const ranked = rankCandidates(input, [
      {
        catalogKey: '101',
        title: 'Moonlit Kite',
        authorDisplays: ['North, Riley'],
        isbns: ['9780000000101'],
        format: 'ebook',
      },
      {
        catalogKey: '102',
        title: 'Kites at Night',
        authorDisplays: ['Someone Else'],
        isbns: [],
        format: 'book',
      },
    ]);
    expect(ranked[0]).toMatchObject({ rank: 1, automatic: true });
    expect(ranked[0]?.score.isbn).toBe(1);
  });

  it('quarantines a crowded field despite a strong top score', () => {
    const withoutIsbn = { ...input, isbn: undefined };
    const ranked = rankCandidates(withoutIsbn, [
      {
        catalogKey: '101',
        title: 'The Moonlit Kite',
        authorDisplays: ['Riley North'],
        isbns: [],
        format: 'ebook',
      },
      {
        catalogKey: '102',
        title: 'Moonlit Kite',
        authorDisplays: ['North, Riley'],
        isbns: [],
        format: 'book',
      },
    ]);
    expect(ranked[0]?.automatic).toBe(false);
    expect(ranked[0]?.margin).toBeLessThan(0.15);
  });
});
