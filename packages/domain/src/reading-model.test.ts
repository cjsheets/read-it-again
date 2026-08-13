import { describe, expect, it } from 'vitest';
import { clusterAcquisitionEpisodes, preferenceScore } from './reading-model.js';

describe('reading acquisition model', () => {
  it('merges seven-day observations and distinguishes near and strong repeats', () => {
    const episodes = clusterAcquisitionEpisodes([
      { importRecordId: 'a', occurredAt: '2026-01-01T00:00:00.000Z' },
      { importRecordId: 'b', occurredAt: '2026-01-08T00:00:00.000Z' },
      { importRecordId: 'c', occurredAt: '2026-02-01T00:00:00.000Z' },
      { importRecordId: 'd', occurredAt: '2026-08-01T00:00:00.000Z' },
    ]);
    expect(
      episodes.map(({ checkoutIds, recurrenceKind, preferenceWeight }) => ({
        checkoutIds,
        recurrenceKind,
        preferenceWeight,
      })),
    ).toEqual([
      { checkoutIds: ['a', 'b'], recurrenceKind: 'initial', preferenceWeight: 1 },
      { checkoutIds: ['c'], recurrenceKind: 'near_repeat', preferenceWeight: 0.6 },
      { checkoutIds: ['d'], recurrenceKind: 'strong_repeat', preferenceWeight: 1 },
    ]);
  });

  it('uses engagement and request-by-name without allowing a vetoed work to score', () => {
    const episodes = [{ preferenceWeight: 1 }, { preferenceWeight: 0.6 }];
    expect(preferenceScore(episodes, { childEngagement: 3, asksByName: true })).toBe(2.6);
    expect(preferenceScore(episodes, { veto: true })).toBe(0);
  });
});
