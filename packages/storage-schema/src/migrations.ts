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
    await database.exec(`
      BEGIN IMMEDIATE;
      ${migration.sql}
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (${migration.version}, '${safeName}', '${appliedAt}');
      COMMIT;
    `);
  }
}
