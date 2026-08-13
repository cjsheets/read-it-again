import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { rankCandidates, type CatalogCandidate, type ResolutionInput } from './index.js';

interface GoldenFixture {
  readonly input: ResolutionInput;
  readonly candidates: readonly CatalogCandidate[];
  readonly expectedTopCatalogKey: string;
  readonly expectedAutomatic: boolean;
}

const fixture = fileURLToPath(
  new URL('../../test-fixtures/resolution/golden.json', import.meta.url),
);

describe('golden resolution decisions', () => {
  it('preserves reviewed ranking behavior', async () => {
    const golden = JSON.parse(await readFile(fixture, 'utf8')) as GoldenFixture;
    const ranking = rankCandidates(golden.input, golden.candidates);
    expect(ranking[0]?.candidate.catalogKey).toBe(golden.expectedTopCatalogKey);
    expect(ranking[0]?.automatic).toBe(golden.expectedAutomatic);
  });
});
