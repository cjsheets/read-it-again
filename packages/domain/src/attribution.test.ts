import { describe, expect, it } from 'vitest';
import { assessAttribution } from './attribution.js';

describe('explainable attribution rules', () => {
  it('assigns strong juvenile evidence to the only candidate reader', () => {
    expect(
      assessAttribution({ callNumber: 'E NORTH', audience: 'b', candidateReaderIds: ['child'] }),
    ).toMatchObject({ state: 'assigned', readerIds: ['child'], confidence: 1 });
  });

  it('excludes unmarked digital history using the explicit adult-heavy prior', () => {
    const result = assessAttribution({ sourceFormat: 'ebook', candidateReaderIds: ['child'] });
    expect(result).toMatchObject({ state: 'excluded', readerIds: [], confidence: 0.65 });
    expect(result.explanation).toContain('adult-heavy');
  });

  it('queues a child-like title when evidence cannot distinguish multiple readers', () => {
    expect(
      assessAttribution({ juvenileHeading: true, candidateReaderIds: ['child-a', 'child-b'] }),
    ).toMatchObject({ state: 'review', readerIds: [] });
  });
});
