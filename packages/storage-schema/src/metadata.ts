import type { CatalogMetadata } from '@read-it-again/domain';
import type { Database } from './database.js';
import { inTransaction } from './database.js';

const PRECEDENCE = {
  human: 500,
  marc: 400,
  openlibrary: 300,
  google: 200,
  hardcover: 100,
} as const;

export async function storeMetadataFacts(
  database: Database,
  input: {
    readonly entityKind: 'work' | 'edition';
    readonly entityId: string;
    readonly source: keyof typeof PRECEDENCE;
    readonly sourceRef: string;
    readonly metadata: CatalogMetadata;
    readonly idFactory: () => string;
    readonly fetchedAt: string;
  },
): Promise<void> {
  const values: Readonly<Record<string, unknown>> = {
    audience: input.metadata.audience,
    juvenileHeading: input.metadata.juvenileHeading,
    subjects: input.metadata.subjects,
    genres: input.metadata.genres,
    contributors: input.metadata.contributors,
    pageCount: input.metadata.pageCount,
    callNumber: input.metadata.callNumber,
    summary: input.metadata.summary,
    series: input.metadata.series,
  };
  await inTransaction(database, async () => {
    for (const [field, value] of Object.entries(values)) {
      if (value === undefined) continue;
      await database.run(
        `INSERT INTO metadata_facts
         (id, entity_kind, entity_id, field, value_json, source, source_ref, precedence, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (entity_kind, entity_id, field, source, source_ref)
         DO UPDATE SET value_json = excluded.value_json, precedence = excluded.precedence,
           fetched_at = excluded.fetched_at`,
        [
          input.idFactory(),
          input.entityKind,
          input.entityId,
          field,
          JSON.stringify(value),
          input.source,
          input.sourceRef,
          PRECEDENCE[input.source],
          input.fetchedAt,
        ],
      );
    }
  });
}

export async function getEffectiveMetadata(
  database: Database,
  entityKind: 'work' | 'edition',
  entityId: string,
): Promise<Partial<CatalogMetadata>> {
  const rows = await database.query<{ field: string; value_json: string }>(
    `SELECT field, value_json FROM (
       SELECT field, value_json, row_number() OVER (
         PARTITION BY field ORDER BY precedence DESC, fetched_at DESC, id DESC
       ) AS rank
       FROM metadata_facts WHERE entity_kind = ? AND entity_id = ?
     ) WHERE rank = 1`,
    [entityKind, entityId],
  );
  return Object.fromEntries(rows.map((row) => [row.field, JSON.parse(row.value_json)]));
}
