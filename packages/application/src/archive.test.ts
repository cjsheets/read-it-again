import { afterEach, describe, expect, it } from 'vitest';
import { NodeSqliteDatabase } from '@read-it-again/storage-node';
import {
  getAppMetadata,
  getCoverImage,
  LAST_BACKUP_AT,
  migrate,
  saveCoverImage,
} from '@read-it-again/storage-schema';
import { exportEncryptedArchive, importEncryptedArchive } from './archive.js';

describe('encrypted bookshelf archives', () => {
  let source: NodeSqliteDatabase | undefined;
  let target: NodeSqliteDatabase | undefined;
  afterEach(async () => {
    await source?.close();
    await target?.close();
  });

  it('round-trips logical data and rejects a wrong passphrase without writes', async () => {
    source = new NodeSqliteDatabase();
    target = new NodeSqliteDatabase();
    await migrate(source);
    await migrate(target);
    await source.run(
      "INSERT INTO households (id, name, created_at) VALUES ('h', 'Private family', '2026-08-13T00:00:00Z')",
    );
    await source.run(
      `INSERT INTO source_accounts
       (id, household_id, kind, label, config_json, created_at)
       VALUES ('source', 'h', 'csv', 'CSV', '{}', '2026-08-13T00:00:00Z')`,
    );
    await source.run(
      `INSERT INTO import_blobs
       (id, source_account_id, sha256, media_type, content_text, byte_length, created_at)
       VALUES ('blob', 'source', ?, 'text/csv', 'title', 5, '2026-08-13T00:00:00Z')`,
      ['a'.repeat(64)],
    );
    const encrypted = await exportEncryptedArchive(
      source,
      'a sufficiently long passphrase',
      () => new Date('2026-08-13T12:00:00Z'),
    );
    expect(encrypted).not.toContain('Private family');
    await expect(importEncryptedArchive(target, encrypted, 'incorrect passphrase')).rejects.toThrow(
      'could not be decrypted',
    );
    expect(await target.query('SELECT * FROM households')).toEqual([]);
    await expect(
      importEncryptedArchive(target, encrypted, 'a sufficiently long passphrase'),
    ).resolves.toMatchObject({ rowCount: 4 });
    expect(await target.query('SELECT name FROM households')).toEqual([{ name: 'Private family' }]);
    expect(await target.query('SELECT sha256 FROM import_blobs')).toEqual([
      { sha256: 'a'.repeat(64) },
    ]);
    // The fourth row: exporting records when the backup was taken, and that fact
    // belongs to the data, so a restored device reports it accurately.
    expect(await getAppMetadata(target, LAST_BACKUP_AT)).toBe('2026-08-13T12:00:00.000Z');
  });

  it('carries cover bytes through the round trip intact', async () => {
    source = new NodeSqliteDatabase();
    target = new NodeSqliteDatabase();
    await migrate(source);
    await migrate(target);
    // A byte sequence that would not survive being treated as text: a PNG header
    // plus a NUL and a high byte.
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 128, 1]);
    await seedWork(source);
    await saveCoverImage(source, {
      workId: 'work',
      bytes,
      mime: 'image/png',
      width: 400,
      height: 600,
      source: 'user_file',
      now: '2026-08-16T00:00:00.000Z',
    });

    const encrypted = await exportEncryptedArchive(source, 'a sufficiently long passphrase');
    await importEncryptedArchive(target, encrypted, 'a sufficiently long passphrase');

    const restored = await getCoverImage(target, 'work');
    expect(restored?.mime).toBe('image/png');
    expect(restored?.width).toBe(400);
    expect(Array.from(restored?.bytes ?? [])).toEqual(Array.from(bytes));
  });

  /**
   * A household that backed up before covers existed must still be able to restore.
   * v1 payloads contain no binary columns, so they need no decoding — but the
   * format check has to admit them, and this is the test that says so.
   */
  it('still imports a v1 archive written before covers existed', async () => {
    target = new NodeSqliteDatabase();
    await migrate(target);
    const legacy = await encryptLegacyPayload({
      format: 'read-it-again-logical-v1',
      schemaVersion: 7,
      exportedAt: '2026-08-13T12:00:00.000Z',
      tables: {
        households: [{ id: 'h', name: 'Older family', created_at: '2026-08-13T00:00:00Z' }],
      },
    });

    await expect(
      importEncryptedArchive(target, legacy, 'a sufficiently long passphrase'),
    ).resolves.toMatchObject({ rowCount: 1 });
    expect(await target.query('SELECT name FROM households')).toEqual([{ name: 'Older family' }]);
  });
});

async function seedWork(database: NodeSqliteDatabase): Promise<void> {
  await database.exec(`
    INSERT INTO works (id, canonical_title, created_at)
      VALUES ('work', 'The Gruffalo', '2026-08-16T00:00:00.000Z');
  `);
}

/** Builds a v1 envelope the way the pre-cover exporter did, so the compatibility
 *  test exercises the real decrypt-and-parse path rather than a stub. */
async function encryptLegacyPayload(payload: unknown): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode('a sufficiently long passphrase'),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 250000 },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...Array.from(bytes)));
  return JSON.stringify({
    format: 'read-it-again-encrypted-v1',
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 250000, salt: encode(salt) },
    cipher: {
      name: 'AES-GCM',
      iv: encode(iv),
      ciphertext: encode(new Uint8Array(ciphertext)),
    },
  });
}
