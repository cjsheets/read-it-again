import { useApp, useWorkerData } from '../app-state.js';
import { AttributionCard, ResolutionCard } from '../components/review-cards.js';

/** Resolution and attribution work that still needs a person. */
export function Tasks() {
  const { summary, assignReaders } = useApp();
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
          {/* A second reader can move many automatic assignments here at once. */}
          {attributionTriage.length > 1 && (
            <div className="decision-actions bulk-actions" data-testid="bulk-attribution">
              <span className="model-note">All {attributionTriage.length}:</span>
              {summary.readers.map((reader) => (
                <button
                  key={reader.id}
                  type="button"
                  data-testid={`file-all-${reader.id}`}
                  onClick={() =>
                    void assignReaders(
                      attributionTriage.map((item) => item.workId),
                      [reader.id],
                    )
                  }
                >
                  File all under {reader.displayName}
                </button>
              ))}
              {summary.readers.length > 1 && (
                <button
                  type="button"
                  data-testid="file-all-everyone"
                  onClick={() =>
                    void assignReaders(
                      attributionTriage.map((item) => item.workId),
                      summary.readers.map((reader) => reader.id),
                    )
                  }
                >
                  File all under everyone
                </button>
              )}
            </div>
          )}
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
