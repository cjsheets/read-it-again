import { useEffect, useRef, useState } from 'react';
import { isLibrarySource, type ShelfEntry, type ReadingTrait } from '@read-it-again/storage-schema';
import { useApp, useWorkerData } from '../app-state.js';
import { requestWorker } from '../client.js';
import { Cover } from './cover.js';
import { downscaleCover } from './downscale.js';
import { provenanceLabel, RatingButtons, TRAITS } from './book-controls.js';
import { useCover } from './use-cover.js';

type ShelfItem = ShelfEntry;

type ReadingContext = 'bedtime' | 'daytime' | 'travel' | 'school' | 'other';
const READING_CONTEXTS: readonly ReadingContext[] = [
  'bedtime',
  'daytime',
  'travel',
  'school',
  'other',
];

/** Detail and correction surface for one shelf work. */
export function BookDetail({
  item,
  onClose,
}: {
  readonly item: ShelfItem;
  readonly onClose: () => void;
}) {
  const cover = useCover(item.workId, item.hasCover);
  const { busy, saveBookDetails, removeBook } = useApp();
  const panel = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [author, setAuthor] = useState(item.authors[0] ?? '');
  const [showEdits, setShowEdits] = useState(false);
  const edits = useWorkerData(
    { type: 'getBookEdits', workId: item.workId },
    (response) => response.bookEdits ?? [],
  );
  // History is per-book and only needed while the drawer is open, so it is fetched
  // here rather than carried by the shelf.
  const model = useWorkerData({ type: 'getActivity' }, (response) => response.activity);
  const sessions = (model?.sessions ?? []).filter((session) => session.workId === item.workId);
  const checkouts = (model?.checkouts ?? []).filter((checkout) => checkout.workId === item.workId);
  const episodes = (model?.episodes ?? []).filter(
    (episode) =>
      episode.workId === item.workId &&
      checkouts.some((checkout) => isLibrarySource(checkout.sourceKind)),
  );
  const timesBorrowed = episodes.reduce((total, episode) => total + episode.checkoutCount, 0);

  useEffect(() => {
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="detail-scrim" role="presentation" onClick={onClose}>
      <div
        className="detail"
        role="dialog"
        aria-modal="true"
        aria-label={item.title}
        data-testid="book-detail"
        ref={panel}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="detail-head">
          <div className="detail-cover">
            <Cover
              workId={item.workId}
              title={item.title}
              author={item.authors[0] ?? null}
              bytes={cover?.bytes}
              mime={cover?.mime}
            />
          </div>
          <div>
            <h2>{item.title}</h2>
            <p className="detail-author">{item.authors.join(', ') || 'Unknown author'}</p>
            <p className="model-note" data-testid="detail-provenance">
              {provenanceLabel(item.sourceKinds)} · For {item.readerName}
            </p>
          </div>
          <button type="button" className="detail-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {editing ? (
          <section
            className="detail-section book-details-edit"
            aria-labelledby={`edit-${item.workId}`}
          >
            <h3 id={`edit-${item.workId}`}>Edit details</h3>
            <label>
              Book title
              <input value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label>
              Author
              <input value={author} onChange={(event) => setAuthor(event.target.value)} />
            </label>
            <div className="decision-actions">
              <button
                type="button"
                disabled={busy || title.trim().length === 0}
                onClick={() =>
                  void saveBookDetails({ workId: item.workId, title, author }).then((saved) => {
                    if (saved) setEditing(false);
                  })
                }
              >
                Save details
              </button>
              <button type="button" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </section>
        ) : (
          <div className="decision-actions detail-book-actions">
            <button
              type="button"
              onClick={() => {
                setTitle(item.title);
                setAuthor(item.authors[0] ?? '');
                setEditing(true);
              }}
            >
              Edit details
            </button>
            <button type="button" onClick={() => setShowEdits((current) => !current)}>
              {showEdits ? 'Hide edit history' : 'Show edit history'}
            </button>
            <button
              type="button"
              className="danger-action"
              disabled={busy}
              onClick={() =>
                void removeBook(item.workId, item.title).then((removed) => {
                  if (removed) onClose();
                })
              }
            >
              Remove from shelf
            </button>
          </div>
        )}

        {showEdits && (
          <section
            className="detail-section"
            data-testid="book-edit-history"
            aria-labelledby={`edit-history-${item.workId}`}
          >
            <h3 id={`edit-history-${item.workId}`}>Edit history</h3>
            <ol className="detail-history">
              {(edits ?? []).map((edit, index) => (
                <li key={`${edit.createdAt}-${String(index)}`}>
                  <strong>{edit.title}</strong>
                  {edit.author && <> · {edit.author}</>}
                  {edit.original && <small> · Original details</small>}
                </li>
              ))}
            </ol>
          </section>
        )}

        <LogReading item={item} />
        <CoverChooser workId={item.workId} hasCover={item.hasCover} />
        <Assessment item={item} />

        <section className="detail-section" aria-labelledby={`history-${item.workId}`}>
          <h3 id={`history-${item.workId}`}>History</h3>
          {sessions.length === 0 && checkouts.length === 0 ? (
            <p className="model-note">Nothing recorded yet.</p>
          ) : (
            <ul className="detail-history">
              {sessions.map((session) => (
                <li key={session.id}>
                  <strong>Read aloud</strong> · {session.context ?? 'unspecified'} ·{' '}
                  {session.participantNames.join(', ')}
                  <br />
                  <small>
                    {new Date(session.occurredAt).toLocaleDateString()} ·{' '}
                    {session.durationMinutes ?? '?'} min
                  </small>
                </li>
              ))}
              {checkouts.map((checkout) => (
                <li key={checkout.id}>
                  <strong>
                    {isLibrarySource(checkout.sourceKind) ? 'Borrowed from a library' : 'Added'}
                  </strong>
                  <br />
                  <small>{new Date(checkout.occurredAt).toLocaleDateString()}</small>
                </li>
              ))}
            </ul>
          )}
          {episodes.length > 0 && (
            <p className="model-note">
              Borrowed {timesBorrowed} {timesBorrowed === 1 ? 'time' : 'times'} — which
              doesn&rsquo;t mean it was read.
            </p>
          )}
        </section>

        <WhyThisReader item={item} />
      </div>
    </div>
  );
}

/** Quick logging followed by optional participant, context, and date correction. */
function LogReading({ item }: { readonly item: ShelfItem }) {
  const { summary, applyReadingChange, reviseSession } = useApp();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<readonly string[]>([item.personId]);
  const [context, setContext] = useState<ReadingContext>('bedtime');
  const [when, setWhen] = useState(() => new Date().toISOString().slice(0, 10));

  if (!sessionId) {
    return (
      <div className="decision-actions detail-actions">
        <button
          type="button"
          className="primary-action"
          data-testid="log-a-reading"
          onClick={() =>
            void applyReadingChange({
              type: 'recordReadingSession',
              householdId: item.householdId,
              workId: item.workId,
              participantIds: [item.personId],
              durationMinutes: item.estimatedReadMinutes ?? undefined,
              context: 'bedtime',
            }).then(setSessionId)
          }
        >
          Log a reading
        </button>
      </div>
    );
  }

  const revise = (next: {
    participants?: readonly string[];
    context?: ReadingContext;
    when?: string;
  }) => {
    const participantIds = next.participants ?? participants;
    if (participantIds.length === 0) return;
    void reviseSession({
      type: 'reviseReadingSession',
      sessionId,
      participantIds,
      // Keep the time of day already recorded; only the date is editable here.
      occurredAt: new Date(`${next.when ?? when}T12:00:00`).toISOString(),
      durationMinutes: item.estimatedReadMinutes ?? undefined,
      context: next.context ?? context,
    });
  };

  return (
    <section className="detail-section" aria-labelledby={`logged-${item.workId}`}>
      <h3 id={`logged-${item.workId}`}>Logged</h3>
      <p className="model-note" data-testid="session-logged">
        Recorded. Adjust it here if it was not quite like that.
      </p>
      <div className="session-edit">
        <fieldset>
          <legend>Who was there</legend>
          {summary.readers.map((reader) => (
            <label key={reader.id}>
              <input
                type="checkbox"
                checked={participants.includes(reader.id)}
                onChange={(event) => {
                  const next = event.target.checked
                    ? [...participants, reader.id]
                    : participants.filter((id) => id !== reader.id);
                  setParticipants(next);
                  revise({ participants: next });
                }}
              />{' '}
              {reader.displayName}
            </label>
          ))}
        </fieldset>
        <label>
          When{' '}
          <input
            type="date"
            aria-label="When it was read"
            data-testid="session-date"
            value={when}
            onChange={(event) => {
              setWhen(event.target.value);
              revise({ when: event.target.value });
            }}
          />
        </label>
        <label>
          Context{' '}
          <select
            aria-label="Reading context"
            data-testid="session-context"
            value={context}
            onChange={(event) => {
              const next = event.target.value as ReadingContext;
              setContext(next);
              revise({ context: next });
            }}
          >
            {READING_CONTEXTS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

/** Assessment editing stays in the detail view rather than every shelf tile. */
function Assessment({ item }: { readonly item: ShelfItem }) {
  const { applyReadingChange } = useApp();
  const [engagement, setEngagement] = useState<number | null>(item.childEngagement);
  const [tolerance, setTolerance] = useState<number | null>(item.adultTolerance);
  const [asks, setAsks] = useState(item.asksByName);
  const [veto, setVeto] = useState(item.veto);
  const [minutes, setMinutes] = useState(item.estimatedReadMinutes?.toString() ?? '');
  const [traits, setTraits] = useState<readonly ReadingTrait[]>(item.traits);
  const unrated = item.childEngagement === null && item.adultTolerance === null;
  const changed =
    engagement !== item.childEngagement ||
    tolerance !== item.adultTolerance ||
    asks !== item.asksByName ||
    veto !== item.veto ||
    minutes !== (item.estimatedReadMinutes?.toString() ?? '') ||
    traits.length !== item.traits.length ||
    traits.some((trait) => !item.traits.includes(trait));

  return (
    <section className="detail-section" aria-labelledby={`assess-${item.workId}`}>
      <h3 id={`assess-${item.workId}`}>How did it go?</h3>
      <div className="quick-rating">
        <RatingButtons label="Kid liked it" value={engagement} onChange={setEngagement} />
        <RatingButtons label="I liked it" value={tolerance} onChange={setTolerance} />
      </div>
      {unrated && (
        <p className="rating-unset" data-testid="rating-unset">
          Not rated yet.
        </p>
      )}
      <div className="trait-chips">
        {TRAITS.map((trait) => (
          <button
            aria-pressed={traits.includes(trait.value)}
            type="button"
            key={trait.value}
            onClick={() =>
              setTraits(
                traits.includes(trait.value)
                  ? traits.filter((value) => value !== trait.value)
                  : [...traits, trait.value],
              )
            }
          >
            {trait.label}
          </button>
        ))}
      </div>
      <div className="assessment-options">
        <label>
          <input
            type="checkbox"
            checked={asks}
            onChange={(event) => setAsks(event.target.checked)}
          />{' '}
          Asked by name
        </label>
        <label>
          <input
            type="checkbox"
            checked={veto}
            onChange={(event) => setVeto(event.target.checked)}
          />{' '}
          Don&rsquo;t suggest this again
        </label>
        <label>
          Minutes{' '}
          <input
            aria-label="Estimated read minutes"
            type="number"
            min="1"
            max="180"
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
          />
        </label>
      </div>
      <div className="decision-actions">
        <button
          type="button"
          disabled={!changed}
          onClick={() =>
            void applyReadingChange({
              type: 'assessWork',
              workId: item.workId,
              personId: item.personId,
              childEngagement: engagement ?? undefined,
              adultTolerance: tolerance ?? undefined,
              asksByName: asks,
              veto,
              estimatedReadMinutes: minutes ? Number(minutes) : undefined,
              traits,
            })
          }
        >
          Save
        </button>
      </div>
    </section>
  );
}

/** Shows the current attribution explanation and its supporting evidence. */
function WhyThisReader({ item }: { readonly item: ShelfItem }) {
  const { summary, reassignWork } = useApp();
  const tasks = useWorkerData({ type: 'getTasks' }, (response) => response.tasks);
  const triage = tasks?.attributionTriage.find((entry) => entry.workId === item.workId);
  const assigned = new Set(item.readers.map((reader) => reader.id));

  if (summary.readers.length === 1) return null;

  return (
    <section className="detail-section" aria-labelledby={`why-${item.workId}`}>
      <h3 id={`why-${item.workId}`}>Who&rsquo;s this for?</h3>
      <p className="model-note" data-testid="attribution-explanation">
        {triage?.explanation ??
          `Filed under ${item.readers.map((reader) => reader.displayName).join(' and ') || item.readerName}. Change it below and your choice replaces whatever decided it.`}
      </p>
      {/* Offered whether or not the book is in review. A book filed automatically
          is the common case and the one ADR 0012 promised to make reversible;
          requiring a triage entry made that promise unreachable. */}
      <div className="decision-actions">
        {summary.readers.map((reader) => (
          <button
            key={reader.id}
            type="button"
            aria-pressed={assigned.has(reader.id)}
            onClick={() => void reassignWork(item.workId, [reader.id])}
          >
            Always for {reader.displayName}
          </button>
        ))}
        {summary.readers.length > 1 && (
          <button
            type="button"
            onClick={() =>
              void reassignWork(
                item.workId,
                summary.readers.map((reader) => reader.id),
              )
            }
          >
            For everyone
          </button>
        )}
        <button
          type="button"
          data-testid="detail-not-for-a-child"
          onClick={() => void reassignWork(item.workId, [])}
        >
          Not for a child
        </button>
      </div>
    </section>
  );
}

/** Saves a selected image after reducing it to the limits in ADR 0013. */
function CoverChooser({
  workId,
  hasCover,
}: {
  readonly workId: string;
  readonly hasCover: boolean;
}) {
  const { busy, refresh } = useApp();
  const [problem, setProblem] = useState<string | null>(null);

  return (
    <div className="detail-cover-actions">
      <label
        className={
          busy ? 'file-button cover-file-button disabled' : 'file-button cover-file-button'
        }
      >
        <span>{hasCover ? 'Replace cover' : 'Choose a cover'}</span>
        <input
          data-testid="cover-file"
          type="file"
          accept="image/*"
          disabled={busy}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (!file) return;
            setProblem(null);
            void (async () => {
              try {
                const cover = await downscaleCover(file);
                const response = await requestWorker({ type: 'saveCover', workId, ...cover });
                if (!response.ok) throw new Error(response.message);
                await refresh();
              } catch (error) {
                setProblem(error instanceof Error ? error.message : String(error));
              }
            })();
          }}
        />
      </label>
      {hasCover && (
        <button
          type="button"
          className="link-button"
          onClick={() => void requestWorker({ type: 'removeCover', workId }).then(() => refresh())}
        >
          Remove cover
        </button>
      )}
      {problem && (
        <p className="durability-warning" data-testid="cover-problem">
          {problem}
        </p>
      )}
    </div>
  );
}
