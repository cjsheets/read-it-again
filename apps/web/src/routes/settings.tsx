import { useApp, useWorkerData } from '../app-state.js';
import type { PersistenceState } from '../durability.js';

/** Nag once a shelf is worth losing, not on the first book. */
const BACKUP_REMINDER_THRESHOLD = 5;

/**
 * Administrative, not daily (audit §6.4), so it is reachable from the shell but is
 * not one of the five destinations. Backup and restore live here rather than above
 * the bookshelf, where passphrase entry used to sit above the fold.
 */
export function Settings() {
  const {
    summary,
    busy,
    archivePassphrase,
    setArchivePassphrase,
    exportArchive,
    importArchiveFile,
    persistence,
  } = useApp();
  const history = useWorkerData({ type: 'getImportHistory' }, (response) => response.importHistory);

  return (
    <section aria-labelledby="settings-title">
      <div className="section-heading">
        <div>
          <h2 id="settings-title">Settings</h2>
        </div>
      </div>

      <article className="settings-card" aria-labelledby="backup-title">
        <h3 id="backup-title">Backup and restore</h3>
        <p>
          A backup is an encrypted file you keep yourself. Use a memorable passphrase of at least 12
          characters; it is never stored, and without it the file cannot be read.
        </p>
        <input
          aria-label="Archive passphrase"
          type="password"
          minLength={12}
          autoComplete="new-password"
          value={archivePassphrase}
          onChange={(event) => setArchivePassphrase(event.target.value)}
        />
        <div className="archive-actions">
          <button type="button" disabled={busy} onClick={() => void exportArchive()}>
            Export encrypted backup
          </button>
          <label className={busy ? 'file-button disabled' : 'file-button'}>
            <span>Import archive</span>
            <input
              data-testid="archive-file"
              type="file"
              accept="application/json,.ria-archive"
              disabled={busy}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void importArchiveFile(file);
                event.currentTarget.value = '';
              }}
            />
          </label>
        </div>
        <DurabilityNote
          persistence={persistence}
          lastBackupAt={summary.lastBackupAt}
          bookCount={summary.recordCount}
        />
      </article>

      <article className="settings-card" aria-labelledby="sources-title">
        <h3 id="sources-title">Connected sources</h3>
        {!history || history.runs.length === 0 ? (
          <p>Nothing has been imported yet.</p>
        ) : (
          <>
            <p>
              <span data-testid="record-count">{history.records.length} books</span> came in across{' '}
              {history.runs.length} {history.runs.length === 1 ? 'import' : 'imports'}.
            </p>
            <ul className="runs">
              {history.runs.map((run) => (
                <li key={run.id}>
                  {run.fileName ?? 'JSON snapshot'}: {run.rowsNew} new of {run.rowsSeen}
                </li>
              ))}
            </ul>
          </>
        )}
      </article>

      <article className="settings-card" aria-labelledby="privacy-title">
        <h3 id="privacy-title">Privacy</h3>
        <p>
          <strong>Client-only and private by construction.</strong> This app works offline and keeps
          everything in this browser. It makes no network requests for your data, so nothing can be
          collected, and nothing can be recovered from a server if this browser loses it — which is
          why the backup above matters.
        </p>
        <p className="model-note">
          It cannot sign in to a library or query a catalog directly, because catalogs do not permit
          browser access. The local runtime does that work and hands the results over in a backup.
        </p>
      </article>
    </section>
  );
}

/**
 * F-05. ADR 0011 warns that browser storage disappears when a profile is cleared,
 * and the UI said nothing. This states where the data stands in plain language.
 */
function DurabilityNote({
  persistence,
  lastBackupAt,
  bookCount,
}: {
  readonly persistence: PersistenceState;
  readonly lastBackupAt: string | null;
  readonly bookCount: number;
}) {
  const overdue = bookCount >= BACKUP_REMINDER_THRESHOLD && lastBackupAt === null;
  return (
    <div className="durability" data-testid="durability">
      <p>
        <span className="durability-label">Storage</span>{' '}
        <span data-testid="persistence-state">
          {persistence === 'persistent'
            ? 'Protected from automatic cleanup.'
            : persistence === 'evictable'
              ? 'This browser may delete these books to reclaim space.'
              : 'This browser cannot report whether these books are protected.'}
        </span>
      </p>
      <p>
        <span className="durability-label">Last backup</span>{' '}
        <span data-testid="last-backup">
          {lastBackupAt === null ? 'Never' : new Date(lastBackupAt).toLocaleDateString()}
        </span>
      </p>
      {overdue && (
        <p className="durability-warning" data-testid="backup-reminder">
          You have {bookCount} books and no backup. Export one and keep it somewhere else.
        </p>
      )}
    </div>
  );
}
