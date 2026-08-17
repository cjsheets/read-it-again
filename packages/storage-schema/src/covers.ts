import type { Database } from './database.js';
import { inTransaction } from './database.js';
import { isbnVariants, isValidIsbn } from '@read-it-again/domain';

/**
 * ADR 0013. Cover bytes live in this household's own database. Storing a remote
 * URL instead would mean every render of the shelf tells whoever serves that URL
 * which books this family owns — a per-scroll leak of exactly the data the product
 * exists to keep private.
 */
export type CoverSource = 'user_photo' | 'user_file' | 'catalog';

export interface CoverImage {
  readonly workId: string;
  readonly editionId: string | null;
  readonly bytes: Uint8Array;
  readonly mime: string;
  readonly width: number;
  readonly height: number;
  readonly source: CoverSource;
}

/** Storage limits for OPFS and encrypted archive growth. */
export const MAX_COVER_BYTES = 60_000;
export const MAX_COVER_WIDTH = 400;
export const MAX_COVER_HEIGHT = 600;

export async function saveCoverImage(
  database: Database,
  input: {
    readonly workId: string;
    readonly editionId?: string | null;
    readonly bytes: Uint8Array;
    readonly mime: string;
    readonly width: number;
    readonly height: number;
    readonly source: CoverSource;
    readonly sourceRef?: string | null;
    readonly now: string;
  },
): Promise<void> {
  if (input.bytes.byteLength === 0) throw new Error('Cover image is empty');
  if (input.bytes.byteLength > MAX_COVER_BYTES)
    throw new Error(
      `Cover image is ${input.bytes.byteLength} bytes, over the ${MAX_COVER_BYTES} byte cap`,
    );
  await database.run(
    `INSERT INTO cover_images
       (work_id, edition_id, bytes, mime, width, height, byte_length, source, source_ref, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (work_id) DO UPDATE SET
       edition_id = excluded.edition_id, bytes = excluded.bytes, mime = excluded.mime,
       width = excluded.width, height = excluded.height, byte_length = excluded.byte_length,
       source = excluded.source, source_ref = excluded.source_ref, created_at = excluded.created_at`,
    [
      input.workId,
      input.editionId ?? null,
      input.bytes,
      input.mime,
      input.width,
      input.height,
      input.bytes.byteLength,
      input.source,
      input.sourceRef ?? null,
      input.now,
    ],
  );
}

export async function getCoverImage(
  database: Database,
  workId: string,
): Promise<CoverImage | undefined> {
  const rows = await database.query<{
    work_id: string;
    edition_id: string | null;
    bytes: Uint8Array;
    mime: string;
    width: number;
    height: number;
    source: string;
  }>(
    `SELECT work_id, edition_id, bytes, mime, width, height, source
     FROM cover_images WHERE work_id = ?`,
    [workId],
  );
  const row = rows[0];
  if (!row) return undefined;
  return {
    workId: row.work_id,
    editionId: row.edition_id,
    bytes: row.bytes,
    mime: row.mime,
    width: row.width,
    height: row.height,
    source: row.source as CoverSource,
  };
}

export async function deleteCoverImage(database: Database, workId: string): Promise<void> {
  await database.run('DELETE FROM cover_images WHERE work_id = ?', [workId]);
}

/** Which works have a stored cover. The shelf needs this for every visible book at
 *  once, and must not pull the bytes to answer it. */
export async function listWorkIdsWithCovers(database: Database): Promise<readonly string[]> {
  const rows = await database.query<{ work_id: string }>('SELECT work_id FROM cover_images');
  return rows.map(({ work_id }) => work_id);
}

/**
 * ISBNs that can identify a cover for this work, regardless of how the book was
 * added. Imports retain the identifier they arrived with; catalog resolutions
 * also retain the accepted candidate snapshot. Keeping this query at the work
 * boundary means CSV, Libby, typed ISBNs, and scanned ISBNs all use one cover
 * path rather than growing source-specific UI behavior.
 */
export async function listCoverIsbns(
  database: Database,
  workId: string,
): Promise<readonly string[]> {
  const rows = await database.query<{ isbn: string | null; snapshot_json: string | null }>(
    `SELECT ir.isbn, candidate.snapshot_json
       FROM import_records ir
       JOIN resolution_cases rc ON rc.import_record_id = ir.id
       JOIN resolution_decisions rd ON rd.resolution_case_id = rc.id AND rd.current = 1
       JOIN editions ed ON ed.id = rd.edition_id
       LEFT JOIN resolution_candidates candidate ON candidate.id = rd.candidate_id
      WHERE ed.work_id = ?
      ORDER BY ir.occurred_at DESC, ir.id`,
    [workId],
  );
  const values: string[] = [];
  for (const row of rows) {
    if (row.isbn) values.push(row.isbn);
    if (!row.snapshot_json) continue;
    try {
      const snapshot = JSON.parse(row.snapshot_json) as { readonly isbns?: unknown };
      if (Array.isArray(snapshot.isbns)) {
        values.push(
          ...snapshot.isbns.filter((value): value is string => typeof value === 'string'),
        );
      }
    } catch {
      // A malformed historical snapshot must not prevent a source ISBN from
      // finding a cover. Resolution validation owns the snapshot itself.
    }
  }
  return [
    ...new Set(values.flatMap((value) => isbnVariants(value)).filter((isbn) => isValidIsbn(isbn))),
  ];
}

export interface CatalogCoverFetch {
  readonly workId: string;
  readonly isbn: string;
}

/** Adds every identifiable, uncovered work to the persistent queue. Re-running
 * this is cheap and idempotent; a newly discovered ISBN reopens a previous miss. */
export async function enqueueMissingCatalogCovers(
  database: Database,
  now: string,
): Promise<number> {
  const rows = await database.query<{
    work_id: string;
    isbn: string | null;
    snapshot_json: string | null;
    queued_isbn: string | null;
  }>(
    `SELECT w.id AS work_id, ir.isbn, candidate.snapshot_json,
            queued.isbn AS queued_isbn
       FROM works w
       JOIN editions ed ON ed.work_id = w.id
       JOIN resolution_decisions rd ON rd.edition_id = ed.id AND rd.current = 1
       JOIN resolution_cases rc ON rc.id = rd.resolution_case_id
       JOIN import_records ir ON ir.id = rc.import_record_id
       LEFT JOIN resolution_candidates candidate ON candidate.id = rd.candidate_id
       LEFT JOIN cover_images cover ON cover.work_id = w.id
       LEFT JOIN catalog_cover_fetches queued ON queued.work_id = w.id
      WHERE w.retired_at IS NULL AND cover.work_id IS NULL
      ORDER BY w.created_at, w.id, ir.occurred_at DESC, ir.id`,
  );
  const works = new Map<
    string,
    { readonly queuedIsbn: string | null; readonly candidates: string[] }
  >();
  for (const row of rows) {
    const entry = works.get(row.work_id) ?? {
      queuedIsbn: row.queued_isbn,
      candidates: [],
    };
    if (row.isbn) entry.candidates.push(row.isbn);
    if (row.snapshot_json) {
      try {
        const snapshot = JSON.parse(row.snapshot_json) as { readonly isbns?: unknown };
        if (Array.isArray(snapshot.isbns)) {
          entry.candidates.push(
            ...snapshot.isbns.filter((value): value is string => typeof value === 'string'),
          );
        }
      } catch {
        // Source ISBNs remain usable when an old candidate snapshot is malformed.
      }
    }
    works.set(row.work_id, entry);
  }
  let queued = 0;
  await inTransaction(database, async () => {
    for (const [workId, entry] of works) {
      const isbn = entry.candidates
        .flatMap((value) => isbnVariants(value))
        .find((value) => isValidIsbn(value));
      if (!isbn) continue;
      if (!entry.queuedIsbn) {
        await database.run(
          `INSERT INTO catalog_cover_fetches (work_id, isbn, status, attempts, updated_at)
           VALUES (?, ?, 'pending', 0, ?)`,
          [workId, isbn, now],
        );
        queued += 1;
      } else if (entry.queuedIsbn !== isbn) {
        await database.run(
          `UPDATE catalog_cover_fetches
           SET isbn = ?, status = 'pending', attempts = 0,
               last_attempted_at = NULL, updated_at = ?
           WHERE work_id = ?`,
          [isbn, now, workId],
        );
        queued += 1;
      }
    }
  });
  return queued;
}

export async function nextCatalogCoverFetch(
  database: Database,
  retryFailedBefore: string,
): Promise<CatalogCoverFetch | undefined> {
  const rows = await database.query<{ work_id: string; isbn: string }>(
    `SELECT work_id, isbn FROM catalog_cover_fetches
     WHERE status = 'pending' OR (status = 'failed' AND updated_at <= ?)
     ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, updated_at, work_id
     LIMIT 1`,
    [retryFailedBefore],
  );
  const row = rows[0];
  return row ? { workId: row.work_id, isbn: row.isbn } : undefined;
}

export async function finishCatalogCoverFetch(
  database: Database,
  workId: string,
  status: 'found' | 'not_found' | 'failed',
  now: string,
): Promise<void> {
  await database.run(
    `UPDATE catalog_cover_fetches
     SET status = ?, attempts = attempts + 1, last_attempted_at = ?, updated_at = ?
     WHERE work_id = ?`,
    [status, now, now, workId],
  );
}
