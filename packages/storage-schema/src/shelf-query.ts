import { searchText } from '@read-it-again/domain';
import type { Database } from './database.js';
import type { ReadingTrait } from './reading.js';

/**
 * ADR 0014. The shelf is read a page at a time rather than shipped whole. Every
 * worker response used to carry the complete dataset, so a thousand-book household
 * paid for all thousand on every keystroke, every rating, every add.
 */
export interface ShelfQuery {
  readonly query?: string;
  readonly sort?: ShelfSort;
  readonly offset?: number;
  readonly limit?: number;
}

export type ShelfSort = 'recent' | 'title' | 'author' | 'rating';

export interface ShelfEntry {
  readonly householdId: string;
  readonly workId: string;
  readonly title: string;
  readonly personId: string;
  readonly readerName: string;
  readonly episodeCount: number;
  readonly childEngagement: number | null;
  readonly adultTolerance: number | null;
  readonly asksByName: boolean;
  readonly veto: boolean;
  readonly estimatedReadMinutes: number | null;
  readonly traits: readonly ReadingTrait[];
  readonly sourceKinds: readonly string[];
  readonly authors: readonly string[];
  readonly hasCover: boolean;
}

export interface ShelfPage {
  readonly entries: readonly ShelfEntry[];
  /** Total matching the current query, so the grid can size its scroll area
   *  without holding every row. */
  readonly total: number;
  readonly offset: number;
}

const ORDER_BY: Readonly<Record<ShelfSort, string>> = {
  recent: 'w.created_at DESC, w.canonical_title',
  title: 'w.canonical_title COLLATE NOCASE',
  author: 'COALESCE(ed.authors_json, char(255)) COLLATE NOCASE, w.canonical_title',
  rating: 'COALESCE(a.child_engagement, -1) DESC, s.preference_score DESC, w.canonical_title',
};

const FROM = `
  FROM preference_summaries s
  JOIN works w ON w.id = s.work_id
  JOIN people p ON p.id = s.person_id
  LEFT JOIN work_assessments a ON a.work_id = s.work_id AND a.person_id = s.person_id
  LEFT JOIN (SELECT work_id, min(id) AS edition_id FROM editions GROUP BY work_id) fe
    ON fe.work_id = s.work_id
  LEFT JOIN editions ed ON ed.id = fe.edition_id
  LEFT JOIN work_search ws ON ws.work_id = s.work_id
`;

export async function listShelf(database: Database, input: ShelfQuery = {}): Promise<ShelfPage> {
  const limit = Math.min(Math.max(input.limit ?? 60, 1), 500);
  const offset = Math.max(input.offset ?? 0, 0);
  const term = searchText(input.query ?? '');
  // Infix match on the normalised projection. An index cannot serve a leading
  // wildcard, and at this product's scale it does not need to: a few thousand
  // rows scan in well under the 150 ms budget.
  const where = term ? 'WHERE ws.text LIKE ?' : '';
  const filters = term ? [`%${term}%`] : [];

  const totals = await database.query<{ total: number }>(
    `SELECT count(*) AS total ${FROM} ${where}`,
    filters,
  );

  const rows = await database.query<{
    household_id: string;
    work_id: string;
    title: string;
    person_id: string;
    reader_name: string;
    episode_count: number;
    child_engagement: number | null;
    adult_tolerance: number | null;
    asks_by_name: number | null;
    veto: number | null;
    estimated_read_minutes: number | null;
    traits_json: string | null;
    source_kinds: string | null;
    authors_json: string | null;
    has_cover: number;
  }>(
    `SELECT p.household_id, s.work_id, w.canonical_title AS title, s.person_id,
            p.display_name AS reader_name, s.episode_count,
            a.child_engagement, a.adult_tolerance, a.asks_by_name, a.veto,
            a.estimated_read_minutes, a.traits_json, ed.authors_json,
            (SELECT group_concat(DISTINCT sa.kind)
             FROM import_records r
             JOIN source_accounts sa ON sa.id = r.source_account_id
             JOIN resolution_cases c ON c.import_record_id = r.id
             JOIN resolution_decisions d ON d.resolution_case_id = c.id AND d.current = 1
             JOIN editions e2 ON e2.id = d.edition_id
             WHERE e2.work_id = s.work_id) AS source_kinds,
            (SELECT count(*) FROM cover_images ci WHERE ci.work_id = s.work_id) AS has_cover
     ${FROM} ${where}
     ORDER BY ${ORDER_BY[input.sort ?? 'recent']}
     LIMIT ? OFFSET ?`,
    [...filters, limit, offset],
  );

  return {
    total: totals[0]?.total ?? 0,
    offset,
    entries: rows.map((row) => ({
      householdId: row.household_id,
      workId: row.work_id,
      title: row.title,
      personId: row.person_id,
      readerName: row.reader_name,
      episodeCount: row.episode_count,
      childEngagement: row.child_engagement,
      adultTolerance: row.adult_tolerance,
      asksByName: row.asks_by_name === 1,
      veto: row.veto === 1,
      estimatedReadMinutes: row.estimated_read_minutes,
      traits: JSON.parse(row.traits_json ?? '[]') as ReadingTrait[],
      sourceKinds: (row.source_kinds ?? '').split(',').filter(Boolean),
      authors: parseAuthorDisplays(row.authors_json),
      hasCover: row.has_cover > 0,
    })),
  };
}

/**
 * Brings the search projection up to date. Deliberately incremental — it indexes
 * only works that have no row yet — because it runs after every mutation, and the
 * whole point of this increment is that per-mutation work stops scaling with the
 * size of the shelf.
 */
export async function indexWorksForSearch(database: Database): Promise<number> {
  const rows = await database.query<{
    id: string;
    canonical_title: string;
    authors_json: string | null;
  }>(
    `SELECT w.id, w.canonical_title, ed.authors_json
     FROM works w
     LEFT JOIN (SELECT work_id, min(id) AS edition_id FROM editions GROUP BY work_id) fe
       ON fe.work_id = w.id
     LEFT JOIN editions ed ON ed.id = fe.edition_id
     LEFT JOIN work_search ws ON ws.work_id = w.id
     WHERE ws.work_id IS NULL`,
  );
  for (const row of rows) {
    const authors = parseAuthorDisplays(row.authors_json).join(' ');
    await database.run('INSERT OR REPLACE INTO work_search (work_id, text) VALUES (?, ?)', [
      row.id,
      searchText(`${row.canonical_title} ${authors}`),
    ]);
  }
  return rows.length;
}

function parseAuthorDisplays(authorsJson: string | null): readonly string[] {
  if (!authorsJson) return [];
  try {
    const value = JSON.parse(authorsJson) as unknown;
    if (!Array.isArray(value)) return [];
    return value
      .map((author) =>
        typeof author === 'string'
          ? author
          : ((author as { display?: unknown })?.display as string | undefined),
      )
      .filter((display): display is string => typeof display === 'string' && display.length > 0);
  } catch {
    return [];
  }
}
