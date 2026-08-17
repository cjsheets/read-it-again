import type { Database } from './database.js';

/** A local reader label; a nickname such as "Kid 1" is enough. */
export interface Reader {
  readonly id: string;
  readonly displayName: string;
  readonly kind: 'child' | 'adult';
  readonly archivedAt: string | null;
  /** How many books are currently attributed to this reader. Shown before
   *  archiving so the choice is informed rather than blind. */
  readonly bookCount: number;
}

export async function listReaders(
  database: Database,
  options: { readonly includeArchived?: boolean } = {},
): Promise<readonly Reader[]> {
  const rows = await database.query<{
    id: string;
    display_name: string;
    kind: string;
    archived_at: string | null;
    book_count: number;
  }>(
    `SELECT p.id, p.display_name, r.kind, r.archived_at,
            (SELECT count(*) FROM preference_summaries s WHERE s.person_id = p.id) AS book_count
     FROM people p JOIN reader_profiles r ON r.person_id = p.id
     ${options.includeArchived ? '' : 'WHERE r.archived_at IS NULL'}
     ORDER BY r.archived_at IS NOT NULL, p.created_at, p.id`,
  );
  return rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    kind: row.kind === 'adult' ? 'adult' : 'child',
    archivedAt: row.archived_at,
    bookCount: row.book_count,
  }));
}

export async function createReader(
  database: Database,
  input: {
    readonly id: string;
    readonly householdId: string;
    readonly displayName: string;
    readonly kind?: 'child' | 'adult';
    readonly now: string;
  },
): Promise<void> {
  const displayName = input.displayName.trim();
  if (!displayName) throw new Error('A reader needs a name. Any label works — even “Kid 1”.');
  await database.run(
    'INSERT INTO people (id, household_id, display_name, created_at) VALUES (?, ?, ?, ?)',
    [input.id, input.householdId, displayName, input.now],
  );
  await database.run('INSERT INTO reader_profiles (person_id, kind, created_at) VALUES (?, ?, ?)', [
    input.id,
    input.kind ?? 'child',
    input.now,
  ]);
}

export async function renameReader(
  database: Database,
  personId: string,
  displayName: string,
): Promise<void> {
  const trimmed = displayName.trim();
  if (!trimmed) throw new Error('A reader needs a name. Any label works — even “Kid 1”.');
  await database.run('UPDATE people SET display_name = ? WHERE id = ?', [trimmed, personId]);
}

/**
 * Archiving hides a reader from the switcher and from attribution choices while
 * leaving every result, episode and session that names them intact. A household
 * always keeps at least one active reader, because attribution has to have
 * somewhere to go.
 */
export async function archiveReader(
  database: Database,
  personId: string,
  now: string,
): Promise<void> {
  const active = await listReaders(database);
  if (active.length <= 1) throw new Error('A household needs at least one reader.');
  await database.run('UPDATE reader_profiles SET archived_at = ? WHERE person_id = ?', [
    now,
    personId,
  ]);
}

export async function restoreReader(database: Database, personId: string): Promise<void> {
  await database.run('UPDATE reader_profiles SET archived_at = NULL WHERE person_id = ?', [
    personId,
  ]);
}
