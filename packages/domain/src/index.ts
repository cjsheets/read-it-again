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
