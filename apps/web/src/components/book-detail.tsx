import { useEffect, useRef, useState } from 'react';
import { isLibrarySource, type ShelfEntry, type ReadingTrait } from '@read-it-again/storage-schema';
import { useApp, useWorkerData } from '../app-state.js';
import { requestWorker } from '../client.js';
import { Cover } from './cover.js';
import { downscaleCover } from './downscale.js';
import { provenanceLabel, RatingButtons, TRAITS } from './book-controls.js';
import { useCover } from './use-cover.js';

type ShelfItem = ShelfEntry;

/**
 * F-15. There was nowhere to see a book's provenance, metadata, episode history or
 * attribution evidence — all of which the schema stores richly, and none of which
 * was reachable. ADR 0008 goes to some length to preserve that audit trail; this is
 * where it finally becomes visible.
 *
 * It is also where ADR 0012's mitigation lands: an automatic attribution is
 * reversible here, by supersession, for a book already on the shelf. Until now the
 * only correction path was the review queue, which a one-reader household never
 * sees.
 */
export function BookDetail({
  item,
  onClose,
}: {
  readonly item: ShelfItem;
  readonly onClose: () => void;
}) {
  const { applyReadingChange } = useApp();
  const cover = useCover(item.workId, item.hasCover);
  const panel = useRef<HTMLDivElement>(null);
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
              {episodes.length} acquisition {episodes.length === 1 ? 'episode' : 'episodes'} derived
              from borrowing, which is not proof of reading.
            </p>
          )}
        </section>

        <WhyThisReader item={item} />

        <div className="decision-actions detail-actions">
          <button
            type="button"
            onClick={() =>
              void applyReadingChange({
                type: 'recordReadingSession',
                householdId: item.householdId,
                workId: item.workId,
                participantIds: [item.personId],
                durationMinutes: item.estimatedReadMinutes ?? undefined,
                context: 'bedtime',
              })
            }
          >
            Log a reading
          </button>
        </div>
      </div>
    </div>
  );
}

/** N11 lives here now rather than on every shelf card. */
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
      <h3 id={`assess-${item.workId}`}>How it goes</h3>
      <div className="quick-rating">
        <RatingButtons label="Child engagement" value={engagement} onChange={setEngagement} />
        <RatingButtons label="Adult tolerance" value={tolerance} onChange={setTolerance} />
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
          Veto
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
          Save assessment
        </button>
      </div>
    </section>
  );
}

/**
 * ADR 0012 promised that an automatic attribution would say so and be reversible.
 * The explanation was written into `attribution_results` in Increment 2 but had
 * nowhere to appear; this is that promise being kept.
 */
function WhyThisReader({ item }: { readonly item: ShelfItem }) {
  const { summary, reassignWork } = useApp();
  const tasks = useWorkerData({ type: 'getTasks' }, (response) => response.tasks);
  const triage = tasks?.attributionTriage.find((entry) => entry.workId === item.workId);
  const assigned = new Set(item.readers.map((reader) => reader.id));

  return (
    <section className="detail-section" aria-labelledby={`why-${item.workId}`}>
      <h3 id={`why-${item.workId}`}>Why this reader</h3>
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

/**
 * A cover the household chooses from its own files. On a phone this is the camera,
 * because `accept="image/*"` offers it — the dedicated capture flow is Increment 8.
 * Bytes are downscaled before they are stored, so the archive and the OPFS quota
 * stay inside the caps ADR 0013 sets.
 */
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
      <label className={busy ? 'file-button disabled' : 'file-button'}>
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
