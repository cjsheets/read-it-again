import { useWorkerData } from '../app-state.js';
import { AttributionCard, ResolutionCard } from '../components/review-cards.js';

/**
 * One destination for every kind of review work, reached from a badge rather than
 * standing between a person and their bookshelf (F-14). The headings are the
 * questions the old eyebrows already asked — those were the right words, and the
 * pipeline-stage headings above them were undoing the work.
 *
 * Since ADR 0012 this is usually empty, which is the point: a one-reader household
 * with no catalog has nothing genuinely ambiguous to decide.
 */
export function Tasks() {
  const tasks = useWorkerData({ type: 'getTasks' }, (response) => response.tasks);
  if (!tasks) return <p className="model-note">Loading…</p>;
  const { resolutionQueue, attributionTriage } = tasks;

  if (resolutionQueue.length === 0 && attributionTriage.length === 0) {
    return (
      <section aria-labelledby="tasks-title">
        <div className="section-heading">
          <div>
            <h2 id="tasks-title">Nothing needs you</h2>
          </div>
        </div>
        <div className="empty" data-testid="tasks-empty">
          Every book is filed. Anything the app cannot work out on its own will appear here.
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="tasks-title">
      <div className="section-heading">
        <div>
          <h2 id="tasks-title">Needs a decision</h2>
        </div>
      </div>

      {resolutionQueue.length > 0 && (
        <div className="resolution">
          <div className="section-heading">
            <h3>Is this the right book?</h3>
            <span className="count" data-testid="resolution-count">
              {resolutionQueue.length} pending
            </span>
          </div>
          <ol className="resolution-list">
            {resolutionQueue.map((item) => (
              <ResolutionCard key={item.caseId} item={item} />
            ))}
          </ol>
        </div>
      )}

      {attributionTriage.length > 0 && (
        <div className="resolution">
          <div className="section-heading">
            <h3>Who was this for?</h3>
            <span className="count" data-testid="attribution-count">
              {attributionTriage.length} pending
            </span>
          </div>
          <ol className="resolution-list">
            {attributionTriage.map((item) => (
              <AttributionCard key={item.importRecordId} item={item} />
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
