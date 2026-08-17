import { LAST_BACKUP_AT, setAppMetadata } from '@read-it-again/storage-schema';
import type { Database, SqlValue } from '@read-it-again/storage-schema';

const ARCHIVE_TABLES = [
  'households',
  'app_metadata',
  'people',
  'reader_profiles',
  'library_cards',
  'source_accounts',
  'import_blobs',
  'import_runs',
  'import_records',
  'works',
  'editions',
  'external_identifiers',
  'resolution_cases',
  'resolution_candidates',
  'resolution_decisions',
  'resolution_cache',
  'identity_operations',
  'catalog_http_cache',
  'attribution_decisions',
  'acquisition_failures',
  'metadata_facts',
  'attribution_results',
  'attribution_result_readers',
  'attribution_evidence',
  'attribution_overrides',
  'attribution_override_readers',
  'derived_rebuilds',
  'reading_model_config',
  'acquisition_episodes',
  'acquisition_episode_checkouts',
  'reading_sessions',
  'reading_session_participants',
  'work_assessments',
  'preference_summaries',
  'recommendation_runs',
  'recommendation_items',
  'holdings_cache',
  'recommendation_item_holdings',
  'cover_images',
] as const;

/**
 * Cover bytes are the first binary column in the archive, and the payload is JSON.
 * A Uint8Array would stringify to {"0":137,"1":80,...}: bloated, and it parses back
 * as a plain object rather than bytes. Binary values are therefore wrapped in a
 * tagged object and base64-encoded, which is what makes this a v2 payload.
 *
 * v1 archives contain no binary columns at all, so they still import unchanged —
 * a household that backed up before covers existed can still restore.
 */
interface EncodedBytes {
  readonly $bytes: string;
}

function isEncodedBytes(value: unknown): value is EncodedBytes {
  return isObject(value) && typeof (value as { $bytes?: unknown }).$bytes === 'string';
}

function encodeRow(
  row: Readonly<Record<string, SqlValue>>,
): Readonly<Record<string, SqlValue | EncodedBytes>> {
  const output: Record<string, SqlValue | EncodedBytes> = {};
  for (const [column, value] of Object.entries(row)) {
    output[column] = value instanceof Uint8Array ? { $bytes: base64(value) } : value;
  }
  return output;
}

function decodeValue(value: SqlValue | EncodedBytes | undefined): SqlValue {
  if (value === undefined) return null;
  if (isEncodedBytes(value)) return fromBase64(value.$bytes);
  return value;
}

const PAYLOAD_FORMATS = ['read-it-again-logical-v1', 'read-it-again-logical-v2'] as const;

interface ArchivePayload {
  readonly format: (typeof PAYLOAD_FORMATS)[number];
  readonly schemaVersion: number;
  readonly exportedAt: string;
  readonly tables: Readonly<
    Record<string, readonly Readonly<Record<string, SqlValue | EncodedBytes>>[]>
  >;
}

interface EncryptedEnvelope {
  readonly format: 'read-it-again-encrypted-v1';
  readonly kdf: {
    readonly name: 'PBKDF2';
    readonly hash: 'SHA-256';
    readonly iterations: 250000;
    readonly salt: string;
  };
  readonly cipher: { readonly name: 'AES-GCM'; readonly iv: string; readonly ciphertext: string };
}

export async function exportEncryptedArchive(
  database: Database,
  passphrase: string,
  now: () => Date = () => new Date(),
): Promise<string> {
  validatePassphrase(passphrase);
  const exportedAt = now().toISOString();
  // Recorded before the snapshot is taken so the archive carries the moment it was
  // made. A device restored from it then reports an accurate last backup rather
  // than the one before this. Passphrase validation is the only realistic failure
  // and it has already happened.
  await setAppMetadata(database, LAST_BACKUP_AT, exportedAt);
  const migrations = await database.query<{ version: number }>(
    'SELECT max(version) AS version FROM schema_migrations',
  );
  const tables: Record<string, readonly Readonly<Record<string, SqlValue | EncodedBytes>>[]> = {};
  for (const table of ARCHIVE_TABLES) {
    const rows = await database.query<Record<string, SqlValue>>(`SELECT * FROM ${table}`);
    tables[table] = rows.map(encodeRow);
  }
  const payload: ArchivePayload = {
    format: 'read-it-again-logical-v2',
    schemaVersion: migrations[0]?.version ?? 0,
    exportedAt,
    tables,
  };
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, ['encrypt']);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const envelope: EncryptedEnvelope = {
    format: 'read-it-again-encrypted-v1',
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 250000, salt: base64(salt) },
    cipher: { name: 'AES-GCM', iv: base64(iv), ciphertext: base64(new Uint8Array(encrypted)) },
  };
  return JSON.stringify(envelope);
}

export async function importEncryptedArchive(
  database: Database,
  encryptedText: string,
  passphrase: string,
): Promise<{ readonly exportedAt: string; readonly rowCount: number }> {
  validatePassphrase(passphrase);
  const envelope = parseEnvelope(encryptedText);
  let decrypted: ArrayBuffer;
  try {
    const key = await deriveKey(passphrase, fromBase64(envelope.kdf.salt), ['decrypt']);
    decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytesBuffer(fromBase64(envelope.cipher.iv)) },
      key,
      bytesBuffer(fromBase64(envelope.cipher.ciphertext)),
    );
  } catch {
    throw new Error('Archive could not be decrypted. Check the passphrase and file.');
  }
  const payload = parsePayload(new TextDecoder().decode(decrypted));
  const current = await database.query<{ version: number }>(
    'SELECT max(version) AS version FROM schema_migrations',
  );
  if (payload.schemaVersion > (current[0]?.version ?? 0))
    throw new Error('Archive was created by a newer app version');
  await database.exec('BEGIN IMMEDIATE');
  try {
    for (const table of [...ARCHIVE_TABLES].reverse()) await database.run(`DELETE FROM ${table}`);
    let rowCount = 0;
    for (const table of ARCHIVE_TABLES) {
      const allowedColumns = new Set(
        (await database.query<{ name: string }>(`PRAGMA table_info(${table})`)).map(
          ({ name }) => name,
        ),
      );
      const rows = payload.tables[table] ?? [];
      for (const row of rows) {
        const columns = Object.keys(row);
        if (columns.length === 0) continue;
        if (columns.some((column) => !allowedColumns.has(column)))
          throw new Error('Archive contains an invalid column');
        await database.run(
          `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
          columns.map((column) => decodeValue(row[column])),
        );
        rowCount += 1;
      }
    }
    await database.exec('COMMIT');
    return { exportedAt: payload.exportedAt, rowCount };
  } catch (error) {
    await database.exec('ROLLBACK');
    throw error;
  }
}

function parseEnvelope(value: string): EncryptedEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error('Archive is not valid JSON');
  }
  if (
    !isObject(parsed) ||
    parsed.format !== 'read-it-again-encrypted-v1' ||
    !isObject(parsed.kdf) ||
    !isObject(parsed.cipher) ||
    parsed.kdf.iterations !== 250000 ||
    typeof parsed.kdf.salt !== 'string' ||
    typeof parsed.cipher.iv !== 'string' ||
    typeof parsed.cipher.ciphertext !== 'string'
  )
    throw new Error('Archive envelope is invalid');
  return parsed as unknown as EncryptedEnvelope;
}

function parsePayload(value: string): ArchivePayload {
  const parsed = JSON.parse(value) as unknown;
  if (
    !isObject(parsed) ||
    !(PAYLOAD_FORMATS as readonly unknown[]).includes(parsed.format) ||
    typeof parsed.schemaVersion !== 'number' ||
    typeof parsed.exportedAt !== 'string' ||
    !isObject(parsed.tables)
  )
    throw new Error('Archive payload is invalid');
  for (const table of Object.keys(parsed.tables))
    if (!(ARCHIVE_TABLES as readonly string[]).includes(table))
      throw new Error(`Archive contains unsupported table ${table}`);
  return parsed as unknown as ArchivePayload;
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  usages: readonly KeyUsage[],
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: bytesBuffer(salt), iterations: 250000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    usages,
  );
}
function validatePassphrase(value: string): void {
  if (value.length < 12) throw new Error('Archive passphrase must be at least 12 characters');
}
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
function bytesBuffer(value: Uint8Array): ArrayBuffer {
  return Uint8Array.from(value).buffer;
}
