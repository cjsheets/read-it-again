/**
 * Two durability facts live here and are stored in different places:
 *
 * - Whether this *browser* granted persistent storage is device-local and is
 *   queried live from the Storage API, never cached, so it cannot go stale.
 * - Whether this device has ever held books is a device-local marker in
 *   localStorage. It must not live in the database, because the whole point is to
 *   survive the database disappearing.
 *
 * `last_backup_at` is the exception: it belongs to the data, not the device, so it
 * lives in `app_metadata` and travels inside the archive.
 */

const HAD_BOOKS = 'read-it-again:had-books';
const READER_FILTER = 'read-it-again:reader-filter';
const PERSIST_REQUESTED = 'read-it-again:persist-requested';
const SCANNING = 'read-it-again:scanning';
const CATALOG_COVERS = 'read-it-again:catalog-covers';

export type PersistenceState = 'persistent' | 'evictable' | 'unsupported';

export async function readPersistence(): Promise<PersistenceState> {
  if (!navigator.storage?.persisted) return 'unsupported';
  try {
    return (await navigator.storage.persisted()) ? 'persistent' : 'evictable';
  } catch {
    return 'unsupported';
  }
}

/**
 * Asks the browser to exempt this origin from automatic eviction. Called after a
 * successful add rather than on load: Firefox shows a permission prompt, and
 * Chromium's heuristics look kindly on a site the user has actually engaged with.
 * Asked once per device so a returning user is not prompted repeatedly.
 */
export async function requestPersistenceOnce(): Promise<PersistenceState> {
  const current = await readPersistence();
  if (current !== 'evictable') return current;
  if (safeGet(PERSIST_REQUESTED)) return current;
  safeSet(PERSIST_REQUESTED, 'yes');
  try {
    return (await navigator.storage.persist()) ? 'persistent' : 'evictable';
  } catch {
    return 'evictable';
  }
}

/** Remembers that this device once held books, so an empty database later can be
 *  reported as a loss rather than as a first run. */
export function rememberBooksExist(recordCount: number): void {
  if (recordCount > 0) safeSet(HAD_BOOKS, 'yes');
}

/**
 * True when this device previously held books and the database is now empty.
 *
 * Limitation worth knowing: clearing *all* site data removes this marker too, so
 * that case is indistinguishable from a first run and correctly shows the first-run
 * screen. What this does catch is the failure the persistence request exists to
 * prevent — the browser evicting origin storage on its own.
 */
export function looksWiped(recordCount: number): boolean {
  return recordCount === 0 && safeGet(HAD_BOOKS) === 'yes';
}

/** Clears the marker once the user has acknowledged the loss or restored a backup,
 *  so the warning does not follow them forever. */
export function clearWipeMarker(): void {
  safeRemove(HAD_BOOKS);
}

// localStorage throws in some privacy modes; durability messaging must never be
// the thing that breaks the app.
function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignored
  }
}
function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignored
  }
}

/** Which reader the shelf is filtered to. Device-local, like a view preference:
 *  it describes how this person browses, not anything about the data, so it does
 *  not belong in `app_metadata` and must not travel in a backup. */
export function readStoredReaderFilter(): string | null {
  return safeGet(READER_FILTER);
}

export function storeReaderFilter(readerId: string | null): void {
  if (readerId === null) safeRemove(READER_FILTER);
  else safeSet(READER_FILTER, readerId);
}

/**
 * Whether this device has opted in to camera scanning.
 *
 * Off by default until the planned 100-book, six-device field test is complete.
 */
export function readScanningEnabled(): boolean {
  return safeGet(SCANNING) === 'yes';
}

export function storeScanningEnabled(enabled: boolean): void {
  if (enabled) safeSet(SCANNING, 'yes');
  else safeRemove(SCANNING);
}

/**
 * Whether this device may ask openlibrary.org for cover art.
 *
 * Off until someone turns it on, and stored per device like the other view
 * preferences. This is the only thing in the app that sends anything anywhere,
 * and what it sends is an ISBN — which is to say, one book off this household's
 * shelf, per request. That is a disclosure, however mild, so it is asked for
 * rather than assumed.
 *
 * The worker cannot read this: `localStorage` does not exist in a worker. The
 * flag is pushed to it instead, and the worker starts every session assuming
 * the answer is no, so a failure to deliver it fails closed.
 */
export function readCatalogCoversEnabled(): boolean {
  return safeGet(CATALOG_COVERS) === 'yes';
}

export function storeCatalogCoversEnabled(enabled: boolean): void {
  if (enabled) safeSet(CATALOG_COVERS, 'yes');
  else safeRemove(CATALOG_COVERS);
}
