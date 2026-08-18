import {
  finishCatalogCoverFetch,
  getCoverImage,
  listCoverIsbns,
  nextCatalogCoverFetch,
  saveCoverImage,
  type Database,
} from '@read-it-again/storage-schema';
import { downscaleCoverBlob } from './components/downscale.js';

export type CatalogCoverResult = 'saved' | 'not_found' | 'no_isbn';

const REQUEST_GAP_MS = 3_100;
const FAILED_RETRY_MS = 24 * 60 * 60 * 1_000;
let lastRequestAt = 0;

/**
 * Fetches a queued cover once, then stores only the bounded local bytes. The
 * remote URL is never used by an <img>, so returning to the shelf does not
 * disclose the household's books again.
 */
export async function fetchCatalogCover(
  database: Database,
  workId: string,
  options: {
    readonly fetch?: typeof globalThis.fetch;
    readonly isbn?: string;
    readonly now?: () => Date;
  } = {},
): Promise<CatalogCoverResult> {
  const isbns = options.isbn ? [options.isbn] : await listCoverIsbns(database, workId);
  if (isbns.length === 0) return 'no_isbn';
  const fetchImage = options.fetch ?? globalThis.fetch;

  for (const isbn of isbns) {
    const wait = REQUEST_GAP_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await delay(wait);
    const url = `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-M.jpg?default=false`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    let response: Response;
    try {
      lastRequestAt = Date.now();
      response = await fetchImage(url, {
        credentials: 'omit',
        mode: 'cors',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (response.status === 404) continue;
    if (!response.ok) throw new Error(`The cover catalog returned ${String(response.status)}.`);
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) throw new Error('The cover catalog returned a non-image.');
    const cover = await downscaleCoverBlob(blob);
    // The request yielded while the network was in flight. A household-selected
    // file may have arrived in the meantime, and it always wins over automation.
    if (await getCoverImage(database, workId)) return 'saved';
    await saveCoverImage(database, {
      workId,
      ...cover,
      source: 'catalog',
      sourceRef: url,
      now: (options.now ?? (() => new Date()))().toISOString(),
    });
    return 'saved';
  }
  return 'not_found';
}

/** Drains the durable queue at the catalog's published courtesy rate. A failed
 * network request is cached for a day; a definitive 404 is cached until the work
 * gains a different ISBN. */
export async function drainCatalogCoverQueue(
  database: Database,
  onStored: (workId: string) => void,
  options: {
    readonly fetch?: typeof globalThis.fetch;
    readonly now?: () => Date;
    /** Checked before every request so withdrawing consent stops the queue
     *  immediately rather than after it has worked through the shelf. */
    readonly shouldContinue?: () => boolean;
  } = {},
): Promise<void> {
  const now = options.now ?? (() => new Date());
  while (options.shouldContinue?.() ?? true) {
    const retryBefore = new Date(now().getTime() - FAILED_RETRY_MS).toISOString();
    const job = await nextCatalogCoverFetch(database, retryBefore);
    if (!job) return;
    try {
      const result = await fetchCatalogCover(database, job.workId, {
        fetch: options.fetch,
        isbn: job.isbn,
        now,
      });
      const finishedAt = now().toISOString();
      if (result === 'saved') {
        await finishCatalogCoverFetch(database, job.workId, 'found', finishedAt);
        onStored(job.workId);
      } else {
        await finishCatalogCoverFetch(database, job.workId, 'not_found', finishedAt);
      }
    } catch {
      await finishCatalogCoverFetch(database, job.workId, 'failed', now().toISOString());
    }
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
