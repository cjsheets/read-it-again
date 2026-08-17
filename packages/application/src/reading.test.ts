import { afterEach, describe, expect, it } from 'vitest';
import { NodeSqliteDatabase } from '@read-it-again/storage-node';
import { migrate } from '@read-it-again/storage-schema';
import { assessWork, rebuildReadingModel, recordReadingSession } from './reading.js';

describe('reading model workflow', () => {
  let database: NodeSqliteDatabase | undefined;
  afterEach(async () => database?.close());

  it('rebuilds episodes, stores confirmed sessions separately, and updates preferences', async () => {
    database = new NodeSqliteDatabase();
    await migrate(database);
    await seed(database);
    let sequence = 0;
    const idFactory = () => `reading-${sequence++}`;
    const model = await rebuildReadingModel(database, {
      idFactory,
      now: () => new Date('2026-08-13T12:00:00.000Z'),
    });
    expect(model.checkouts).toHaveLength(4);
    expect(
      model.episodes.map(({ recurrenceKind, checkoutCount }) => ({
        recurrenceKind,
        checkoutCount,
      })),
    ).toEqual([
      { recurrenceKind: 'strong_repeat', checkoutCount: 1 },
      { recurrenceKind: 'near_repeat', checkoutCount: 1 },
      { recurrenceKind: 'initial', checkoutCount: 2 },
    ]);
    expect(model.sessions).toHaveLength(0);

    const withSession = await recordReadingSession(database, {
      householdId: 'household',
      workId: 'work',
      participantIds: ['child'],
      occurredAt: '2026-08-12T19:30:00.000Z',
      durationMinutes: 9,
      context: 'bedtime',
      idFactory,
      now: () => new Date('2026-08-13T12:01:00.000Z'),
    });
    expect(withSession.model.sessions).toEqual([
      expect.objectContaining({
        title: 'Moonlit Kite',
        durationMinutes: 9,
        context: 'bedtime',
        participantNames: ['Child'],
      }),
    ]);
    expect(withSession.model.checkouts).toHaveLength(4);

    const assessed = await assessWork(database, {
      workId: 'work',
      personId: 'child',
      childEngagement: 3,
      adultTolerance: 2,
      asksByName: true,
      estimatedReadMinutes: 9,
      traits: ['rhyme_meter', 'quiet_arc'],
      now: () => new Date('2026-08-13T12:02:00.000Z'),
    });
    expect(assessed.shelf[0]).toMatchObject({
      episodeCount: 3,
      preferenceScore: 3.6,
      childEngagement: 3,
      adultTolerance: 2,
      asksByName: true,
      traits: ['rhyme_meter', 'quiet_arc'],
    });
    expect((await rebuildReadingModel(database, { idFactory })).episodes).toHaveLength(3);
  });
});

async function seed(database: NodeSqliteDatabase): Promise<void> {
  const now = '2026-01-01T00:00:00.000Z';
  await database.exec(`
    INSERT INTO households (id, name, created_at) VALUES ('household', 'Family', '${now}');
    INSERT INTO people (id, household_id, display_name, created_at) VALUES ('child', 'household', 'Child', '${now}');
    INSERT INTO reader_profiles (person_id, kind, created_at) VALUES ('child', 'child', '${now}');
    INSERT INTO source_accounts (id, household_id, kind, label, config_json, created_at) VALUES ('source', 'household', 'libby', 'Libby', '{}', '${now}');
    INSERT INTO import_blobs (id, source_account_id, sha256, media_type, content_text, byte_length, created_at) VALUES ('blob', 'source', '${'0'.repeat(64)}', 'application/json', '[]', 2, '${now}');
    INSERT INTO import_runs (id, source_account_id, import_blob_id, status, rows_seen, rows_new, rows_ignored, started_at, finished_at) VALUES ('run', 'source', 'blob', 'completed', 4, 4, 0, '${now}', '${now}');
    INSERT INTO works (id, canonical_title, created_at) VALUES ('work', 'Moonlit Kite', '${now}');
    INSERT INTO editions (id, work_id, title, authors_json, created_at) VALUES ('edition', 'work', 'Moonlit Kite', '[]', '${now}');
    INSERT INTO import_records (id, source_account_id, first_import_run_id, source_key, normalization_version, raw_payload_json, title, authors_json, occurred_at, created_at) VALUES
      ('a', 'source', 'run', 'a', 1, '{}', 'Moonlit Kite', '[]', '2026-01-01T00:00:00.000Z', '${now}'),
      ('b', 'source', 'run', 'b', 1, '{}', 'Moonlit Kite', '[]', '2026-01-08T00:00:00.000Z', '${now}'),
      ('c', 'source', 'run', 'c', 1, '{}', 'Moonlit Kite', '[]', '2026-02-01T00:00:00.000Z', '${now}'),
      ('d', 'source', 'run', 'd', 1, '{}', 'Moonlit Kite', '[]', '2026-08-01T00:00:00.000Z', '${now}');
    INSERT INTO resolution_cases (id, import_record_id, cache_key, status, algorithm_version, created_at, updated_at) VALUES
      ('ca', 'a', 'x', 'resolved', 'v1', '${now}', '${now}'), ('cb', 'b', 'x', 'resolved', 'v1', '${now}', '${now}'),
      ('cc', 'c', 'x', 'resolved', 'v1', '${now}', '${now}'), ('cd', 'd', 'x', 'resolved', 'v1', '${now}', '${now}');
    INSERT INTO resolution_decisions (id, resolution_case_id, action, edition_id, method, confidence, current, created_at) VALUES
      ('da', 'ca', 'accept', 'edition', 'manual', 1, 1, '${now}'), ('db', 'cb', 'accept', 'edition', 'manual', 1, 1, '${now}'),
      ('dc', 'cc', 'accept', 'edition', 'manual', 1, 1, '${now}'), ('dd', 'cd', 'accept', 'edition', 'manual', 1, 1, '${now}');
    INSERT INTO attribution_results (id, import_record_id, state, method, confidence, score, explanation, algorithm_version, current, created_at) VALUES
      ('aa', 'a', 'assigned', 'evidence_rules', 1, 1, 'test', 'v1', 1, '${now}'), ('ab', 'b', 'assigned', 'evidence_rules', 1, 1, 'test', 'v1', 1, '${now}'),
      ('ac', 'c', 'assigned', 'evidence_rules', 1, 1, 'test', 'v1', 1, '${now}'), ('ad', 'd', 'assigned', 'evidence_rules', 1, 1, 'test', 'v1', 1, '${now}');
    INSERT INTO attribution_result_readers (attribution_result_id, person_id) VALUES ('aa', 'child'), ('ab', 'child'), ('ac', 'child'), ('ad', 'child');
  `);
}
