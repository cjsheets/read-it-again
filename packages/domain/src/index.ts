export {
  canonicalAuthor,
  canonicalIsbn,
  canonicalTitle,
  normalizeFormat,
  tokenizeTitle,
  booklandIsbn,
  isbnVariants,
  isValidIsbn,
  searchText,
} from './normalization.js';
export { rankCandidates, scoreCandidate } from './resolution.js';
export type {
  CatalogCandidate,
  CandidateScore,
  ResolutionInput,
  ResolutionRanking,
} from './resolution.js';
export { assessAttribution } from './attribution.js';
export type {
  AttributionAssessment,
  AttributionInput,
  AttributionSignal,
  AttributionState,
} from './attribution.js';
export type { CatalogMetadata, MarcContributor, MarcSeries } from './metadata.js';
export {
  clusterAcquisitionEpisodes,
  DEFAULT_EPISODE_THRESHOLDS,
  preferenceScore,
} from './reading-model.js';
export { scoreDiscoveryCandidates } from './recommendation.js';
export type {
  PreferenceFeature,
  RecommendationCandidate,
  RecommendationConstraints,
  ScoredRecommendation,
} from './recommendation.js';
export type {
  AcquisitionEpisodeDraft,
  AttributedCheckout,
  EpisodeThresholds,
  RecurrenceKind,
} from './reading-model.js';
