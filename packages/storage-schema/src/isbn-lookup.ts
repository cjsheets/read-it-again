import { isbnVariants } from '@read-it-again/domain';
import type { Database } from './database.js';

export interface IsbnMatch {
  readonly workId: string;
  readonly title: string;
}

/**
 * The work this ISBN already belongs to, or null.
 *
 * Audit §8.2: a scan is an observation about an *edition*, and ADR 0004 keeps
 * editions distinct from the work they are printings of. So this asks the
 * question three ways, because an ISBN can have arrived by three routes: carried
 * on an imported row, attached to an edition by a resolution, or recorded
 * directly against a work. A paperback scanned after the hardback was imported
 * has to land on the same work rather than becoming a second book.
 *
 * Every spelling of the number is tried, since a barcode always reads as
 * thirteen digits while an imported row may hold ten.
 */
export async function findWorkByIsbn(database: Database, isbn: string): Promise<IsbnMatch | null> {
  const variants = isbnVariants(isbn);
  if (variants.length === 0) return null;
  const list = variants.map(() => '?').join(', ');
  const rows = await database.query<{ id: string; canonical_title: string }>(
    `SELECT w.id, w.canonical_title
       FROM works w
      WHERE w.retired_at IS NULL
        AND w.id IN (
          SELECT ed.work_id
            FROM import_records ir
            JOIN resolution_cases rc ON rc.import_record_id = ir.id
            JOIN resolution_decisions rd ON rd.resolution_case_id = rc.id AND rd.current = 1
            JOIN editions ed ON ed.id = rd.edition_id
           WHERE ir.isbn IN (${list})
          UNION
          SELECT ed.work_id
            FROM external_identifiers xi
            JOIN editions ed ON ed.id = xi.entity_id
           WHERE xi.entity_kind = 'edition' AND xi.namespace = 'isbn' AND xi.value IN (${list})
          UNION
          SELECT xi.entity_id
            FROM external_identifiers xi
           WHERE xi.entity_kind = 'work' AND xi.namespace = 'isbn' AND xi.value IN (${list})
        )
      ORDER BY w.created_at, w.id
      LIMIT 1`,
    [...variants, ...variants, ...variants],
  );
  const row = rows[0];
  return row ? { workId: row.id, title: row.canonical_title } : null;
}
