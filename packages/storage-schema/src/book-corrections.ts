import { searchText } from '@read-it-again/domain';
import { inTransaction, type Database } from './database.js';

export interface BookDetailVersion {
  readonly title: string;
  readonly author: string;
  readonly createdAt: string;
  readonly original: boolean;
}

export async function saveBookDetails(
  database: Database,
  input: {
    readonly id: string;
    readonly workId: string;
    readonly title: string;
    readonly author: string;
    readonly now: string;
  },
): Promise<void> {
  const title = input.title.trim();
  const author = input.author.trim();
  if (!title) throw new Error('Book title is required');
  await inTransaction(database, async () => {
    const rows = await database.query<{ revision: number }>(
      'SELECT COALESCE(max(revision), 0) + 1 AS revision FROM work_detail_edits WHERE work_id = ?',
      [input.workId],
    );
    await database.run(
      `INSERT INTO work_detail_edits (id, work_id, revision, title, author, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [input.id, input.workId, rows[0]?.revision ?? 1, title, author, input.now],
    );
    await database.run('INSERT OR REPLACE INTO work_search (work_id, text) VALUES (?, ?)', [
      input.workId,
      searchText(`${title} ${author}`),
    ]);
  });
}

export async function listBookDetailVersions(
  database: Database,
  workId: string,
): Promise<readonly BookDetailVersion[]> {
  const original = await database.query<{
    title: string;
    authors_json: string | null;
    created_at: string;
  }>(
    `SELECT w.canonical_title AS title, ed.authors_json, w.created_at
     FROM works w
     LEFT JOIN (SELECT work_id, min(id) AS edition_id FROM editions GROUP BY work_id) fe
       ON fe.work_id = w.id
     LEFT JOIN editions ed ON ed.id = fe.edition_id
     WHERE w.id = ?`,
    [workId],
  );
  const edits = await database.query<{ title: string; author: string; created_at: string }>(
    `SELECT title, author, created_at FROM work_detail_edits
     WHERE work_id = ? ORDER BY revision`,
    [workId],
  );
  const source = original[0];
  if (!source) return [];
  return [
    {
      title: source.title,
      author: firstAuthor(source.authors_json),
      createdAt: source.created_at,
      original: true,
    },
    ...edits.map((edit) => ({
      title: edit.title,
      author: edit.author,
      createdAt: edit.created_at,
      original: false,
    })),
  ];
}

export async function setBookShelfState(
  database: Database,
  input: {
    readonly id: string;
    readonly workId: string;
    readonly state: 'removed' | 'present';
    readonly now: string;
  },
): Promise<void> {
  await inTransaction(database, async () => {
    const rows = await database.query<{ revision: number }>(
      'SELECT COALESCE(max(revision), 0) + 1 AS revision FROM work_shelf_events WHERE work_id = ?',
      [input.workId],
    );
    await database.run(
      `INSERT INTO work_shelf_events (id, work_id, revision, state, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [input.id, input.workId, rows[0]?.revision ?? 1, input.state, input.now],
    );
  });
}

function firstAuthor(authorsJson: string | null): string {
  if (!authorsJson) return '';
  try {
    const authors = JSON.parse(authorsJson) as unknown;
    if (!Array.isArray(authors)) return '';
    const author = authors[0] as string | { display?: unknown } | undefined;
    if (typeof author === 'string') return author;
    return typeof author?.display === 'string' ? author.display : '';
  } catch {
    return '';
  }
}
