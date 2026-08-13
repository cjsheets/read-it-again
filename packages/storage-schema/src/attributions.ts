import type { Database } from './database.js';
import { inTransaction } from './database.js';

export interface ExclusiveCardContext {
  readonly householdId: string;
  readonly personId: string;
  readonly cardId: string;
  readonly sourceAccountId: string;
  readonly personName: string;
  readonly cardLabel: string;
}

export interface ReaderShelfItem {
  readonly importRecordId: string;
  readonly workId: string;
  readonly editionId: string;
  readonly title: string;
  readonly occurredAt: string;
  readonly callNumber: string | null;
  readonly confidence: number;
  readonly method: string;
}

export async function ensureExclusiveCardContext(
  database: Database,
  context: ExclusiveCardContext,
  now: string,
): Promise<void> {
  await inTransaction(database, async () => {
    await database.run('INSERT OR IGNORE INTO households (id, name, created_at) VALUES (?, ?, ?)', [
      context.householdId,
      'My Household',
      now,
    ]);
    await database.run(
      `INSERT INTO people (id, household_id, display_name, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET display_name = excluded.display_name`,
      [context.personId, context.householdId, context.personName, now],
    );
    await database.run(
      `INSERT OR IGNORE INTO reader_profiles (person_id, kind, created_at)
       VALUES (?, 'child', ?)`,
      [context.personId, now],
    );
    await database.run(
      `INSERT INTO library_cards
       (id, household_id, label, library_system, owner_person_id, exclusive, created_at)
       VALUES (?, ?, ?, 'kcls', ?, 1, ?)
       ON CONFLICT (id) DO UPDATE SET label = excluded.label,
         owner_person_id = excluded.owner_person_id, exclusive = 1`,
      [context.cardId, context.householdId, context.cardLabel, context.personId, now],
    );
    await database.run(
      `INSERT INTO source_accounts
       (id, household_id, kind, label, card_id, retention_horizon, config_json, created_at)
       VALUES (?, ?, 'bibliocommons', ?, ?, 'rolling:unknown', '{}', ?)
       ON CONFLICT (id) DO UPDATE SET label = excluded.label, card_id = excluded.card_id`,
      [context.sourceAccountId, context.householdId, context.cardLabel, context.cardId, now],
    );
  });
}

export async function applyExclusiveCardAttribution(
  database: Database,
  options: { readonly idFactory?: () => string; readonly now?: string } = {},
): Promise<number> {
  const idFactory = options.idFactory ?? (() => crypto.randomUUID());
  const now = options.now ?? new Date().toISOString();
  const rows = await database.query<{ import_record_id: string; person_id: string }>(
    `SELECT r.id AS import_record_id, c.owner_person_id AS person_id
     FROM import_records r
     JOIN source_accounts s ON s.id = r.source_account_id
     JOIN library_cards c ON c.id = s.card_id
     JOIN resolution_cases rc ON rc.import_record_id = r.id AND rc.status = 'resolved'
     LEFT JOIN attribution_decisions a ON a.import_record_id = r.id AND a.current = 1
     WHERE c.exclusive = 1 AND c.owner_person_id IS NOT NULL AND a.id IS NULL
     ORDER BY r.occurred_at, r.id`,
  );
  await inTransaction(database, async () => {
    for (const row of rows) {
      await database.run(
        `INSERT INTO attribution_decisions
         (id, import_record_id, person_id, method, confidence, current, created_at)
         VALUES (?, ?, ?, 'exclusive_card', 1, 1, ?)`,
        [idFactory(), row.import_record_id, row.person_id, now],
      );
    }
  });
  return rows.length;
}

export async function overrideAttribution(
  database: Database,
  input: {
    readonly id: string;
    readonly importRecordId: string;
    readonly personId: string | null;
    readonly note?: string;
    readonly now: string;
  },
): Promise<void> {
  await inTransaction(database, async () => {
    const current = await database.query<{ id: string }>(
      `SELECT id FROM attribution_decisions WHERE import_record_id = ? AND current = 1`,
      [input.importRecordId],
    );
    await database.run(
      `UPDATE attribution_decisions SET current = 0
       WHERE import_record_id = ? AND current = 1`,
      [input.importRecordId],
    );
    await database.run(
      `INSERT INTO attribution_decisions
       (id, import_record_id, person_id, method, confidence, supersedes_decision_id,
        current, note, created_at)
       VALUES (?, ?, ?, 'override', 1, ?, 1, ?, ?)`,
      [
        input.id,
        input.importRecordId,
        input.personId,
        current[0]?.id ?? null,
        input.note ?? null,
        input.now,
      ],
    );
  });
}

export async function listReaderShelf(
  database: Database,
  personId: string,
): Promise<readonly ReaderShelfItem[]> {
  const rows = await database.query<{
    import_record_id: string;
    work_id: string;
    edition_id: string;
    title: string;
    occurred_at: string;
    call_number: string | null;
    confidence: number;
    method: string;
  }>(
    `SELECT r.id AS import_record_id, e.work_id, d.edition_id, r.title, r.occurred_at,
            r.call_number, a.confidence, a.method
     FROM attribution_decisions a
     JOIN import_records r ON r.id = a.import_record_id
     JOIN resolution_cases c ON c.import_record_id = r.id
     JOIN resolution_decisions d ON d.resolution_case_id = c.id
       AND d.current = 1 AND d.action IN ('accept', 'repoint')
     JOIN editions e ON e.id = d.edition_id
     WHERE a.current = 1 AND a.person_id = ?
     ORDER BY r.occurred_at DESC, r.id`,
    [personId],
  );
  return rows.map((row) => ({
    importRecordId: row.import_record_id,
    workId: row.work_id,
    editionId: row.edition_id,
    title: row.title,
    occurredAt: row.occurred_at,
    callNumber: row.call_number,
    confidence: row.confidence,
    method: row.method,
  }));
}

export async function recordAcquisitionFailure(
  database: Database,
  input: {
    readonly id: string;
    readonly sourceAccountId: string;
    readonly reason: string;
    readonly message: string;
    readonly now: string;
  },
): Promise<void> {
  await database.run(
    `INSERT INTO acquisition_failures
     (id, source_account_id, reason, message, created_at) VALUES (?, ?, ?, ?, ?)`,
    [input.id, input.sourceAccountId, input.reason, input.message, input.now],
  );
}
