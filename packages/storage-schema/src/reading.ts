import type { Database } from './database.js';
import { inTransaction } from './database.js';

export const READING_TRAITS = [
  'rhyme_meter',
  'refrain_repetition',
  'interactive',
  'quiet_arc',
  'humor',
  'vocabulary_stretch',
  'illustration_led',
] as const;
export type ReadingTrait = (typeof READING_TRAITS)[number];

export interface ReadingModelView {
  readonly checkouts: readonly {
    readonly id: string;
    readonly title: string;
    readonly workId: string;
    readonly occurredAt: string;
    readonly readers: readonly string[];
  }[];
  readonly episodes: readonly {
    readonly id: string;
    readonly title: string;
    readonly workId: string;
    readonly personId: string;
    readonly readerName: string;
    readonly windowStart: string;
    readonly windowEnd: string;
    readonly recurrenceKind: string;
    readonly checkoutCount: number;
    readonly preferenceWeight: number;
  }[];
  readonly sessions: readonly {
    readonly id: string;
    readonly title: string;
    readonly workId: string;
    readonly occurredAt: string;
    readonly durationMinutes: number | null;
    readonly context: string | null;
    readonly participantNames: readonly string[];
  }[];
  readonly shelf: readonly {
    readonly householdId: string;
    readonly workId: string;
    readonly title: string;
    readonly personId: string;
    readonly readerName: string;
    readonly episodeCount: number;
    readonly preferenceScore: number;
    readonly childEngagement: number | null;
    readonly adultTolerance: number | null;
    readonly asksByName: boolean;
    readonly veto: boolean;
    readonly estimatedReadMinutes: number | null;
    readonly traits: readonly ReadingTrait[];
  }[];
}

export async function saveReadingSession(
  database: Database,
  input: {
    readonly id: string;
    readonly householdId: string;
    readonly workId: string;
    readonly participantIds: readonly string[];
    readonly occurredAt: string;
    readonly durationMinutes?: number;
    readonly context?: 'bedtime' | 'daytime' | 'travel' | 'school' | 'other';
    readonly note?: string;
    readonly createdAt: string;
  },
): Promise<void> {
  if (input.participantIds.length === 0)
    throw new Error('A confirmed reading session needs at least one participant');
  await inTransaction(database, async () => {
    await database.run(
      `INSERT INTO reading_sessions (id, household_id, work_id, occurred_at, duration_minutes, context, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.householdId,
        input.workId,
        input.occurredAt,
        input.durationMinutes ?? null,
        input.context ?? null,
        input.note ?? null,
        input.createdAt,
      ],
    );
    for (const personId of [...new Set(input.participantIds)])
      await database.run(
        'INSERT INTO reading_session_participants (reading_session_id, person_id) VALUES (?, ?)',
        [input.id, personId],
      );
  });
}

export async function saveWorkAssessment(
  database: Database,
  input: {
    readonly workId: string;
    readonly personId: string;
    readonly childEngagement?: number;
    readonly adultTolerance?: number;
    readonly asksByName?: boolean;
    readonly veto?: boolean;
    readonly estimatedReadMinutes?: number;
    readonly traits?: readonly ReadingTrait[];
    readonly note?: string;
    readonly updatedAt: string;
  },
): Promise<void> {
  const traits = [...new Set(input.traits ?? [])];
  if (traits.some((trait) => !READING_TRAITS.includes(trait)))
    throw new Error('Assessment contains an unsupported trait');
  await database.run(
    `INSERT INTO work_assessments (work_id, person_id, child_engagement, adult_tolerance, asks_by_name, veto, estimated_read_minutes, traits_json, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (work_id, person_id) DO UPDATE SET child_engagement = excluded.child_engagement,
       adult_tolerance = excluded.adult_tolerance, asks_by_name = excluded.asks_by_name,
       veto = excluded.veto, estimated_read_minutes = excluded.estimated_read_minutes,
       traits_json = excluded.traits_json, note = excluded.note, updated_at = excluded.updated_at`,
    [
      input.workId,
      input.personId,
      input.childEngagement ?? null,
      input.adultTolerance ?? null,
      input.asksByName ? 1 : 0,
      input.veto ? 1 : 0,
      input.estimatedReadMinutes ?? null,
      JSON.stringify(traits),
      input.note ?? null,
      input.updatedAt,
    ],
  );
}

export async function getReadingModel(database: Database): Promise<ReadingModelView> {
  const checkoutRows = await database.query<{
    id: string;
    title: string;
    work_id: string;
    occurred_at: string;
    reader_names: string | null;
  }>(
    `SELECT r.id, r.title, e.work_id, r.occurred_at, group_concat(p.display_name, '|||') AS reader_names
     FROM import_records r JOIN resolution_cases c ON c.import_record_id = r.id
     JOIN resolution_decisions d ON d.resolution_case_id = c.id AND d.current = 1
     JOIN editions e ON e.id = d.edition_id JOIN attribution_results a ON a.import_record_id = r.id AND a.current = 1 AND a.state = 'assigned'
     LEFT JOIN attribution_result_readers ar ON ar.attribution_result_id = a.id LEFT JOIN people p ON p.id = ar.person_id
     GROUP BY r.id ORDER BY r.occurred_at DESC, r.id`,
  );
  const episodeRows = await database.query<{
    id: string;
    title: string;
    work_id: string;
    person_id: string;
    reader_name: string;
    window_start: string;
    window_end: string;
    recurrence_kind: string;
    checkout_count: number;
    preference_weight: number;
  }>(
    `SELECT a.id, w.canonical_title AS title, a.work_id, a.person_id, p.display_name AS reader_name, a.window_start, a.window_end, a.recurrence_kind, a.checkout_count, a.preference_weight FROM acquisition_episodes a JOIN works w ON w.id = a.work_id JOIN people p ON p.id = a.person_id ORDER BY a.window_start DESC, a.id`,
  );
  const sessionRows = await database.query<{
    id: string;
    title: string;
    work_id: string;
    occurred_at: string;
    duration_minutes: number | null;
    context: string | null;
    participant_names: string | null;
  }>(
    `SELECT s.id, w.canonical_title AS title, s.work_id, s.occurred_at, s.duration_minutes, s.context, group_concat(p.display_name, '|||') AS participant_names FROM reading_sessions s JOIN works w ON w.id = s.work_id LEFT JOIN reading_session_participants sp ON sp.reading_session_id = s.id LEFT JOIN people p ON p.id = sp.person_id GROUP BY s.id ORDER BY s.occurred_at DESC, s.id`,
  );
  const shelfRows = await database.query<{
    household_id: string;
    work_id: string;
    title: string;
    person_id: string;
    reader_name: string;
    episode_count: number;
    preference_score: number;
    child_engagement: number | null;
    adult_tolerance: number | null;
    asks_by_name: number | null;
    veto: number | null;
    estimated_read_minutes: number | null;
    traits_json: string | null;
  }>(
    `SELECT p.household_id, s.work_id, w.canonical_title AS title, s.person_id, p.display_name AS reader_name, s.episode_count, s.preference_score, a.child_engagement, a.adult_tolerance, a.asks_by_name, a.veto, a.estimated_read_minutes, a.traits_json FROM preference_summaries s JOIN works w ON w.id = s.work_id JOIN people p ON p.id = s.person_id LEFT JOIN work_assessments a ON a.work_id = s.work_id AND a.person_id = s.person_id ORDER BY s.preference_score DESC, w.canonical_title`,
  );
  return {
    checkouts: checkoutRows.map((row) => ({
      id: row.id,
      title: row.title,
      workId: row.work_id,
      occurredAt: row.occurred_at,
      readers: splitNames(row.reader_names),
    })),
    episodes: episodeRows.map((row) => ({
      id: row.id,
      title: row.title,
      workId: row.work_id,
      personId: row.person_id,
      readerName: row.reader_name,
      windowStart: row.window_start,
      windowEnd: row.window_end,
      recurrenceKind: row.recurrence_kind,
      checkoutCount: row.checkout_count,
      preferenceWeight: row.preference_weight,
    })),
    sessions: sessionRows.map((row) => ({
      id: row.id,
      title: row.title,
      workId: row.work_id,
      occurredAt: row.occurred_at,
      durationMinutes: row.duration_minutes,
      context: row.context,
      participantNames: splitNames(row.participant_names),
    })),
    shelf: shelfRows.map((row) => ({
      householdId: row.household_id,
      workId: row.work_id,
      title: row.title,
      personId: row.person_id,
      readerName: row.reader_name,
      episodeCount: row.episode_count,
      preferenceScore: row.preference_score,
      childEngagement: row.child_engagement,
      adultTolerance: row.adult_tolerance,
      asksByName: row.asks_by_name === 1,
      veto: row.veto === 1,
      estimatedReadMinutes: row.estimated_read_minutes,
      traits: JSON.parse(row.traits_json ?? '[]') as ReadingTrait[],
    })),
  };
}

function splitNames(value: string | null): readonly string[] {
  return value ? value.split('|||') : [];
}
