import {
  clusterAcquisitionEpisodes,
  preferenceScore,
  type EpisodeThresholds,
} from '@read-it-again/domain';
import {
  getReadingModel,
  inTransaction,
  saveReadingSession,
  saveWorkAssessment,
  updateReadingSession,
  type Database,
  type ReadingModelView,
  type ReadingTrait,
} from '@read-it-again/storage-schema';

export async function rebuildReadingModel(
  database: Database,
  options: {
    readonly idFactory?: () => string;
    readonly now?: () => Date;
    readonly thresholds?: EpisodeThresholds;
  } = {},
): Promise<ReadingModelView> {
  await rebuildReadingModelProjection(database, undefined, options);
  return getReadingModel(database);
}

export async function rebuildReadingModelForWorks(
  database: Database,
  workIds: readonly string[],
  options: {
    readonly idFactory?: () => string;
    readonly now?: () => Date;
    readonly thresholds?: EpisodeThresholds;
  } = {},
): Promise<void> {
  if (workIds.length === 0) return;
  await rebuildReadingModelProjection(database, workIds, options);
}

async function rebuildReadingModelProjection(
  database: Database,
  workIds: readonly string[] | undefined,
  options: {
    readonly idFactory?: () => string;
    readonly now?: () => Date;
    readonly thresholds?: EpisodeThresholds;
  },
): Promise<void> {
  const idFactory = options.idFactory ?? (() => crypto.randomUUID());
  const now = (options.now ?? (() => new Date()))().toISOString();
  const households = await database.query<{
    id: string;
    merge_days: number | null;
    strong_repeat_days: number | null;
  }>(
    `SELECT h.id, c.merge_days, c.strong_repeat_days FROM households h LEFT JOIN reading_model_config c ON c.household_id = h.id ORDER BY h.id`,
  );
  // Routed through inTransaction so this can nest inside a bulk import pass,
  // which is what lets a 1000-row import commit once instead of per row.
  await inTransaction(database, async () => {
    if (workIds) {
      const placeholders = workIds.map(() => '?').join(', ');
      await database.run(
        `DELETE FROM acquisition_episode_checkouts WHERE acquisition_episode_id IN
         (SELECT id FROM acquisition_episodes WHERE work_id IN (${placeholders}))`,
        [...workIds],
      );
      await database.run(`DELETE FROM acquisition_episodes WHERE work_id IN (${placeholders})`, [
        ...workIds,
      ]);
      await database.run(`DELETE FROM preference_summaries WHERE work_id IN (${placeholders})`, [
        ...workIds,
      ]);
    } else {
      await database.run('DELETE FROM acquisition_episode_checkouts');
      await database.run('DELETE FROM acquisition_episodes');
      await database.run('DELETE FROM preference_summaries');
    }
    for (const household of households) {
      const thresholds = options.thresholds ?? {
        mergeDays: household.merge_days ?? 7,
        strongRepeatDays: household.strong_repeat_days ?? 90,
      };
      await database.run(
        `INSERT INTO reading_model_config (household_id, merge_days, strong_repeat_days, algorithm_version, updated_at) VALUES (?, ?, ?, 'episodes-v1', ?)
         ON CONFLICT (household_id) DO UPDATE SET merge_days = excluded.merge_days, strong_repeat_days = excluded.strong_repeat_days, algorithm_version = excluded.algorithm_version, updated_at = excluded.updated_at`,
        [household.id, thresholds.mergeDays, thresholds.strongRepeatDays, now],
      );
      const workFilter = workIds ? ` AND e.work_id IN (${workIds.map(() => '?').join(', ')})` : '';
      const groups = await database.query<{ work_id: string; person_id: string }>(
        `SELECT DISTINCT e.work_id, ar.person_id FROM import_records r JOIN source_accounts s ON s.id = r.source_account_id JOIN resolution_cases c ON c.import_record_id = r.id JOIN resolution_decisions d ON d.resolution_case_id = c.id AND d.current = 1 JOIN editions e ON e.id = d.edition_id JOIN attribution_results a ON a.import_record_id = r.id AND a.current = 1 AND a.state = 'assigned' JOIN attribution_result_readers ar ON ar.attribution_result_id = a.id WHERE s.household_id = ?${workFilter} ORDER BY e.work_id, ar.person_id`,
        workIds ? [household.id, ...workIds] : [household.id],
      );
      for (const group of groups) {
        const checkouts = await database.query<{ import_record_id: string; occurred_at: string }>(
          `SELECT r.id AS import_record_id, r.occurred_at FROM import_records r JOIN resolution_cases c ON c.import_record_id = r.id JOIN resolution_decisions d ON d.resolution_case_id = c.id AND d.current = 1 JOIN editions e ON e.id = d.edition_id JOIN attribution_results a ON a.import_record_id = r.id AND a.current = 1 AND a.state = 'assigned' JOIN attribution_result_readers ar ON ar.attribution_result_id = a.id WHERE e.work_id = ? AND ar.person_id = ? ORDER BY r.occurred_at, r.id`,
          [group.work_id, group.person_id],
        );
        const drafts = clusterAcquisitionEpisodes(
          checkouts.map((row) => ({
            importRecordId: row.import_record_id,
            occurredAt: row.occurred_at,
          })),
          thresholds,
        );
        for (const draft of drafts) {
          const episodeId = idFactory();
          await database.run(
            `INSERT INTO acquisition_episodes (id, household_id, work_id, person_id, window_start, window_end, recurrence_kind, checkout_count, preference_weight, algorithm_version, rebuilt_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'episodes-v1', ?)`,
            [
              episodeId,
              household.id,
              group.work_id,
              group.person_id,
              draft.windowStart,
              draft.windowEnd,
              draft.recurrenceKind,
              draft.checkoutIds.length,
              draft.preferenceWeight,
              now,
            ],
          );
          for (const checkoutId of draft.checkoutIds)
            await database.run(
              'INSERT INTO acquisition_episode_checkouts (acquisition_episode_id, import_record_id) VALUES (?, ?)',
              [episodeId, checkoutId],
            );
        }
        const assessment = (
          await database.query<{
            child_engagement: number | null;
            asks_by_name: number;
            veto: number;
          }>(
            'SELECT child_engagement, asks_by_name, veto FROM work_assessments WHERE work_id = ? AND person_id = ?',
            [group.work_id, group.person_id],
          )
        )[0];
        await database.run(
          `INSERT INTO preference_summaries (work_id, person_id, episode_count, strong_repeat_count, near_repeat_count, preference_score, algorithm_version, rebuilt_at) VALUES (?, ?, ?, ?, ?, ?, 'preference-v1', ?)`,
          [
            group.work_id,
            group.person_id,
            drafts.length,
            drafts.filter(({ recurrenceKind }) => recurrenceKind === 'strong_repeat').length,
            drafts.filter(({ recurrenceKind }) => recurrenceKind === 'near_repeat').length,
            preferenceScore(drafts, {
              childEngagement: assessment?.child_engagement ?? undefined,
              asksByName: assessment?.asks_by_name === 1,
              veto: assessment?.veto === 1,
            }),
            now,
          ],
        );
      }
    }
    if (workIds) {
      const placeholders = workIds.map(() => '?').join(', ');
      await database.run(
        `DELETE FROM derived_rebuilds WHERE work_id IN (${placeholders}) OR import_record_id IN
         (SELECT c.import_record_id FROM resolution_cases c
          JOIN resolution_decisions d ON d.resolution_case_id = c.id AND d.current = 1
          JOIN editions e ON e.id = d.edition_id WHERE e.work_id IN (${placeholders}))`,
        [...workIds, ...workIds],
      );
    } else {
      await database.run('DELETE FROM derived_rebuilds');
    }
  });
}

export async function recordReadingSession(
  database: Database,
  input: {
    readonly householdId: string;
    readonly workId: string;
    readonly participantIds: readonly string[];
    readonly occurredAt?: string;
    readonly durationMinutes?: number;
    readonly context?: 'bedtime' | 'daytime' | 'travel' | 'school' | 'other';
    readonly note?: string;
    readonly idFactory?: () => string;
    readonly now?: () => Date;
  },
): Promise<{ readonly sessionId: string; readonly model: ReadingModelView }> {
  const now = input.now ?? (() => new Date());
  const sessionId = (input.idFactory ?? (() => crypto.randomUUID()))();
  await saveReadingSession(database, {
    ...input,
    id: sessionId,
    occurredAt: input.occurredAt ?? now().toISOString(),
    createdAt: now().toISOString(),
  });
  // Return the ID so the UI can offer an immediate correction.
  return { sessionId, model: await getReadingModel(database) };
}

export async function reviseReadingSession(
  database: Database,
  input: Parameters<typeof updateReadingSession>[1],
): Promise<ReadingModelView> {
  await updateReadingSession(database, input);
  return getReadingModel(database);
}

export async function assessWork(
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
    readonly now?: () => Date;
  },
): Promise<ReadingModelView> {
  await saveWorkAssessment(database, {
    ...input,
    updatedAt: (input.now ?? (() => new Date()))().toISOString(),
  });
  return rebuildReadingModel(database, { now: input.now });
}
