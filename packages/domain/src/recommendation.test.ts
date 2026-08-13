import { describe, expect, it } from 'vitest';
import { scoreDiscoveryCandidates, type PreferenceFeature } from './recommendation.js';

const love: PreferenceFeature = {
  workId: 'known',
  title: 'Moonlit Kite',
  authors: ['Riley North'],
  illustrators: ['Sam River'],
  series: ['Moonlit adventures'],
  subjects: ['Kites'],
  genres: ['Picture books'],
  traits: ['quiet_arc', 'illustration_led'],
  preferenceScore: 4,
  lastEpisodeAt: '2026-08-01T00:00:00.000Z',
  estimatedReadMinutes: 8,
  adultTolerance: 3,
  veto: false,
  catalogKeys: ['101'],
};

describe('deterministic recommendations', () => {
  it('explains matches, enforces exclusions, duration, juvenile, and author diversity', () => {
    const candidates = scoreDiscoveryCandidates(
      [love],
      [
        {
          catalogKey: '101',
          title: 'Moonlit Kite',
          authors: ['Riley North'],
          illustrators: [],
          series: [],
          subjects: [],
          genres: [],
          format: 'book',
          juvenile: true,
        },
        {
          catalogKey: '102',
          title: 'Moonlit Boat',
          authors: ['Riley North'],
          illustrators: ['Sam River'],
          series: ['Moonlit adventures'],
          subjects: ['Boats'],
          genres: ['Picture books'],
          format: 'book',
          juvenile: true,
          pageCount: 32,
        },
        {
          catalogKey: '103',
          title: 'Moonlit Train',
          authors: ['Riley North'],
          illustrators: [],
          series: ['Moonlit adventures'],
          subjects: [],
          genres: ['Picture books'],
          format: 'book',
          juvenile: true,
          pageCount: 32,
        },
        {
          catalogKey: '104',
          title: 'Moonlit Plane',
          authors: ['Riley North'],
          illustrators: [],
          series: ['Moonlit adventures'],
          subjects: [],
          genres: ['Picture books'],
          format: 'book',
          juvenile: true,
          pageCount: 32,
        },
        {
          catalogKey: '105',
          title: 'Long Adult Book',
          authors: ['Else Author'],
          illustrators: [],
          series: [],
          subjects: ['Kites'],
          genres: [],
          format: 'book',
          juvenile: false,
          pageCount: 400,
        },
      ],
      { allowedFormats: ['book'], maxReadMinutes: 10, maxPerAuthor: 2, maxPerSubject: 3 },
      new Date('2026-08-13T00:00:00.000Z'),
    );
    expect(candidates.map(({ candidate }) => candidate.catalogKey)).toEqual(['102', '103']);
    expect(candidates[0]?.evidence).toEqual(
      expect.arrayContaining([
        expect.stringContaining('favored series'),
        expect.stringContaining('8 minutes'),
      ]),
    );
  });
});
