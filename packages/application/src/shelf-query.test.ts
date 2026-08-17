import { afterEach, describe, expect, it } from 'vitest';
import { NodeSqliteDatabase } from '@read-it-again/storage-node';
import { indexWorksForSearch, listShelf, migrate } from '@read-it-again/storage-schema';

/**
 * The shelf is one card per book, not one per reader-book pair:
 * a book both children have read must appear once, with a chip each.
 */
describe('listShelf', () => {
  let database: NodeSqliteDatabase | undefined;
  afterEach(async () => database?.close());

  it('returns one entry per work even when two readers share it', async () => {
    database = new NodeSqliteDatabase();
    await migrate(database);
    await seedSharedBook(database);
    await indexWorksForSearch(database);

    const page = await listShelf(database);

    expect(page.total).toBe(1);
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]?.readers.map((reader) => reader.displayName).sort()).toEqual([
      'Ada',
      'Kai',
    ]);
  });

  it('filters to one reader without losing the book', async () => {
    database = new NodeSqliteDatabase();
    await migrate(database);
    await seedSharedBook(database);

    const forAda = await listShelf(database, { readerId: 'ada' });
    expect(forAda.total).toBe(1);
    expect(forAda.entries[0]?.personId).toBe('ada');
  });

  it('hides an archived reader from the everyone view', async () => {
    database = new NodeSqliteDatabase();
    await migrate(database);
    await seedSharedBook(database);
    await database.run(
      "UPDATE reader_profiles SET archived_at = '2026-08-17T00:00:00.000Z' WHERE person_id = 'kai'",
    );

    const page = await listShelf(database);
    expect(page.total).toBe(1);
    expect(page.entries[0]?.readers.map((reader) => reader.id)).toEqual(['ada']);
  });

  it('matches on normalised title and author text', async () => {
    database = new NodeSqliteDatabase();
    await migrate(database);
    await seedSharedBook(database);
    await indexWorksForSearch(database);

    await expect(listShelf(database, { query: 'the gruff' })).resolves.toMatchObject({ total: 1 });
    await expect(listShelf(database, { query: 'donaldson' })).resolves.toMatchObject({ total: 1 });
    await expect(listShelf(database, { query: 'nothing' })).resolves.toMatchObject({ total: 0 });
  });
});

async function seedSharedBook(database: NodeSqliteDatabase): Promise<void> {
  const now = '2026-08-17T00:00:00.000Z';
  await database.exec(`
    INSERT INTO households (id, name, created_at) VALUES ('h', 'Family', '${now}');
    INSERT INTO people (id, household_id, display_name, created_at) VALUES
      ('ada', 'h', 'Ada', '${now}'), ('kai', 'h', 'Kai', '${now}');
    INSERT INTO reader_profiles (person_id, kind, created_at) VALUES
      ('ada', 'child', '${now}'), ('kai', 'child', '${now}');
    INSERT INTO works (id, canonical_title, created_at)
      VALUES ('work', 'The Gruffalo', '${now}');
    INSERT INTO editions (id, work_id, title, authors_json, created_at)
      VALUES ('edition', 'work', 'The Gruffalo', '[{"display":"Julia Donaldson"}]', '${now}');
    INSERT INTO preference_summaries
      (work_id, person_id, episode_count, strong_repeat_count, near_repeat_count,
       preference_score, algorithm_version, rebuilt_at)
      VALUES ('work', 'ada', 1, 0, 0, 0.5, 'v1', '${now}'),
             ('work', 'kai', 1, 0, 0, 0.5, 'v1', '${now}');
  `);
}
