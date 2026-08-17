import type { RecommendationView } from '@read-it-again/storage-schema';
import { useWorkerData } from '../app-state.js';
import type { Route } from '../router.js';

/**
 * The recommendation card is the strongest UI in the app — availability,
 * per-item plain-language evidence, estimated minutes, a catalog key. Its problem
 * was never design; it was that a browser-only household can never produce one,
 * because recommendations arrive with an archive from the local runtime. So the
 * empty state has to explain that rather than look broken.
 */
export function Discover({ go }: { readonly go: (route: Route) => void }) {
  const recommendations = useWorkerData(
    { type: 'getRecommendations' },
    (response) => response.recommendations,
  );
  if (!recommendations) return <p className="model-note">Loading…</p>;
  const empty = recommendations.discovery.length === 0 && recommendations.readAgain.length === 0;

  return (
    <section aria-labelledby="discover-title">
      <div className="section-heading">
        <div>
          <h2 id="discover-title">What to bring home next</h2>
          <p className="model-note">
            Deterministic suggestions from your household&rsquo;s history. Availability is a cached
            library observation, not a reservation.
          </p>
        </div>
        {recommendations.generatedAt && (
          <span className="count">
            Checked {new Date(recommendations.generatedAt).toLocaleDateString()}
          </span>
        )}
      </div>

      {empty ? (
        <div className="empty" data-testid="discover-empty">
          <p>
            <strong>No suggestions yet.</strong>
          </p>
          <p>Suggestions appear after library history has been connected from a computer.</p>
          <button type="button" className="link-button" onClick={() => go('settings')}>
            Learn about connected sources
          </button>
        </div>
      ) : (
        <div className="recommendation-columns">
          <div>
            <h3>Discover something new</h3>
            <p className="model-note">Works already on the bookshelf are excluded.</p>
            <RecommendationList items={recommendations.discovery} />
          </div>
          <div>
            <h3>Read it again</h3>
            <p className="model-note">Known favorites, kept separate from discovery.</p>
            <RecommendationList items={recommendations.readAgain} />
          </div>
        </div>
      )}
    </section>
  );
}

function RecommendationList({ items }: { readonly items: RecommendationView['discovery'] }) {
  if (items.length === 0) return <p>No recommendations in this group.</p>;
  return (
    <ol className="recommendation-list">
      {items.map((item) => (
        <li key={item.catalogKey} className="recommendation-card">
          <div className="recommendation-title">
            <div>
              <h4>{item.title}</h4>
              <p>{item.authors.join(', ') || 'Unknown author'}</p>
            </div>
            <span className={item.holdings.systemAvailable > 0 ? 'available' : 'unavailable'}>
              {item.holdings.systemAvailable} of {item.holdings.systemTotal} available
            </span>
          </div>
          <ul className="recommendation-evidence">
            {item.evidence.map((evidence) => (
              <li key={evidence}>{evidence}</li>
            ))}
          </ul>
          <p className="recommendation-meta">
            {item.estimatedReadMinutes ? `~${item.estimatedReadMinutes} min · ` : ''}
            Catalog record {item.catalogKey}
          </p>
        </li>
      ))}
    </ol>
  );
}
