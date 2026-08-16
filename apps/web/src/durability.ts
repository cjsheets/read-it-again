/**
 * Audit finding F-05. Browser storage is evictable, `navigator.storage.persist()`
 * was never called anywhere in the source, and clearing OPFS returned the app to
 * "No books imported yet." with no warning and no recovery path. ADR 0011 names
 * this risk and the UI did nothing about it.
 *
 * Two facts live here, and they are deliberately stored in different places:
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
const PERSIST_REQUESTED = 'read-it-again:persist-requested';

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
