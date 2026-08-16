import { afterEach, describe, expect, it } from 'vitest';
import { NodeSqliteDatabase } from '@read-it-again/storage-node';
import { migrate } from '@read-it-again/storage-schema';
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
    ).resolves.toMatchObject({ rowCount: 3 });
    expect(await target.query('SELECT name FROM households')).toEqual([{ name: 'Private family' }]);
    expect(await target.query('SELECT sha256 FROM import_blobs')).toEqual([
      { sha256: 'a'.repeat(64) },
    ]);
  });
});
