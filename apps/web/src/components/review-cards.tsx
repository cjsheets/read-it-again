import type { AttributionTriageItem, ResolutionQueueItem } from '@read-it-again/storage-schema';
import { useApp } from '../app-state.js';

/** Actions read as outcomes rather than pipeline stages (F-14): "Keep as typed"
 *  rather than "Use source details", "Ask me later" rather than "Defer". */
export function ResolutionCard({ item }: { readonly item: ResolutionQueueItem }) {
  const { applyDecision } = useApp();
  return (
    <li className="resolution-card">
      <div>
        <h3>{item.title}</h3>
        <p>{authorText(item.authorsJson)}</p>
      </div>
      {item.candidates.length > 0 && (
        <div className="candidates">
          {item.candidates.map((candidate) => {
            const snapshot = JSON.parse(candidate.snapshotJson) as {
              title: string;
              authorDisplays: string[];
            };
            return (
              <button
                key={candidate.id}
                type="button"
                onClick={() =>
                  void applyDecision({
                    type: 'acceptCandidate',
                    caseId: item.caseId,
                    candidateId: candidate.id,
                  })
                }
              >
                <strong>{snapshot.title}</strong>
                <span>{snapshot.authorDisplays.join(', ') || 'Unknown author'}</span>
                <small>{Math.round(candidate.totalScore * 100)}% match</small>
              </button>
            );
          })}
        </div>
      )}
      <div className="decision-actions">
        <button
          type="button"
          onClick={() =>
            void applyDecision({
              type: 'manualResolve',
              caseId: item.caseId,
              title: item.title,
              authorsJson: item.authorsJson,
            })
          }
        >
          Keep as typed
        </button>
        <button
          type="button"
          onClick={() => void applyDecision({ type: 'deferCase', caseId: item.caseId })}
        >
          Ask me later
        </button>
        <button
          type="button"
          onClick={() => void applyDecision({ type: 'rejectCase', caseId: item.caseId })}
        >
          Remove
        </button>
      </div>
    </li>
  );
}

export function AttributionCard({ item }: { readonly item: AttributionTriageItem }) {
  const { applyAttribution } = useApp();
  return (
    <li className="resolution-card">
      <div>
        <h3>{item.title}</h3>
        <p>{item.explanation}</p>
        <small>
          {item.sourceLabel} · {new Date(item.occurredAt).toLocaleDateString()}
        </small>
      </div>
      {item.evidence.length > 0 && (
        <ul>
          {item.evidence.map((evidence) => (
            <li key={evidence.explanation}>{evidence.explanation}</li>
          ))}
        </ul>
      )}
      <div className="decision-actions">
        {item.readers.map((reader) => (
          <button
            key={reader.id}
            type="button"
            onClick={() => void applyAttribution(item, 'checkout', 'assigned', [reader.id])}
          >
            For {reader.displayName}
          </button>
        ))}
        {item.readers.length > 1 && (
          <button
            type="button"
            onClick={() =>
              void applyAttribution(
                item,
                'checkout',
                'assigned',
                item.readers.map(({ id }) => id),
              )
            }
          >
            For all children
          </button>
        )}
        {item.readers.map((reader) => (
          <button
            key={`work-${reader.id}`}
            type="button"
            onClick={() => void applyAttribution(item, 'work', 'assigned', [reader.id])}
          >
            Always for {reader.displayName}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void applyAttribution(item, 'checkout', 'excluded', [])}
        >
          Not for a child
        </button>
      </div>
    </li>
  );
}

function authorText(authorsJson: string): string {
  const authors = JSON.parse(authorsJson) as { readonly display: string }[];
  return authors.map(({ display }) => display).join(', ');
}
