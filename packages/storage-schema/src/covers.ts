import type { Database } from './database.js';

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

/** Caps from the audit's own mitigation for archive growth and OPFS quota. */
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
