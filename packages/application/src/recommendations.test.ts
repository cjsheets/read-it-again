import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeSqliteDatabase } from '@read-it-again/storage-node';
import { migrate } from '@read-it-again/storage-schema';
import { generateRecommendations, type RecommendationCatalogPort } from './recommendations.js';

describe('recommendation workflow', () => {
  let database: NodeSqliteDatabase | undefined;
  afterEach(async () => database?.close());

  it('persists explained discovery and read-again lists with a 24-hour holdings cache', async () => {
    database = new NodeSqliteDatabase();
    await migrate(database);
    await seed(database);
    const holdings = vi.fn<RecommendationCatalogPort['getHoldings']>().mockResolvedValue({
      systemAvailable: 2,
      systemTotal: 5,
      branches: [{ shortName: 'BEL', name: 'Bellevue', available: 1, callNumbers: ['E NORTH'] }],
      sourceUrl: 'https://w3.kcls.org/holdings',
    });
    const catalog: RecommendationCatalogPort = {
      search: vi.fn().mockResolvedValue([
        {
          catalogKey: '101',
          title: 'Moonlit Kite',
          authorDisplays: ['Riley North'],
          isbns: [],
          juvenile: true,
          format: 'book',
        },
        {
          catalogKey: '102',
          title: 'Moonlit Boat',
          authorDisplays: ['Riley North'],
          isbns: [],
          juvenile: true,
          format: 'book',
        },
      ]),
      getMarcMetadata: vi.fn().mockImplementation(async (key: string) => ({
        juvenileHeading: true,
        audience: 'b',
        subjects: ['Kites'],
        genres: ['Picture books'],
        contributors: [{ name: 'Sam River', role: 'illustrator' }],
        pageCount: 32,
        series: [{ name: 'Moonlit adventures', volume: key === '101' ? '1' : '2' }],
      })),
      getHoldings: holdings,
    };
    let id = 0;
    const input = {
      householdId: 'household',
      personId: 'child',
      maxReadMinutes: 10,
      idFactory: () => `rec-${id++}`,
      now: () => new Date('2026-08-13T12:00:00.000Z'),
    };
    const first = await generateRecommendations(database, catalog, input);
    expect(first.discovery).toHaveLength(1);
    expect(first.discovery[0]?.catalogKey).toBe('102');
    expect(first.discovery[0]?.title).toBe('Moonlit Boat');
    expect(first.discovery[0]?.holdings.systemAvailable).toBe(2);
    expect(first.discovery[0]?.evidence).toEqual(
      expect.arrayContaining([expect.stringContaining('favored series')]),
    );
    expect(first.readAgain).toEqual([
      expect.objectContaining({ catalogKey: '101', workId: 'work' }),
    ]);
    expect(holdings).toHaveBeenCalledTimes(2);
    await generateRecommendations(database, catalog, input);
    expect(holdings).toHaveBeenCalledTimes(2);
  });
});

async function seed(database: NodeSqliteDatabase): Promise<void> {
  const now = '2026-01-01T00:00:00.000Z';
  await database.exec(`
    INSERT INTO households (id, name, created_at) VALUES ('household', 'Family', '${now}');
    INSERT INTO people (id, household_id, display_name, created_at) VALUES ('child', 'household', 'Child', '${now}');
    INSERT INTO reader_profiles (person_id, kind, created_at) VALUES ('child', 'child', '${now}');
    INSERT INTO works (id, canonical_title, primary_author, created_at) VALUES ('work', 'Moonlit Kite', 'Riley North', '${now}');
    INSERT INTO editions (id, work_id, title, authors_json, format, created_at) VALUES ('edition', 'work', 'Moonlit Kite', '[{"display":"Riley North"}]', 'book', '${now}');
    INSERT INTO external_identifiers (id, entity_kind, entity_id, namespace, value, source, confidence, created_at) VALUES ('identifier', 'edition', 'edition', 'kcls-bibid', '101', 'test', 1, '${now}');
    INSERT INTO acquisition_episodes (id, household_id, work_id, person_id, window_start, window_end, recurrence_kind, checkout_count, preference_weight, algorithm_version, rebuilt_at) VALUES ('episode', 'household', 'work', 'child', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', 'strong_repeat', 1, 1, 'episodes-v1', '${now}');
    INSERT INTO preference_summaries (work_id, person_id, episode_count, strong_repeat_count, near_repeat_count, preference_score, algorithm_version, rebuilt_at) VALUES ('work', 'child', 3, 1, 0, 4, 'preference-v1', '${now}');
    INSERT INTO work_assessments (work_id, person_id, child_engagement, adult_tolerance, asks_by_name, veto, estimated_read_minutes, traits_json, updated_at) VALUES ('work', 'child', 3, 3, 1, 0, 8, '["quiet_arc","illustration_led"]', '${now}');
    INSERT INTO metadata_facts (id, entity_kind, entity_id, field, value_json, source, source_ref, precedence, fetched_at) VALUES
      ('fact-series', 'edition', 'edition', 'series', '[{"name":"Moonlit adventures","volume":"1"}]', 'marc', '101', 400, '${now}'),
      ('fact-subject', 'edition', 'edition', 'subjects', '["Kites"]', 'marc', '101', 400, '${now}'),
      ('fact-genre', 'edition', 'edition', 'genres', '["Picture books"]', 'marc', '101', 400, '${now}'),
      ('fact-contributor', 'edition', 'edition', 'contributors', '[{"name":"Sam River","role":"illustrator"}]', 'marc', '101', 400, '${now}');
  `);
}
