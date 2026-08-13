export {
  canonicalAuthor,
  canonicalIsbn,
  canonicalTitle,
  normalizeFormat,
  tokenizeTitle,
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
