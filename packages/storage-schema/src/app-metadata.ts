import type { Database } from './database.js';

/**
 * Small key/value facts about this household's data rather than about its books.
 * `app_metadata` travels inside the encrypted archive, so anything stored here
 * follows the data to a new device. That is right for "when was this last backed
 * up" and wrong for device-local facts like whether *this* browser granted
 * persistent storage, which is queried live from the Storage API instead.
 */
export const LAST_BACKUP_AT = 'last_backup_at';

export async function getAppMetadata(database: Database, key: string): Promise<string | undefined> {
  const rows = await database.query<{ value: string }>(
    'SELECT value FROM app_metadata WHERE key = ?',
    [key],
  );
  return rows[0]?.value;
}

export async function setAppMetadata(
  database: Database,
  key: string,
  value: string,
): Promise<void> {
  await database.run(
    `INSERT INTO app_metadata (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}
