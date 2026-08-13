import type { AttributionAssessment, AttributionState } from '@read-it-again/domain';
import type { Database } from './database.js';
import { inTransaction } from './database.js';

export interface AttributionTriageItem {
  readonly importRecordId: string;
  readonly workId: string;
  readonly title: string;
  readonly occurredAt: string;
  readonly sourceLabel: string;
  readonly explanation: string;
  readonly evidence: readonly { readonly explanation: string; readonly weight: number }[];
  readonly readers: readonly { readonly id: string; readonly displayName: string }[];
}

export async function writeAttributionResult(
  database: Database,
  input: {
    readonly id: string;
    readonly importRecordId: string;
    readonly method:
      'checkout_override' | 'work_override' | 'exclusive_card' | 'evidence_rules' | 'unresolved';
    readonly assessment: AttributionAssessment;
    readonly evidenceIdFactory: () => string;
    readonly now: string;
  },
): Promise<void> {
  await inTransaction(database, async () => {
    const current = await database.query<{ id: string }>(
      'SELECT id FROM attribution_results WHERE import_record_id = ? AND current = 1',
      [input.importRecordId],
    );
    await database.run(
      'UPDATE attribution_results SET current = 0 WHERE import_record_id = ? AND current = 1',
      [input.importRecordId],
    );
    await database.run(
      `INSERT INTO attribution_results
       (id, import_record_id, state, method, confidence, score, explanation,
        algorithm_version, supersedes_result_id, current, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        input.id,
        input.importRecordId,
        input.assessment.state,
        input.method,
        input.assessment.confidence,
        input.assessment.score,
        input.assessment.explanation,
        input.assessment.algorithmVersion,
        current[0]?.id ?? null,
        input.now,
      ],
    );
    for (const personId of input.assessment.readerIds) {
      await database.run(
        'INSERT INTO attribution_result_readers (attribution_result_id, person_id) VALUES (?, ?)',
        [input.id, personId],
      );
    }
    for (const evidence of input.assessment.evidence) {
      await database.run(
        `INSERT INTO attribution_evidence
         (id, attribution_result_id, signal, value, weight, explanation)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          input.evidenceIdFactory(),
          input.id,
          evidence.signal,
          evidence.value,
          evidence.weight,
          evidence.explanation,
        ],
      );
    }
  });
}

export async function saveAttributionOverride(
  database: Database,
  input: {
    readonly id: string;
    readonly scope: 'checkout' | 'work';
    readonly importRecordId?: string;
    readonly workId?: string;
    readonly state: Exclude<AttributionState, 'review'>;
    readonly readerIds: readonly string[];
    readonly note?: string;
    readonly now: string;
  },
): Promise<void> {
  await inTransaction(database, async () => {
    const column = input.scope === 'checkout' ? 'import_record_id' : 'work_id';
    const target = input.scope === 'checkout' ? input.importRecordId : input.workId;
    if (!target) throw new Error(`${input.scope} override requires its target`);
    await database.run(
      `UPDATE attribution_overrides SET current = 0 WHERE scope = ? AND ${column} = ? AND current = 1`,
      [input.scope, target],
    );
    await database.run(
      `INSERT INTO attribution_overrides
       (id, scope, import_record_id, work_id, state, note, current, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        input.id,
        input.scope,
        input.importRecordId ?? null,
        input.workId ?? null,
        input.state,
        input.note ?? null,
        input.now,
      ],
    );
    for (const personId of input.readerIds) {
      await database.run(
        'INSERT INTO attribution_override_readers (override_id, person_id) VALUES (?, ?)',
        [input.id, personId],
      );
    }
    await database.run(
      `INSERT INTO derived_rebuilds (id, reason, work_id, import_record_id, created_at)
       VALUES (?, 'attribution_override', ?, ?, ?)`,
      [input.id + ':rebuild', input.workId ?? null, input.importRecordId ?? null, input.now],
    );
  });
}

export async function listAttributionTriage(
  database: Database,
): Promise<readonly AttributionTriageItem[]> {
  const rows = await database.query<{
    import_record_id: string;
    work_id: string;
    title: string;
    occurred_at: string;
    source_label: string;
    explanation: string;
    result_id: string;
  }>(
    `SELECT r.id AS import_record_id, e.work_id, r.title, r.occurred_at,
            s.label AS source_label, a.explanation, a.id AS result_id
     FROM attribution_results a
     JOIN import_records r ON r.id = a.import_record_id
     JOIN source_accounts s ON s.id = r.source_account_id
     JOIN resolution_cases c ON c.import_record_id = r.id
     JOIN resolution_decisions d ON d.resolution_case_id = c.id AND d.current = 1
     JOIN editions e ON e.id = d.edition_id
     WHERE a.current = 1 AND a.state = 'review'
     ORDER BY r.occurred_at DESC, r.id`,
  );
  const output: AttributionTriageItem[] = [];
  for (const row of rows) {
    const evidence = await database.query<{ explanation: string; weight: number }>(
      'SELECT explanation, weight FROM attribution_evidence WHERE attribution_result_id = ? ORDER BY abs(weight) DESC, id',
      [row.result_id],
    );
    const readers = await database.query<{ id: string; display_name: string }>(
      `SELECT p.id, p.display_name FROM people p
       JOIN reader_profiles profile ON profile.person_id = p.id
       JOIN source_accounts s ON s.household_id = p.household_id
       JOIN import_records r ON r.source_account_id = s.id
       WHERE r.id = ? AND profile.kind = 'child' ORDER BY p.display_name, p.id`,
      [row.import_record_id],
    );
    output.push({
      importRecordId: row.import_record_id,
      workId: row.work_id,
      title: row.title,
      occurredAt: row.occurred_at,
      sourceLabel: row.source_label,
      explanation: row.explanation,
      evidence,
      readers: readers.map((reader) => ({ id: reader.id, displayName: reader.display_name })),
    });
  }
  return output;
}

export async function getOverride(
  database: Database,
  importRecordId: string,
  workId: string,
): Promise<
  | {
      readonly method: 'checkout_override' | 'work_override';
      readonly state: 'assigned' | 'excluded';
      readonly readerIds: readonly string[];
    }
  | undefined
> {
  const rows = await database.query<{
    id: string;
    scope: 'checkout' | 'work';
    state: 'assigned' | 'excluded';
  }>(
    `SELECT id, scope, state FROM attribution_overrides
     WHERE current = 1 AND ((scope = 'checkout' AND import_record_id = ?)
       OR (scope = 'work' AND work_id = ?))
     ORDER BY CASE scope WHEN 'checkout' THEN 0 ELSE 1 END LIMIT 1`,
    [importRecordId, workId],
  );
  const row = rows[0];
  if (!row) return undefined;
  const readers = await database.query<{ person_id: string }>(
    'SELECT person_id FROM attribution_override_readers WHERE override_id = ? ORDER BY person_id',
    [row.id],
  );
  return {
    method: row.scope === 'checkout' ? 'checkout_override' : 'work_override',
    state: row.state,
    readerIds: readers.map(({ person_id }) => person_id),
  };
}
