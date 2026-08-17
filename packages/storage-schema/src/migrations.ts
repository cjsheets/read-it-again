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
  {
    version: 3,
    name: 'resolution_identity',
    sql: `
      CREATE TABLE works (
        id TEXT PRIMARY KEY NOT NULL,
        canonical_title TEXT NOT NULL CHECK (length(trim(canonical_title)) > 0),
        primary_author TEXT,
        created_at TEXT NOT NULL,
        retired_at TEXT
      ) STRICT;

      CREATE TABLE editions (
        id TEXT PRIMARY KEY NOT NULL,
        work_id TEXT NOT NULL REFERENCES works(id),
        title TEXT NOT NULL CHECK (length(trim(title)) > 0),
        subtitle TEXT,
        authors_json TEXT NOT NULL,
        format TEXT,
        published_year INTEGER,
        publisher TEXT,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE external_identifiers (
        id TEXT PRIMARY KEY NOT NULL,
        entity_kind TEXT NOT NULL CHECK (entity_kind IN ('work', 'edition')),
        entity_id TEXT NOT NULL,
        namespace TEXT NOT NULL,
        value TEXT NOT NULL,
        source TEXT NOT NULL,
        confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
        created_at TEXT NOT NULL,
        UNIQUE (namespace, value, entity_kind)
      ) STRICT;

      CREATE TABLE resolution_cases (
        id TEXT PRIMARY KEY NOT NULL,
        import_record_id TEXT NOT NULL UNIQUE REFERENCES import_records(id) ON DELETE CASCADE,
        cache_key TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'resolved', 'rejected', 'deferred')),
        algorithm_version TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX resolution_cases_queue
        ON resolution_cases (status, created_at, id);

      CREATE TABLE resolution_candidates (
        id TEXT PRIMARY KEY NOT NULL,
        resolution_case_id TEXT NOT NULL REFERENCES resolution_cases(id) ON DELETE CASCADE,
        catalog_namespace TEXT NOT NULL,
        catalog_key TEXT NOT NULL,
        rank INTEGER NOT NULL CHECK (rank > 0),
        total_score REAL NOT NULL CHECK (total_score >= 0 AND total_score <= 1),
        margin REAL NOT NULL,
        score_json TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (resolution_case_id, catalog_namespace, catalog_key)
      ) STRICT;

      CREATE TABLE resolution_decisions (
        id TEXT PRIMARY KEY NOT NULL,
        resolution_case_id TEXT NOT NULL REFERENCES resolution_cases(id) ON DELETE CASCADE,
        action TEXT NOT NULL CHECK (action IN ('accept', 'reject', 'defer', 'repoint')),
        edition_id TEXT REFERENCES editions(id),
        candidate_id TEXT REFERENCES resolution_candidates(id),
        method TEXT NOT NULL CHECK (method IN ('cache', 'isbn', 'search', 'human', 'manual')),
        confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
        supersedes_decision_id TEXT REFERENCES resolution_decisions(id),
        current INTEGER NOT NULL DEFAULT 1 CHECK (current IN (0, 1)),
        note TEXT,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE UNIQUE INDEX resolution_decisions_current
        ON resolution_decisions (resolution_case_id)
        WHERE current = 1;

      CREATE TABLE resolution_cache (
        source_kind TEXT NOT NULL,
        cache_key TEXT NOT NULL,
        edition_id TEXT NOT NULL REFERENCES editions(id),
        method TEXT NOT NULL,
        confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
        created_at TEXT NOT NULL,
        PRIMARY KEY (source_kind, cache_key)
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE identity_operations (
        id TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('merge_work', 'split_work', 'repoint_resolution')),
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE catalog_http_cache (
        request_key TEXT PRIMARY KEY NOT NULL,
        status INTEGER NOT NULL,
        content_type TEXT,
        body TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      ) STRICT;
    `,
  },
  {
    version: 4,
    name: 'physical_history_attribution',
    sql: `
      CREATE TABLE attribution_decisions (
        id TEXT PRIMARY KEY NOT NULL,
        import_record_id TEXT NOT NULL REFERENCES import_records(id) ON DELETE CASCADE,
        person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
        method TEXT NOT NULL CHECK (method IN ('exclusive_card', 'override')),
        confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
        supersedes_decision_id TEXT REFERENCES attribution_decisions(id),
        current INTEGER NOT NULL DEFAULT 1 CHECK (current IN (0, 1)),
        note TEXT,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE UNIQUE INDEX attribution_decisions_current
        ON attribution_decisions (import_record_id)
        WHERE current = 1;

      CREATE INDEX attribution_decisions_reader
        ON attribution_decisions (person_id, current, created_at);

      CREATE TABLE acquisition_failures (
        id TEXT PRIMARY KEY NOT NULL,
        source_account_id TEXT NOT NULL REFERENCES source_accounts(id) ON DELETE CASCADE,
        reason TEXT NOT NULL CHECK (reason IN
          ('login-required', 'session-expired', 'selector-contract', 'pagination-incomplete')),
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
    `,
  },
  {
    version: 5,
    name: 'enrichment_attribution_triage',
    sql: `
      CREATE TABLE metadata_facts (
        id TEXT PRIMARY KEY NOT NULL,
        entity_kind TEXT NOT NULL CHECK (entity_kind IN ('work', 'edition')),
        entity_id TEXT NOT NULL,
        field TEXT NOT NULL,
        value_json TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('human', 'marc', 'openlibrary', 'google', 'hardcover')),
        source_ref TEXT NOT NULL,
        precedence INTEGER NOT NULL CHECK (precedence > 0),
        fetched_at TEXT NOT NULL,
        UNIQUE (entity_kind, entity_id, field, source, source_ref)
      ) STRICT;

      CREATE INDEX metadata_facts_effective
        ON metadata_facts (entity_kind, entity_id, field, precedence DESC, fetched_at DESC);

      CREATE TABLE attribution_results (
        id TEXT PRIMARY KEY NOT NULL,
        import_record_id TEXT NOT NULL REFERENCES import_records(id) ON DELETE CASCADE,
        state TEXT NOT NULL CHECK (state IN ('assigned', 'excluded', 'review')),
        method TEXT NOT NULL CHECK (method IN
          ('checkout_override', 'work_override', 'exclusive_card', 'evidence_rules', 'unresolved')),
        confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
        score REAL NOT NULL CHECK (score >= -1 AND score <= 1),
        explanation TEXT NOT NULL,
        algorithm_version TEXT NOT NULL,
        supersedes_result_id TEXT REFERENCES attribution_results(id),
        current INTEGER NOT NULL DEFAULT 1 CHECK (current IN (0, 1)),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE UNIQUE INDEX attribution_results_current
        ON attribution_results (import_record_id) WHERE current = 1;

      CREATE INDEX attribution_results_triage
        ON attribution_results (state, current, created_at);

      CREATE TABLE attribution_result_readers (
        attribution_result_id TEXT NOT NULL REFERENCES attribution_results(id) ON DELETE CASCADE,
        person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        PRIMARY KEY (attribution_result_id, person_id)
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE attribution_evidence (
        id TEXT PRIMARY KEY NOT NULL,
        attribution_result_id TEXT NOT NULL REFERENCES attribution_results(id) ON DELETE CASCADE,
        signal TEXT NOT NULL,
        value TEXT NOT NULL,
        weight REAL NOT NULL CHECK (weight >= -1 AND weight <= 1),
        explanation TEXT NOT NULL
      ) STRICT;

      CREATE TABLE attribution_overrides (
        id TEXT PRIMARY KEY NOT NULL,
        scope TEXT NOT NULL CHECK (scope IN ('checkout', 'work')),
        import_record_id TEXT REFERENCES import_records(id) ON DELETE CASCADE,
        work_id TEXT REFERENCES works(id),
        state TEXT NOT NULL CHECK (state IN ('assigned', 'excluded')),
        note TEXT,
        current INTEGER NOT NULL DEFAULT 1 CHECK (current IN (0, 1)),
        created_at TEXT NOT NULL,
        CHECK ((scope = 'checkout' AND import_record_id IS NOT NULL AND work_id IS NULL) OR
               (scope = 'work' AND work_id IS NOT NULL AND import_record_id IS NULL))
      ) STRICT;

      CREATE UNIQUE INDEX attribution_overrides_checkout_current
        ON attribution_overrides (import_record_id) WHERE scope = 'checkout' AND current = 1;
      CREATE UNIQUE INDEX attribution_overrides_work_current
        ON attribution_overrides (work_id) WHERE scope = 'work' AND current = 1;

      CREATE TABLE attribution_override_readers (
        override_id TEXT NOT NULL REFERENCES attribution_overrides(id) ON DELETE CASCADE,
        person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        PRIMARY KEY (override_id, person_id)
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE derived_rebuilds (
        id TEXT PRIMARY KEY NOT NULL,
        reason TEXT NOT NULL,
        work_id TEXT REFERENCES works(id),
        import_record_id TEXT REFERENCES import_records(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL
      ) STRICT;
    `,
  },
  {
    version: 6,
    name: 'reading_model_and_assessments',
    sql: `
      CREATE TABLE reading_model_config (
        household_id TEXT PRIMARY KEY NOT NULL REFERENCES households(id) ON DELETE CASCADE,
        merge_days INTEGER NOT NULL DEFAULT 7 CHECK (merge_days >= 0),
        strong_repeat_days INTEGER NOT NULL DEFAULT 90 CHECK (strong_repeat_days > merge_days + 1),
        algorithm_version TEXT NOT NULL DEFAULT 'episodes-v1',
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE acquisition_episodes (
        id TEXT PRIMARY KEY NOT NULL,
        household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
        work_id TEXT NOT NULL REFERENCES works(id),
        person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        window_start TEXT NOT NULL,
        window_end TEXT NOT NULL,
        recurrence_kind TEXT NOT NULL CHECK (recurrence_kind IN ('initial', 'near_repeat', 'strong_repeat')),
        checkout_count INTEGER NOT NULL CHECK (checkout_count > 0),
        preference_weight REAL NOT NULL CHECK (preference_weight >= 0),
        algorithm_version TEXT NOT NULL,
        rebuilt_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX acquisition_episodes_reader
        ON acquisition_episodes (person_id, window_start, work_id);

      CREATE TABLE acquisition_episode_checkouts (
        acquisition_episode_id TEXT NOT NULL REFERENCES acquisition_episodes(id) ON DELETE CASCADE,
        import_record_id TEXT NOT NULL REFERENCES import_records(id) ON DELETE CASCADE,
        PRIMARY KEY (acquisition_episode_id, import_record_id)
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE reading_sessions (
        id TEXT PRIMARY KEY NOT NULL,
        household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
        work_id TEXT NOT NULL REFERENCES works(id),
        occurred_at TEXT NOT NULL,
        duration_minutes INTEGER CHECK (duration_minutes > 0 AND duration_minutes <= 1440),
        context TEXT CHECK (context IN ('bedtime', 'daytime', 'travel', 'school', 'other')),
        note TEXT,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE reading_session_participants (
        reading_session_id TEXT NOT NULL REFERENCES reading_sessions(id) ON DELETE CASCADE,
        person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        PRIMARY KEY (reading_session_id, person_id)
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE work_assessments (
        work_id TEXT NOT NULL REFERENCES works(id),
        person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        child_engagement INTEGER CHECK (child_engagement BETWEEN 0 AND 3),
        adult_tolerance INTEGER CHECK (adult_tolerance BETWEEN 0 AND 3),
        asks_by_name INTEGER NOT NULL DEFAULT 0 CHECK (asks_by_name IN (0, 1)),
        veto INTEGER NOT NULL DEFAULT 0 CHECK (veto IN (0, 1)),
        estimated_read_minutes INTEGER CHECK (estimated_read_minutes > 0 AND estimated_read_minutes <= 180),
        traits_json TEXT NOT NULL DEFAULT '[]',
        note TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (work_id, person_id)
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE preference_summaries (
        work_id TEXT NOT NULL REFERENCES works(id),
        person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        episode_count INTEGER NOT NULL CHECK (episode_count >= 0),
        strong_repeat_count INTEGER NOT NULL CHECK (strong_repeat_count >= 0),
        near_repeat_count INTEGER NOT NULL CHECK (near_repeat_count >= 0),
        preference_score REAL NOT NULL CHECK (preference_score >= 0),
        algorithm_version TEXT NOT NULL,
        rebuilt_at TEXT NOT NULL,
        PRIMARY KEY (work_id, person_id)
      ) STRICT, WITHOUT ROWID;
    `,
  },
  {
    version: 7,
    name: 'deterministic_recommendations',
    sql: `
      CREATE TABLE recommendation_runs (
        id TEXT PRIMARY KEY NOT NULL,
        household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
        person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        constraints_json TEXT NOT NULL,
        seed_count INTEGER NOT NULL CHECK (seed_count >= 0),
        candidate_count INTEGER NOT NULL CHECK (candidate_count >= 0),
        algorithm_version TEXT NOT NULL,
        generated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX recommendation_runs_latest
        ON recommendation_runs (person_id, generated_at DESC, id DESC);

      CREATE TABLE recommendation_items (
        id TEXT PRIMARY KEY NOT NULL,
        recommendation_run_id TEXT NOT NULL REFERENCES recommendation_runs(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('discovery', 'read_again')),
        rank INTEGER NOT NULL CHECK (rank > 0),
        catalog_key TEXT NOT NULL,
        work_id TEXT REFERENCES works(id),
        title TEXT NOT NULL,
        authors_json TEXT NOT NULL,
        score REAL NOT NULL,
        evidence_json TEXT NOT NULL,
        components_json TEXT NOT NULL,
        estimated_read_minutes INTEGER CHECK (estimated_read_minutes > 0),
        metadata_json TEXT NOT NULL,
        UNIQUE (recommendation_run_id, kind, rank),
        UNIQUE (recommendation_run_id, kind, catalog_key)
      ) STRICT;

      CREATE TABLE holdings_cache (
        catalog_key TEXT PRIMARY KEY NOT NULL,
        system_available INTEGER NOT NULL CHECK (system_available >= 0),
        system_total INTEGER NOT NULL CHECK (system_total >= 0),
        branches_json TEXT NOT NULL,
        source_url TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE recommendation_item_holdings (
        recommendation_item_id TEXT PRIMARY KEY NOT NULL REFERENCES recommendation_items(id) ON DELETE CASCADE,
        catalog_key TEXT NOT NULL REFERENCES holdings_cache(catalog_key),
        observed_at TEXT NOT NULL
      ) STRICT, WITHOUT ROWID;
    `,
  },
  {
    version: 8,
    name: 'cover_images',
    sql: `
      -- ADR 0013. Covers are bytes this household holds, never a remote URL:
      -- a URL would leak the shelf to whoever serves it, on every render.
      -- One current cover per work; source records where the bytes came from so a
      -- better source can replace a weaker one without guessing.
      CREATE TABLE cover_images (
        work_id TEXT PRIMARY KEY NOT NULL REFERENCES works(id) ON DELETE CASCADE,
        edition_id TEXT REFERENCES editions(id) ON DELETE SET NULL,
        bytes BLOB NOT NULL,
        mime TEXT NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
        width INTEGER NOT NULL CHECK (width > 0),
        height INTEGER NOT NULL CHECK (height > 0),
        byte_length INTEGER NOT NULL CHECK (byte_length > 0),
        source TEXT NOT NULL CHECK (source IN ('user_photo', 'user_file', 'catalog')),
        source_ref TEXT,
        created_at TEXT NOT NULL
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
