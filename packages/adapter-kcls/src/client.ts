import type { CatalogCandidate } from '@read-it-again/domain';
import type { Database } from '@read-it-again/storage-schema';
import { parseOpenSearch } from './opensearch.js';
import { parseMarcMetadata } from './marc.js';
import type { CatalogMetadata } from '@read-it-again/domain';

export interface KclsCatalogClientOptions {
  readonly database: Database;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly courtesyDelayMs?: number;
  readonly maxAttempts?: number;
  readonly cacheTtlMs?: number;
}

export class KclsCatalogClient {
  readonly #database: Database;
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #courtesyDelayMs: number;
  readonly #maxAttempts: number;
  readonly #cacheTtlMs: number;
  #tail: Promise<void> = Promise.resolve();

  constructor(options: KclsCatalogClientOptions) {
    this.#database = options.database;
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? (() => new Date());
    this.#sleep =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.#courtesyDelayMs = options.courtesyDelayMs ?? 750;
    this.#maxAttempts = options.maxAttempts ?? 3;
    this.#cacheTtlMs = options.cacheTtlMs ?? 30 * 24 * 60 * 60 * 1000;
  }

  searchByIsbn(isbn: string): Promise<readonly CatalogCandidate[]> {
    return this.search(isbn);
  }

  searchByTitleAuthor(title: string, authorFamily?: string): Promise<readonly CatalogCandidate[]> {
    const query = authorFamily ? `"${title}" ${authorFamily}` : `"${title}"`;
    return this.search(query);
  }

  search(query: string): Promise<readonly CatalogCandidate[]> {
    return this.enqueue(async () => {
      const url = new URL('https://w3.kcls.org/opac/extras/opensearch/1.1/-/atom');
      url.searchParams.set('searchTerms', query);
      url.searchParams.set('count', '25');
      const body = await this.fetchText(url.toString());
      return parseOpenSearch(body);
    });
  }

  getMarcMetadata(bibid: string): Promise<CatalogMetadata> {
    return this.enqueue(async () => {
      const url = `https://w3.kcls.org/opac/extras/supercat/retrieve/marcxml/record/${encodeURIComponent(bibid)}`;
      return parseMarcMetadata(await this.fetchText(url));
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(operation, operation);
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async fetchText(url: string): Promise<string> {
    const cached = await this.#database.query<{ body: string; expires_at: string }>(
      'SELECT body, expires_at FROM catalog_http_cache WHERE request_key = ?',
      [url],
    );
    const now = this.#now();
    if (cached[0] && new Date(cached[0].expires_at) > now) return cached[0].body;

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      if (attempt > 1) await this.#sleep(this.#courtesyDelayMs * 2 ** (attempt - 2));
      try {
        const response = await this.#fetch(url, {
          headers: {
            Accept: url.includes('/supercat/') ? 'application/xml' : 'application/atom+xml',
            'User-Agent': 'Read-It-Again/0.1 (personal library client)',
          },
        });
        if (!response.ok) {
          if (response.status < 500 && response.status !== 429)
            throw new NonRetryableHttpError(response.status);
          throw new Error(`KCLS returned HTTP ${response.status}`);
        }
        const body = await response.text();
        const fetchedAt = now.toISOString();
        const expiresAt = new Date(now.getTime() + this.#cacheTtlMs).toISOString();
        await this.#database.run(
          `INSERT INTO catalog_http_cache (request_key, status, content_type, body, fetched_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (request_key) DO UPDATE SET status = excluded.status,
             content_type = excluded.content_type, body = excluded.body,
             fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
          [url, response.status, response.headers.get('content-type'), body, fetchedAt, expiresAt],
        );
        await this.#sleep(this.#courtesyDelayMs);
        return body;
      } catch (error) {
        if (error instanceof NonRetryableHttpError) throw error;
        lastError = error;
      }
    }
    throw new Error(`KCLS request failed after ${this.#maxAttempts} attempts`, {
      cause: lastError,
    });
  }
}

class NonRetryableHttpError extends Error {
  constructor(status: number) {
    super(`KCLS returned non-retryable HTTP ${status}`);
  }
}
