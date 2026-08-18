import { canonicalIsbn, isValidIsbn } from '@read-it-again/domain';
import type { Database } from '@read-it-again/storage-schema';
import { waitForCatalogRequest } from './catalog-request.js';

export interface IsbnMetadata {
  readonly isbn: string;
  readonly title: string;
  readonly authors: readonly string[];
}

const HIT_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const FAILURE_TTL_MS = 60 * 60 * 1_000;

/**
 * Looks up one edition by ISBN. The result is a proposal only: this function
 * never creates or changes a book. Hits, definitive misses and failures are all
 * cached in the portable HTTP cache so repeated gestures do not repeat a
 * disclosure or hammer a temporarily unavailable service (ADR 0017).
 */
export async function lookupCatalogMetadata(
  database: Database,
  rawIsbn: string,
  options: { readonly fetch?: typeof globalThis.fetch; readonly now?: () => Date } = {},
): Promise<IsbnMetadata | null> {
  const isbn = canonicalIsbn(rawIsbn);
  if (!isbn || !isValidIsbn(isbn)) throw new Error('A valid ISBN is required for lookup.');
  const key = `openlibrary:books:isbn:${isbn}`;
  const now = options.now ?? (() => new Date());
  const cached = await database.query<{ status: number; body: string; expires_at: string }>(
    'SELECT status, body, expires_at FROM catalog_http_cache WHERE request_key = ?',
    [key],
  );
  const stored = cached[0];
  if (stored && stored.expires_at > now().toISOString()) {
    if (stored.status === 200) return parseStored(stored.body);
    if (stored.status === 404) return null;
    throw new Error('Open Library lookup is temporarily unavailable.');
  }

  await waitForCatalogRequest();
  const url = new URL('https://openlibrary.org/api/books');
  url.searchParams.set('bibkeys', `ISBN:${isbn}`);
  url.searchParams.set('format', 'json');
  url.searchParams.set('jscmd', 'data');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await (options.fetch ?? globalThis.fetch)(url, {
      credentials: 'omit',
      mode: 'cors',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Open Library returned ${String(response.status)}.`);
    const body = (await response.json()) as unknown;
    const metadata = parseResponse(body, isbn);
    await store(
      database,
      key,
      metadata ? 200 : 404,
      JSON.stringify(metadata),
      now(),
      metadata ? HIT_TTL_MS : MISS_TTL_MS,
    );
    return metadata;
  } catch (error) {
    await store(
      database,
      key,
      599,
      JSON.stringify({ message: error instanceof Error ? error.message : String(error) }),
      now(),
      FAILURE_TTL_MS,
    );
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function store(
  database: Database,
  key: string,
  status: number,
  body: string,
  now: Date,
  ttl: number,
): Promise<void> {
  await database.run(
    `INSERT OR REPLACE INTO catalog_http_cache
       (request_key, status, content_type, body, fetched_at, expires_at)
     VALUES (?, ?, 'application/json', ?, ?, ?)`,
    [key, status, body, now.toISOString(), new Date(now.getTime() + ttl).toISOString()],
  );
}

function parseResponse(value: unknown, isbn: string): IsbnMetadata | null {
  if (!isRecord(value)) return null;
  const book = value[`ISBN:${isbn}`];
  if (!isRecord(book) || typeof book.title !== 'string' || !book.title.trim()) return null;
  const authors = Array.isArray(book.authors)
    ? book.authors.flatMap((author) =>
        isRecord(author) && typeof author.name === 'string' && author.name.trim()
          ? [author.name.trim()]
          : [],
      )
    : [];
  return { isbn, title: book.title.trim(), authors };
}

function parseStored(value: string): IsbnMetadata {
  const parsed = JSON.parse(value) as unknown;
  if (
    !isRecord(parsed) ||
    typeof parsed.isbn !== 'string' ||
    typeof parsed.title !== 'string' ||
    !Array.isArray(parsed.authors)
  )
    throw new Error('Cached Open Library metadata is invalid.');
  return {
    isbn: parsed.isbn,
    title: parsed.title,
    authors: parsed.authors.filter((author): author is string => typeof author === 'string'),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
