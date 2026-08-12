import type { Database } from './database.js';

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: 'foundation',
    sql: `
      CREATE TABLE households (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE app_metadata (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      ) STRICT;
    `,
  },
  {
    version: 2,
    name: 'import_inbox',
    sql: `
      CREATE TABLE people (
        id TEXT PRIMARY KEY NOT NULL,
        household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
        display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE reader_profiles (
        person_id TEXT PRIMARY KEY NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('child', 'adult')),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE library_cards (
        id TEXT PRIMARY KEY NOT NULL,
        household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
        label TEXT NOT NULL CHECK (length(trim(label)) > 0),
        library_system TEXT NOT NULL,
        owner_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
        exclusive INTEGER NOT NULL DEFAULT 0 CHECK (exclusive IN (0, 1)),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE source_accounts (
        id TEXT PRIMARY KEY NOT NULL,
        household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('libby', 'bibliocommons', 'csv', 'manual')),
        label TEXT NOT NULL CHECK (length(trim(label)) > 0),
        card_id TEXT REFERENCES library_cards(id) ON DELETE SET NULL,
        retention_horizon TEXT,
        config_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE import_blobs (
        id TEXT PRIMARY KEY NOT NULL,
        source_account_id TEXT NOT NULL REFERENCES source_accounts(id) ON DELETE CASCADE,
        sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
        file_name TEXT,
        media_type TEXT NOT NULL,
        content_text TEXT NOT NULL,
        byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
        created_at TEXT NOT NULL,
        UNIQUE (source_account_id, sha256)
      ) STRICT;

      CREATE TABLE import_runs (
        id TEXT PRIMARY KEY NOT NULL,
        source_account_id TEXT NOT NULL REFERENCES source_accounts(id) ON DELETE CASCADE,
        import_blob_id TEXT NOT NULL REFERENCES import_blobs(id),
        status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
        rows_seen INTEGER NOT NULL CHECK (rows_seen >= 0),
        rows_new INTEGER NOT NULL CHECK (rows_new >= 0),
        rows_ignored INTEGER NOT NULL CHECK (rows_ignored >= 0),
        file_name TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL,
        note TEXT
      ) STRICT;

      CREATE TABLE import_records (
        id TEXT PRIMARY KEY NOT NULL,
        source_account_id TEXT NOT NULL REFERENCES source_accounts(id) ON DELETE CASCADE,
        first_import_run_id TEXT NOT NULL REFERENCES import_runs(id),
        source_key TEXT NOT NULL,
        normalization_version INTEGER NOT NULL CHECK (normalization_version > 0),
        raw_payload_json TEXT NOT NULL,
        title TEXT NOT NULL CHECK (length(trim(title)) > 0),
        subtitle TEXT,
        authors_json TEXT NOT NULL,
        source_format TEXT,
        isbn TEXT,
        edition_identifier_namespace TEXT,
        edition_identifier_value TEXT,
        call_number TEXT,
        occurred_at TEXT NOT NULL,
        details TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (source_account_id, source_key)
      ) STRICT;

      CREATE INDEX import_records_inbox_order
        ON import_records (source_account_id, occurred_at DESC, id);
    `,
  },
];

export async function migrate(database: Database): Promise<void> {
  await database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  const applied = await database.query<{ version: number }>(
    'SELECT version FROM schema_migrations ORDER BY version',
  );
  const appliedVersions = new Set(applied.map(({ version }) => version));

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue;

    const safeName = migration.name.replaceAll("'", "''");
    const appliedAt = new Date().toISOString();
    try {
      await database.exec(`
        BEGIN IMMEDIATE;
        ${migration.sql}
        INSERT INTO schema_migrations (version, name, applied_at)
        VALUES (${migration.version}, '${safeName}', '${appliedAt}');
        COMMIT;
      `);
    } catch (error) {
      await database.exec('ROLLBACK');
      throw error;
    }
  }
}
